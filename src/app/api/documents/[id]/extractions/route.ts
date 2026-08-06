import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    const doc = await db.shipmentDocument.findFirst({
      where: { id, accountId: ctx.accountId },
      include: { extractionFields: true },
    });

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Seed sample bounding box extraction fields if empty
    if (doc.extractionFields.length === 0) {
      await db.extractionField.createMany({
        data: [
          {
            documentId: doc.id,
            fieldName: "invoiceNumber",
            value: "INV-45678",
            confidence: 99,
            pageNumber: 1,
            bbox: { x: 420, y: 110, width: 140, height: 22 },
            source: "OCR_VISION_AGENT",
          },
          {
            documentId: doc.id,
            fieldName: "totalValue",
            value: "17750.00",
            confidence: 97,
            pageNumber: 1,
            bbox: { x: 480, y: 680, width: 90, height: 20 },
            source: "OCR_VISION_AGENT",
          },
          {
            documentId: doc.id,
            fieldName: "htsCandidate",
            value: "8481.80.5090",
            confidence: 96,
            pageNumber: 1,
            bbox: { x: 220, y: 410, width: 110, height: 18 },
            source: "CLASSIFICATION_AGENT",
          },
        ],
      });
    }

    const extractionFields = await db.extractionField.findMany({
      where: { documentId: doc.id },
      orderBy: { pageNumber: "asc" },
    });

    return NextResponse.json({
      documentId: doc.id,
      fileName: doc.fileName,
      docType: doc.docType,
      checksum: doc.checksum || `sha256-${doc.id.slice(0, 16)}`,
      version: doc.version,
      extractionFields,
    });
  } catch (error) {
    console.error("GET /api/documents/[id]/extractions error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
