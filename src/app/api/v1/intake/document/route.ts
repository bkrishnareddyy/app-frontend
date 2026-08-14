/**
 * POST /api/v1/intake/document
 *
 * External document-ingest endpoint — accepts a document URL from an ERP,
 * TMS, or integration partner, creates a ShipmentDocument row, and enqueues
 * classification + extraction. Authenticated via API key.
 *
 * Scope required: documents:write
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateApiKey, apiKeyHasScope } from "@/lib/api/api-key-auth";
import { generateRequestId } from "@/lib/api/error";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { resolveStorageOrigin, StorageValidationError } from "@/lib/storage";

const bodySchema = z.object({
  /** Publicly reachable URL or internal storage URL for the document file. */
  url: z.string().url(),
  /** Optional document type hint (e.g. "COMMERCIAL_INVOICE"). If absent the
   *  classifier assigns it. */
  documentType: z.string().max(100).optional(),
  /** Shipment number, PO reference, or other identifier used to attach this
   *  document to an existing shipment. Optional — if omitted the document is
   *  created unattached and the matching pipeline attempts auto-attach. */
  shipmentReference: z.string().max(200).optional(),
  /** Human-readable original filename. Defaults to the last path segment of url. */
  fileName: z.string().max(500).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const requestId = generateRequestId();

  const apiCtx = await authenticateApiKey(req);
  if (!apiCtx) {
    return NextResponse.json(
      { error: "Unauthorized: valid API key required", requestId },
      { status: 401 }
    );
  }

  if (!apiKeyHasScope(apiCtx, "documents:write")) {
    return NextResponse.json(
      { error: "Forbidden: key does not have documents:write scope", requestId },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", requestId }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", issues: parsed.error.issues, requestId },
      { status: 400 }
    );
  }

  const { url, documentType, shipmentReference, fileName: suppliedFileName } = parsed.data;

  // Reject URLs from untrusted storage origins up front.
  try {
    resolveStorageOrigin(url);
  } catch (err) {
    if (err instanceof StorageValidationError) {
      return NextResponse.json(
        { error: "Untrusted document URL origin", detail: err.message, requestId },
        { status: 400 }
      );
    }
    throw err;
  }

  const fileName = suppliedFileName ?? url.split("/").pop()?.split("?")[0] ?? "document";

  // Optional: resolve shipmentReference → shipment row.
  let shipmentId: string | null = null;
  if (shipmentReference) {
    const matchedShipment = await db.shipment.findFirst({
      where: {
        accountId: apiCtx.accountId,
        deletedAt: null,
        OR: [
          { shipmentNumber: shipmentReference },
          { poReference: shipmentReference },
        ],
      },
      select: { id: true },
    });
    if (matchedShipment) {
      shipmentId = matchedShipment.id;
    }
  }

  const doc = await db.shipmentDocument.create({
    data: {
      accountId: apiCtx.accountId,
      shipmentId,
      docType: documentType ?? "Unknown",
      fileName,
      fileUrl: url,
      status: "Received",
    },
    select: { id: true, status: true, createdAt: true },
  });

  await createAuditLog({
    accountId: apiCtx.accountId,
    action: AuditAction.DOCUMENT_QUEUED,
    entity: "ShipmentDocument",
    entityId: doc.id,
    source: "API",
    metadata: { url, documentType, shipmentReference, shipmentId, fileName },
  });

  // Fire-and-forget: enqueue classification + extraction.
  // Import is dynamic so the heavy agent bundle is not in the cold-start path.
  void (async () => {
    try {
      const { DocumentIntelligenceAgent } = await import(
        "@/modules/agents/documentIntelligenceAgent"
      );
      const fileRes = await fetch(url);
      if (!fileRes.ok) return;
      const fileBuffer = Buffer.from(await fileRes.arrayBuffer());

      await DocumentIntelligenceAgent.execute({
        accountId: apiCtx.accountId,
        userId: null,
        shipmentId: shipmentId ?? "",
        packetId: `pkt_intake_${doc.id.slice(0, 8)}`,
        fileBuffer,
        fileName,
        mimeType: "application/pdf",
        docTypeCode: documentType,
        forceOverwrite: false,
      });
    } catch (err) {
      console.error("[intake/document] Background extraction failed:", err);
    }
  })();

  return NextResponse.json(
    {
      documentId: doc.id,
      processingStatus: "QUEUED",
      shipmentId,
      requestId,
    },
    { status: 202 }
  );
}
