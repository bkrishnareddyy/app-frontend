import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  try {
    const doc = await db.shipmentDocument.findFirst({
      where: { id, accountId: ctx.accountId },
      include: {
        extractionFields: true,
        shipment: {
          include: { lineItems: true },
        },
      },
    });

    if (!doc) {
      return buildErrorResponse(404, "NOT_FOUND", "Shipment document not found", undefined, requestId);
    }

    let parsedBlob = null;
    if (doc.extractedJson) {
      try {
        parsedBlob = JSON.parse(doc.extractedJson);
      } catch (err) {}
    }

    if (!parsedBlob && doc.fileUrl) {
      try {
        let fileBuffer: Buffer | null = null;
        if (doc.fileUrl.startsWith("http://") || doc.fileUrl.startsWith("https://")) {
          const res = await fetch(doc.fileUrl);
          if (res.ok) {
            fileBuffer = Buffer.from(await res.arrayBuffer());
          }
        } else {
          const fs = await import("fs");
          const path = await import("path");
          const localPath = path.join(process.cwd(), "public", doc.fileUrl);
          if (fs.existsSync(localPath)) {
            fileBuffer = fs.readFileSync(localPath);
          }
        }

        if (fileBuffer) {
          const { DocumentIntelligenceAgent } = await import("@/modules/agents/documentIntelligenceAgent");
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

          // Re-fetch updated document record with newly persisted extractedJson
          const updatedDoc = await db.shipmentDocument.findUnique({ where: { id: doc.id } });
          if (updatedDoc?.extractedJson) {
            try {
              parsedBlob = JSON.parse(updatedDoc.extractedJson);
            } catch (e) {}
          }
        }
      } catch (err: any) {
        console.warn("[OnDemandExtraction] Error executing DocumentIntelligenceAgent on demand:", err?.message || err);
      }
    }

    if (!parsedBlob) {
      const realKvPairs: Record<string, string> = {};
      if (doc.extractionFields && doc.extractionFields.length > 0) {
        for (const field of doc.extractionFields) {
          if (field.fieldName && field.value) {
            realKvPairs[field.fieldName] = field.value;
          }
        }
      }

      parsedBlob = {
        documentId: doc.id,
        shipmentNumber: doc.shipment?.shipmentNumber || "SHP-2026",
        fileName: doc.fileName,
        metadata: {
          docType: doc.docType,
          pageCount: doc.pageCount,
          confidence: doc.confidence,
          uploadedAt: doc.createdAt,
        },
        extractionStatus: doc.extractionFields.length > 0 ? "PARTIAL_OCR" : "PENDING_VISION_PROCESSING",
        keyValuePairs: realKvPairs,
        lineItems: doc.shipment?.lineItems?.map((li) => ({
          lineNumber: li.lineNumber,
          description: li.description,
          quantity: li.quantity,
          unitPrice: Number(li.unitPrice),
          totalAmount: Number(li.totalValue),
          countryOfOrigin: li.countryOfOrigin,
          htsCode: li.htsCode,
        })) || [],
      };
    }



    return NextResponse.json({
      documentId: doc.id,
      shipmentId: doc.shipmentId,
      shipmentNumber: doc.shipment?.shipmentNumber,
      fileName: doc.fileName,
      docType: doc.docType,
      checksum: doc.checksum || `sha256-${doc.id.slice(0, 16)}`,
      version: doc.version,
      extractedJson: parsedBlob,
      rawContent: doc.rawContent || null,
      extractionFields: doc.extractionFields,
      requestId,
    });
  } catch (error: unknown) {
    return buildErrorResponse(500, "INTERNAL_ERROR", errorMessage(error) || "Failed to fetch document extractions", undefined, requestId);
  }
});
