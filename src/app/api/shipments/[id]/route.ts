import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { CanonicalShipmentService } from "@/modules/shipment/canonicalShipmentService";
import { PipelineOrchestrator } from "@/modules/agents/pipelineOrchestrator";
import { FactAuditService } from "@/modules/audit/factAuditService";
import { FactService } from "@/modules/shipment/factService";
import { lineItemFactField } from "@/modules/shipment/lineItemReconciler";
import { ShipmentPartyService, type ShipmentPartyRole } from "@/modules/shipment/shipmentPartyService";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().min(1),
});

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  try {
    // Ownership is proved here so the canonical loader is never reached with a foreign id.
    const owned = await db.shipment.findFirst({
      where: { id, accountId: ctx.accountId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    const canonical = await CanonicalShipmentService.getCanonicalState(id);
    return NextResponse.json(canonical);
  } catch (err: unknown) {
    console.error("Failed to load canonical shipment state:", err);
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { lineItems, clientId, parties, countryOfOrigin, incoterm } = body;

  const shipment = await db.shipment.findFirst({
    where: { id, accountId: ctx.accountId, deletedAt: null },
    omit: { filingDeadline: true },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  // Handle Country of Origin update
  if (countryOfOrigin !== undefined && countryOfOrigin !== shipment.countryOfOrigin) {
    await FactAuditService.logChangeEvent({
      shipmentId: id,
      userId: ctx.userId,
      changeType: "USER_FIELD_UPDATE",
      field: "countryOfOrigin",
      // A missing prior value is recorded as unknown, never as an invented country.
      previousValue: shipment.countryOfOrigin,
      newValue: countryOfOrigin,
      reason: "User manual update",
    });

    await db.shipment.update({
      where: { id },
      data: { countryOfOrigin, version: { increment: 1 } },
    });

    // Also update all line items for consistency if present
    await db.shipmentLineItem.updateMany({
      where: { shipmentId: id },
      data: { countryOfOrigin },
    });

    await FactService.record({
      shipmentId: id,
      field: "countryOfOrigin",
      value: countryOfOrigin,
      sourceType: "USER_ENTERED",
    });

    // Trigger selective dependency-aware agent execution
    await PipelineOrchestrator.processEvent({
      shipmentId: id,
      accountId: ctx.accountId,
      userId: ctx.userId,
      triggerEvent: "USER_FIELD_UPDATED",
      payload: { field: "countryOfOrigin", newValue: countryOfOrigin },
    });
  }

  // Handle Incoterm update
  if (incoterm && incoterm !== shipment.incoterm) {
    await FactAuditService.logChangeEvent({
      shipmentId: id,
      userId: ctx.userId,
      changeType: "USER_FIELD_UPDATE",
      field: "incoterm",
      previousValue: shipment.incoterm,
      newValue: incoterm,
      reason: "User manual update",
    });

    await db.shipment.update({
      where: { id },
      data: { incoterm, version: { increment: 1 } },
    });

    await FactService.record({
      shipmentId: id,
      field: "incoterm",
      value: incoterm,
      sourceType: "USER_ENTERED",
    });

    await PipelineOrchestrator.processEvent({
      shipmentId: id,
      accountId: ctx.accountId,
      userId: ctx.userId,
      triggerEvent: "USER_FIELD_UPDATED",
      payload: { field: "incoterm", newValue: incoterm },
    });
  }

  // Handle Line Items inline updates
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    let anyLineItemChanged = false;
    for (const item of lineItems) {
      if (item.id) {
        // Scoped to this shipment so an id from another tenant cannot be edited.
        const existingItem = await db.shipmentLineItem.findFirst({
          where: { id: item.id, shipmentId: id, accountId: ctx.accountId },
        });
        if (existingItem) {
          const htsChanged = item.htsCode !== undefined && item.htsCode !== existingItem.htsCode;
          const originChanged = item.countryOfOrigin !== undefined && item.countryOfOrigin !== existingItem.countryOfOrigin;

          if (htsChanged) {
            await FactAuditService.logChangeEvent({
              shipmentId: id,
              userId: ctx.userId,
              changeType: "USER_FIELD_UPDATE",
              field: lineItemFactField(existingItem.lineNumber, "htsCode"),
              previousValue: existingItem.htsCode,
              newValue: item.htsCode,
              reason: "User manual update",
            });
            await FactService.record({
              shipmentId: id,
              field: lineItemFactField(existingItem.lineNumber, "htsCode"),
              value: item.htsCode,
              sourceType: "USER_ENTERED",
            });
          }
          if (originChanged) {
            await FactAuditService.logChangeEvent({
              shipmentId: id,
              userId: ctx.userId,
              changeType: "USER_FIELD_UPDATE",
              field: lineItemFactField(existingItem.lineNumber, "countryOfOrigin"),
              previousValue: existingItem.countryOfOrigin,
              newValue: item.countryOfOrigin,
              reason: "User manual update",
            });
            await FactService.record({
              shipmentId: id,
              field: lineItemFactField(existingItem.lineNumber, "countryOfOrigin"),
              value: item.countryOfOrigin,
              sourceType: "USER_ENTERED",
            });
          }

          if (htsChanged || originChanged) {
            anyLineItemChanged = true;
            await db.shipmentLineItem.update({
              where: { id: item.id },
              data: {
                htsCode: item.htsCode !== undefined ? item.htsCode : undefined,
                countryOfOrigin: item.countryOfOrigin !== undefined ? item.countryOfOrigin : undefined,
                htsConfidence: 100,
                // A user directly editing a line's classification/origin is
                // exactly what confirming it looks like.
                status: "Valid",
              },
            });
          }
        }
      }
    }

    if (anyLineItemChanged) {
      await db.shipment.update({ where: { id }, data: { version: { increment: 1 } } });
    }

    // Trigger selective agent execution for HTS/CoO edits
    await PipelineOrchestrator.processEvent({
      shipmentId: id,
      accountId: ctx.accountId,
      userId: ctx.userId,
      triggerEvent: "USER_FIELD_UPDATED",
      payload: { field: "lineItem.countryOfOrigin", lineItems },
    });
  }

  // Handle Client update
  if (clientId !== undefined) {
    await db.shipment.update({
      where: { id },
      data: { clientId: clientId || null },
    });
  }

  // Handle Shipment Parties update
  if (Array.isArray(parties)) {
    for (const party of parties) {
      if (party.legalEntityId && party.role) {
        await ShipmentPartyService.assignParty({
          shipmentId: id,
          legalEntityId: party.legalEntityId,
          role: party.role as ShipmentPartyRole,
          source: "USER",
        });
      }
    }
  }

  const updatedCanonical = await CanonicalShipmentService.getCanonicalState(id);
  return NextResponse.json(updatedCanonical);
});
