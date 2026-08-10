import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { EntityResolutionService } from "@/modules/entity/entityResolutionService";
import { ShipmentPartyService } from "@/modules/shipment/shipmentPartyService";
import { ExceptionService, DOCUMENT_FIELD_LABELS } from "@/modules/exceptions/exception.service";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1), documentId: z.string().min(1) });

const bodySchema = z.object({
  fieldKey: z.enum(["exporterName", "importerName", "originCountry"]),
  action: z.enum(["APPROVE", "EDIT"]),
  value: z.string().trim().min(1, "A value is required"),
});

export const POST = withAuthenticatedRoute<{ id: string; documentId: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id: shipmentId, documentId } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, bodySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { fieldKey, action, value } = bodyVal.data;

  try {
    const [shipment, document] = await Promise.all([
      db.shipment.findFirst({ where: { id: shipmentId, accountId: ctx.accountId } }),
      db.shipmentDocument.findFirst({ where: { id: documentId, accountId: ctx.accountId } }),
    ]);

    if (!shipment) return buildErrorResponse(404, "NOT_FOUND", "Shipment not found", undefined, requestId);
    if (!document) return buildErrorResponse(404, "NOT_FOUND", "Document not found", undefined, requestId);

    if (fieldKey === "originCountry") {
      await db.shipment.update({ where: { id: shipmentId }, data: { countryOfOrigin: value } });
    } else {
      const resolvedEntity = await EntityResolutionService.findOrCreateEntity(ctx.accountId, value);
      if (!resolvedEntity) {
        return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", "Could not resolve a legal entity for that name", undefined, requestId);
      }
      await ShipmentPartyService.assignParty({
        shipmentId,
        legalEntityId: resolvedEntity.id,
        role: fieldKey === "importerName" ? "IMPORTER_OF_RECORD" : "EXPORTER",
        source: "USER",
        confidence: 1.0,
        isVerified: true,
      });
    }

    const resolverName = [ctx.firstName, ctx.lastName].filter(Boolean).join(" ") || ctx.email;

    await db.fieldApproval.create({
      data: {
        accountId: ctx.accountId,
        shipmentId,
        documentId,
        fieldKey,
        value,
        approvedByUserId: ctx.userId,
        approvedByName: resolverName,
      },
    });

    const label = DOCUMENT_FIELD_LABELS[fieldKey];
    await ExceptionService.resolveDocumentFieldException(
      documentId,
      fieldKey,
      { userId: ctx.userId, name: resolverName },
      action === "EDIT" ? `${label} corrected via field review to "${value}".` : `${label} approved as extracted: "${value}".`
    );

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: action === "EDIT" ? "field_review.edit" : "field_review.approve",
      entity: "ShipmentDocument",
      entityId: documentId,
      metadata: { shipmentId, fieldKey, value },
    });

    return NextResponse.json({ success: true, requestId });
  } catch (error: unknown) {
    return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to save field review", undefined, requestId);
  }
});
