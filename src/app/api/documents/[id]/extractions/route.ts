import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId , errorMessage } from "@/lib/api/error";
import { db } from "@/lib/db";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  const { id } = await context.params;

  try {
    const doc = await db.shipmentDocument.findFirst({
      where: { id, accountId: ctx!.accountId },
      include: { extractionFields: true },
    });

    if (!doc) {
      return buildErrorResponse(404, "NOT_FOUND", "Shipment document not found", undefined, requestId);
    }

    return NextResponse.json({
      documentId: doc.id,
      fileName: doc.fileName,
      docType: doc.docType,
      checksum: doc.checksum || `sha256-${doc.id.slice(0, 16)}`,
      version: doc.version,
      extractionFields: doc.extractionFields,
      requestId,
    });
  } catch (error: unknown) {
    return buildErrorResponse(500, "INTERNAL_ERROR", errorMessage(error) || "Failed to fetch document extractions", undefined, requestId);
  }
}
