import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams, parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { ShipmentPartyService, type ShipmentPartyRole } from "@/modules/shipment/shipmentPartyService";
import { FactAuditService } from "@/modules/audit/factAuditService";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().min(1),
});

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const whereClause: Prisma.ShipmentWhereInput = {
    id,
    accountId: ctx.accountId,
    deletedAt: null,
  };

  if (ctx.roleNames.includes("PLANNER")) {
    whereClause.assignedBrokerId = ctx.userId;
  }

  const shipment = await db.shipment.findFirst({
    where: whereClause,
    include: {
      documents: {
        include: { parseVersions: true },
      },
      lineItems: true,
      agentDecisions: true,
      customsFilings: {
        include: { responses: true },
      },
      client: true,
      shipmentParties: {
        include: {
          legalEntity: {
            include: { customsProfiles: true },
          },
        },
      },
      changeEvents: {
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  return NextResponse.json({ shipment });
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { assignedBrokerId, shipmentNumber, lineItems, clientId, parties, importerName } = body;

  // Check shipment existence
  const shipment = await db.shipment.findFirst({
    where: { id, accountId: ctx.accountId, deletedAt: null },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  // Verify unique shipmentNumber if provided and changed
  if (shipmentNumber && shipmentNumber.trim() !== shipment.shipmentNumber) {
    const existing = await db.shipment.findFirst({
      where: {
        accountId: ctx.accountId,
        shipmentNumber: shipmentNumber.trim(),
        id: { not: id },
        deletedAt: null,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "A shipment with this number already exists in your account" },
        { status: 400 }
      );
    }
  }

  // Build update payload
  const updateData: Prisma.ShipmentUncheckedUpdateInput = {};
  if (assignedBrokerId !== undefined) {
    updateData.assignedBrokerId = assignedBrokerId || null;
  }
  if (shipmentNumber !== undefined) {
    updateData.shipmentNumber = shipmentNumber.trim();
  }
  if (clientId !== undefined) {
    updateData.clientId = clientId || null;
  }
  if (importerName !== undefined) {
    updateData.importerName = importerName;
  }

  // Update shipment
  const updatedShipment = await db.shipment.update({
    where: { id },
    data: updateData,
  });

  // Audit field updates
  if (importerName !== undefined && importerName !== shipment.importerName) {
    await FactAuditService.logChangeEvent({
      shipmentId: id,
      userId: ctx.userId,
      changeType: "USER_FIELD_UPDATE",
      field: "importerName",
      previousValue: shipment.importerName,
      newValue: importerName,
    });
  }

  // Update shipment parties if provided
  if (parties && Array.isArray(parties)) {
    for (const p of parties) {
      if (p.legalEntityId && p.role) {
        await ShipmentPartyService.assignParty({
          shipmentId: id,
          legalEntityId: p.legalEntityId,
          role: p.role as ShipmentPartyRole,
          source: "USER",
          confidence: 1.0,
          isVerified: true,
        });

        await FactAuditService.logChangeEvent({
          shipmentId: id,
          userId: ctx.userId,
          changeType: "PARTY_ASSIGNED",
          field: `party.${p.role}`,
          newValue: p.legalEntityId,
        });
      }
    }
  }

  // Update or create line items if specified
  if (lineItems && Array.isArray(lineItems)) {
    for (const item of lineItems) {
      if (item.id) {
        const existingItem = await db.shipmentLineItem.findUnique({ where: { id: item.id } });
        await db.shipmentLineItem.update({
          where: { id: item.id, shipmentId: id },
          data: {
            lineNumber: item.lineNumber !== undefined ? Number(item.lineNumber) : undefined,
            description: item.description !== undefined ? item.description : undefined,
            htsCode: item.htsCode !== undefined ? item.htsCode.trim() : undefined,
            countryOfOrigin: item.countryOfOrigin !== undefined ? item.countryOfOrigin.trim() : undefined,
            quantity: item.quantity !== undefined ? Number(item.quantity) : undefined,
            unitPrice: item.unitPrice !== undefined ? Number(item.unitPrice) : undefined,
            totalValue: item.totalValue !== undefined ? Number(item.totalValue) : undefined,
            status: item.status !== undefined ? item.status : undefined,
          },
        });

        if (existingItem && item.htsCode !== undefined && item.htsCode !== existingItem.htsCode) {
          await FactAuditService.logChangeEvent({
            shipmentId: id,
            userId: ctx.userId,
            changeType: "CLASSIFICATION_CHANGED",
            field: `lineItem[${item.lineNumber || item.id}].htsCode`,
            previousValue: existingItem.htsCode,
            newValue: item.htsCode,
          });
        }
      } else {
        await db.shipmentLineItem.create({
          data: {
            accountId: shipment.accountId,
            shipmentId: id,
            lineNumber: Number(item.lineNumber || 1),
            description: item.description || "Line Item",
            totalValue: Number(item.totalValue || 0),
            countryOfOrigin: item.countryOfOrigin || "US",
            htsCode: item.htsCode || "8543.70.99",
            quantity: Number(item.quantity || 1),
            unitPrice: Number(item.unitPrice || 0),
            status: item.status || "Unreviewed",
          },
        });
      }
    }
  }

  // Return full refreshed shipment with relations
  const refreshedShipment = await db.shipment.findUnique({
    where: { id },
    include: {
      documents: {
        include: { parseVersions: true },
      },
      lineItems: true,
      agentDecisions: true,
      customsFilings: true,
      client: true,
      shipmentParties: {
        include: {
          legalEntity: {
            include: { customsProfiles: true },
          },
        },
      },
      changeEvents: {
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return NextResponse.json({ shipment: refreshedShipment });
});
