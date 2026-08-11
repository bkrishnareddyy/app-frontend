import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { resolveStorageOrigin, StorageValidationError } from "@/lib/storage";
import { createAuditLog } from "@/lib/audit";
import {
  OVERRIDE_PERMISSION,
  checkReviewPermission,
  permissionDeniedMessage,
} from "@/modules/decisions/reviewAuthority";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

// Mirrors the fields Document Intelligence actually extracts into
// tradeMetadata (src/modules/agents/documentIntelligenceAgent.ts) -- an
// allowlist so this endpoint can't be used to write arbitrary keys into the
// stored blob.
const EDITABLE_TRADE_METADATA_FIELDS = new Set([
  "exporterName",
  "importerName",
  "originCountry",
  "destinationCountry",
  "incoterm",
  "currency",
  "invoiceSubtotal",
  "invoiceNumber",
  "invoiceDate",
  "hsHtsCode",
  "poNumber",
  "portOfLoading",
  "portOfDischarge",
  "carrier",
  "transportDocumentNumber",
  "totalWeight",
  "totalQuantity",
]);

const documentInclude = {
  extractionFields: true,
  shipment: { include: { lineItems: true } },
} as const;

type DocumentWithRelations = NonNullable<
  Awaited<ReturnType<typeof db.shipmentDocument.findFirst<{ include: typeof documentInclude }>>>
>;

function parseStoredJson(doc: { id: string; extractedJson: string | null }): unknown | null {
  if (!doc.extractedJson) return null;
  try {
    return JSON.parse(doc.extractedJson);
  } catch (err) {
    console.warn(`[Extractions] Stored extractedJson for ${doc.id} is not valid JSON:`, err);
    return null;
  }
}

/** Shape returned when no extraction has been persisted yet. */
function pendingBlob(doc: DocumentWithRelations) {
  const keyValuePairs: Record<string, string> = {};
  for (const field of doc.extractionFields) {
    if (field.fieldName && field.value) {
      keyValuePairs[field.fieldName] = field.value;
    }
  }

  return {
    documentId: doc.id,
    shipmentNumber: doc.shipment?.shipmentNumber ?? null,
    fileName: doc.fileName,
    metadata: {
      docType: doc.docType,
      pageCount: doc.pageCount,
      confidence: doc.confidence,
      uploadedAt: doc.createdAt,
    },
    extractionStatus:
      doc.extractionFields.length > 0 ? "PARTIAL_OCR" : "PENDING_VISION_PROCESSING",
    keyValuePairs,
    lineItems:
      doc.shipment?.lineItems?.map((li) => ({
        lineNumber: li.lineNumber,
        description: li.description,
        quantity: li.quantity,
        unitPrice: Number(li.unitPrice),
        totalAmount: Number(li.totalValue),
        countryOfOrigin: li.countryOfOrigin,
        htsCode: li.htsCode,
      })) ?? [],
  };
}

function serialize(doc: DocumentWithRelations, extractedJson: unknown, requestId: string) {
  return {
    documentId: doc.id,
    shipmentId: doc.shipmentId,
    shipmentNumber: doc.shipment?.shipmentNumber ?? null,
    fileName: doc.fileName,
    docType: doc.docType,
    checksum: doc.checksum ?? null,
    version: doc.version,
    extractedJson,
    rawContent: doc.rawContent || null,
    extractionFields: doc.extractionFields,
    requestId,
  };
}

/** Read-only. Extraction is triggered by POST so a prefetch cannot run an AI job. */
export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  try {
    const doc = await db.shipmentDocument.findFirst({
      where: { id, accountId: ctx.accountId },
      include: documentInclude,
    });

    if (!doc) {
      return buildErrorResponse(404, "NOT_FOUND", "Shipment document not found", undefined, requestId);
    }

    const extractedJson = parseStoredJson(doc) ?? pendingBlob(doc);
    return NextResponse.json(serialize(doc, extractedJson, requestId));
  } catch (error: unknown) {
    return buildErrorResponse(
      500,
      "INTERNAL_ERROR",
      errorMessage(error) || "Failed to fetch document extractions",
      undefined,
      requestId
    );
  }
});

/**
 * Runs extraction for a document and persists the result.
 *
 * Source bytes come only from an allowlisted storage origin or from a local
 * upload path that is confined to the uploads directory.
 */
