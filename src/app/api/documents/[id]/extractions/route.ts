import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { resolveStorageOrigin, StorageValidationError } from "@/lib/storage";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

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
      shipmentId: doc.shipmentId,
      packetId: `pkt_ondemand_${doc.id.slice(0, 8)}`,
      fileBuffer,
      fileName: doc.fileName,
      mimeType: "application/pdf",
      docTypeCode: doc.docType,
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
