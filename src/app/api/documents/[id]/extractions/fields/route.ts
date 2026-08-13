import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authorizeWrite } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId, handleApiError } from "@/lib/api/error";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  buildReviewFields,
  validateCorrection,
  HUMAN_CORRECTION_SOURCE,
} from "@/modules/documents/extractionReview";

/**
 * Record a reviewer's correction to an extracted field.
 *
 * The correction is inserted as a new row rather than an update: the machine's
 * original reading stays exactly as the extractor produced it, and the sequence
 * of rows is the correction history. Nothing here overwrites evidence.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId();

  try {
    const { ctx, errorResponse } = await authorizeWrite();
    if (errorResponse) return errorResponse;
    if (!ctx) {
      return buildErrorResponse(401, "UNAUTHENTICATED", "Authentication required", requestId);
    }

    const { id } = await context.params;

    const body = (await req.json().catch(() => null)) as {
      fieldName?: unknown;
      value?: unknown;
    } | null;

    const fieldName = typeof body?.fieldName === "string" ? body.fieldName.trim() : "";
    if (fieldName === "") {
      return buildErrorResponse(
        400,
        "FIELD_NAME_REQUIRED",
        "A field name is required.",
        requestId
      );
    }

    // Tenant scope is enforced on the document, not on the extraction row, because
    // ExtractionField carries no accountId of its own.
    const document = await db.shipmentDocument.findFirst({
      where: { id, accountId: ctx.accountId },
      select: { id: true, shipmentId: true },
    });
    if (!document) {
      return buildErrorResponse(404, "DOCUMENT_NOT_FOUND", "Document not found", requestId);
    }

    const rows = await db.extractionField.findMany({
      where: { documentId: document.id, fieldName },
    });
    if (rows.length === 0) {
      return buildErrorResponse(
        404,
        "FIELD_NOT_EXTRACTED",
        `No field named "${fieldName}" was extracted from this document.`,
        requestId
      );
    }

    const [field] = buildReviewFields(rows);

    const validation = validateCorrection(body?.value, field.currentValue);
    if (!validation.ok || validation.value === undefined) {
      return buildErrorResponse(
        400,
        "INVALID_CORRECTION",
        validation.reason ?? "The corrected value is not valid.",
        requestId
      );
    }

    const created = await db.extractionField.create({
      data: {
        documentId: document.id,
        fieldName,
        value: validation.value,
        // A reviewed value is not a model prediction, so it carries no model score.
        confidence: null,
        // Provenance is inherited: the reviewer corrected what the extractor found,
        // they did not point at a new location on the page.
        pageNumber: field.pageNumber,
        bbox:
          field.bbox === null
            ? undefined
            : ({
                x: field.bbox.x,
                y: field.bbox.y,
                width: field.bbox.width,
                height: field.bbox.height,
              } satisfies Prisma.InputJsonObject),
        source: HUMAN_CORRECTION_SOURCE,
        // C-4: Correction audit trail — who corrected what, and from which value.
        correctedFromValue: field.currentValue,
        correctedByUserId: ctx.userId,
        correctedAt: new Date(),
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "EXTRACTION_FIELD_CORRECTED",
      entity: "ExtractionField",
      entityId: created.id,
      metadata: {
        documentId: document.id,
        shipmentId: document.shipmentId,
        fieldName,
      },
      beforeJson: { value: field.currentValue, confidence: field.confidence },
      afterJson: { value: validation.value, source: HUMAN_CORRECTION_SOURCE },
      requestId,
    });

    const [updated] = buildReviewFields([...rows, created]);

    return NextResponse.json({ field: updated, requestId });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