export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  try {
    const doc = await db.shipmentDocument.findFirst({
      where: { id, accountId: ctx.accountId },
      include: documentInclude,
    });

    if (!doc) {
      return buildErrorResponse(404, "NOT_FOUND", "Shipment document not found", undefined, requestId);
    }

    const existing = parseStoredJson(doc);
    if (existing) {
      return NextResponse.json({ ...serialize(doc, existing, requestId), extracted: false });
    }

    if (!doc.fileUrl) {
      return buildErrorResponse(
        409,
        "NO_SOURCE_FILE",
        "This document has no stored file to extract from.",
        undefined,
        requestId
      );
    }

    let fileBuffer: Buffer | null = null;
    try {
      const origin = resolveStorageOrigin(doc.fileUrl);
      if (origin) {
        const res = await fetch(doc.fileUrl);
        if (res.ok) fileBuffer = Buffer.from(await res.arrayBuffer());
      } else {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const uploadsRoot = path.join(process.cwd(), "public", "uploads");
        const localPath = path.resolve(process.cwd(), "public", `.${doc.fileUrl}`);
        // Confine to the uploads directory so a crafted fileUrl cannot traverse.
        if (localPath.startsWith(uploadsRoot + path.sep) && fs.existsSync(localPath)) {
          fileBuffer = fs.readFileSync(localPath);
        }
      }
    } catch (err) {
      if (err instanceof StorageValidationError) {
        return buildErrorResponse(
          400,
          "UNTRUSTED_STORAGE_ORIGIN",
          err.message,
          undefined,
          requestId
        );
      }
      throw err;
    }

    if (!fileBuffer) {
      return buildErrorResponse(
        409,
        "SOURCE_FILE_UNAVAILABLE",
        "The stored file could not be read.",
        undefined,
        requestId
      );
    }

    const { DocumentIntelligenceAgent } = await import(
      "@/modules/agents/documentIntelligenceAgent"
    );
    await DocumentIntelligenceAgent.execute({
      accountId: ctx.accountId,
      userId: ctx.userId,
      // A detached document has no shipment but can still be re-extracted.
      shipmentId: doc.shipmentId ?? "",
      packetId: `pkt_ondemand_${doc.id.slice(0, 8)}`,
      fileBuffer,
      fileName: doc.fileName,
      mimeType: "application/pdf",
      docTypeCode: doc.docType,
      // A person pressed "run extraction" on this document, so this reading is
      // meant to replace whatever is there -- including a parse-derived one,
      // which a background vision run is not allowed to overwrite.
      forceOverwrite: true,
    });

    const updated = await db.shipmentDocument.findFirst({
      where: { id: doc.id, accountId: ctx.accountId },
      include: documentInclude,
    });
    const source = updated ?? doc;
    const extractedJson = parseStoredJson(source) ?? pendingBlob(source);

    return NextResponse.json({ ...serialize(source, extractedJson, requestId), extracted: true });
  } catch (error: unknown) {
    return buildErrorResponse(
      500,
      "INTERNAL_ERROR",
      errorMessage(error) || "Failed to extract document",
      undefined,
      requestId
    );
  }
}, { write: true });

/**
 * Corrects one field in this document's own canonical extraction.
 *
 * Deliberately writes to ShipmentDocument.extractedJson rather than any
 * AgentDecision.evidenceItems -- a document has exactly one extractedJson,
 * so there's no ambiguity about which run's copy of the data this edits, and
 * every AgentDecision card that references this document reads the same
 * corrected value instead of each holding its own possibly-stale copy.
 */
export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json().catch(() => null);
  const field = body && typeof body === "object" ? (body as Record<string, unknown>).field : undefined;
  const value = body && typeof body === "object" ? (body as Record<string, unknown>).value : undefined;

  if (typeof field !== "string" || !EDITABLE_TRADE_METADATA_FIELDS.has(field)) {
    return buildErrorResponse(
      400,
      "INVALID_FIELD",
      `"${String(field)}" is not an editable extracted field`,
      undefined,
      requestId
    );
  }
  if (typeof value !== "string" || value.trim() === "") {
    return buildErrorResponse(400, "VALUE_REQUIRED", "value is required", undefined, requestId);
  }

  // Correcting an AI-extracted value is the same act as overriding a
  // classification -- a human replacing the model's answer with their own --
  // so it's gated by the same permission as decision overrides.
  const check = checkReviewPermission(ctx, [OVERRIDE_PERMISSION]);
  if (!check.allowed) {
    return buildErrorResponse(403, "PERMISSION_REQUIRED", permissionDeniedMessage(check), undefined, requestId);
  }

  try {
    const doc = await db.shipmentDocument.findFirst({
      where: { id, accountId: ctx.accountId },
      include: documentInclude,
    });
    if (!doc) {
      return buildErrorResponse(404, "NOT_FOUND", "Shipment document not found", undefined, requestId);
    }

    const parsed = parseStoredJson(doc) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") {
      return buildErrorResponse(
        409,
        "NO_EXTRACTION",
        "This document has no extraction to edit yet.",
        undefined,
        requestId
      );
    }

    const tradeMetadata =
      parsed.tradeMetadata && typeof parsed.tradeMetadata === "object"
        ? (parsed.tradeMetadata as Record<string, unknown>)
        : {};
    const previousValue = tradeMetadata[field] ?? null;
    const trimmedValue = value.trim();
    // Preserve numeric fields (e.g. invoiceSubtotal) as numbers rather than
    // silently turning them into strings.
    const nextValue: unknown =
      typeof previousValue === "number" && trimmedValue !== "" && !Number.isNaN(Number(trimmedValue))
        ? Number(trimmedValue)
        : trimmedValue;

    const updatedBlob = { ...parsed, tradeMetadata: { ...tradeMetadata, [field]: nextValue } };

    await db.shipmentDocument.update({
      where: { id: doc.id },
      data: { extractedJson: JSON.stringify(updatedBlob, null, 2) },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "document.edit_extracted_field",
      entity: "ShipmentDocument",
      entityId: doc.id,
      metadata: { field, previousValue, newValue: nextValue },
    });

    const updatedDoc = await db.shipmentDocument.findFirst({
      where: { id: doc.id, accountId: ctx.accountId },
      include: documentInclude,
    });
    const source = updatedDoc ?? doc;
    const extractedJson = parseStoredJson(source) ?? pendingBlob(source);

    return NextResponse.json(serialize(source, extractedJson, requestId));
  } catch (error: unknown) {
    return buildErrorResponse(
      500,
      "INTERNAL_ERROR",
      errorMessage(error) || "Failed to save edit",
      undefined,
      requestId
    );
  }
}, { write: true });
