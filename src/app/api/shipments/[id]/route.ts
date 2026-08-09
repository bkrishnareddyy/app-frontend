import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const whereClause: Prisma.ShipmentWhereInput = {
    accountId: ctx.accountId,
    OR: [{ id }, { shipmentNumber: id }],
    deletedAt: null,
  };

  if (ctx.roleName === "PLANNER") {
    whereClause.assignedBrokerId = ctx.userId;
  }

  const shipment = await db.shipment.findFirst({
    where: whereClause,
    include: {
      documents: true,
      lineItems: true,
      agentDecisions: true,
      customsFilings: {
        include: { responses: true },
      },
    },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  return NextResponse.json({ shipment });
});

// Require OWNER or ADMIN role to modify shipments — a custom "Enterprise
// Admin" check combining accountType + roleName, distinct from the
// OWNER-role wildcard that authorizeRequest's `permission` option grants,
// so it stays a manual check rather than a `permission` string.
export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const isEnterpriseAdmin =
    ctx.accountType === "ENTERPRISE" &&
    (ctx.roleName === "ADMIN" || ctx.roleName === "OWNER");

  if (!isEnterpriseAdmin) {
    return NextResponse.json(
      { error: "Forbidden: Only Enterprise Admins can edit shipments" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { assignedBrokerId, shipmentNumber, lineItems } = body;

  // Check if new broker exists in this account (if specified)
  if (assignedBrokerId) {
    const membership = await db.accountMembership.findFirst({
      where: { accountId: ctx.accountId, userId: assignedBrokerId, status: "ACTIVE" },
    });
    if (!membership) {
      return NextResponse.json(
        { error: "Invalid broker assignment: User is not an active member of this account" },
        { status: 400 }
      );
    }
  }

  // Fetch the current shipment to ensure it belongs to the active account
  const shipment = await db.shipment.findFirst({
    where: { id, accountId: ctx.accountId, deletedAt: null },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  // Validate uniqueness of shipmentNumber if changing it
  if (shipmentNumber && shipmentNumber.trim() !== shipment.shipmentNumber) {
    if (typeof shipmentNumber !== "string" || shipmentNumber.trim() === "") {
      return NextResponse.json({ error: "Invalid shipmentNumber" }, { status: 400 });
    }

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

  // Update shipment
  const updatedShipment = await db.shipment.update({
    where: { id },
    data: updateData,
  });

  // Update or create line items if specified
  if (lineItems && Array.isArray(lineItems)) {
    for (const item of lineItems) {
      if (item.id) {
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
      } else {
        await db.shipmentLineItem.create({
          data: {
            shipmentId: id,
            accountId: ctx.accountId,
            lineNumber: item.lineNumber !== undefined ? Number(item.lineNumber) : 2,
            description: item.description !== undefined ? item.description : "Electronic Controller",
            quantity: item.quantity !== undefined ? Number(item.quantity) : 20,
            unitPrice: item.unitPrice !== undefined ? Number(item.unitPrice) : 15.50,
            totalValue: item.totalValue !== undefined ? Number(item.totalValue) : 310.00,
            htsCode: item.htsCode !== undefined ? item.htsCode.trim() : "8481.80.5090",
            countryOfOrigin: item.countryOfOrigin !== undefined ? item.countryOfOrigin.trim() : "Germany",
            status: item.status !== undefined ? item.status : "Valid",
          },
        });
      }

      await createAuditLog({
        accountId: ctx.accountId,
        userId: ctx.userId,
        action: "lineItem.update",
        entity: "ShipmentLineItem",
        entityId: item.id || "new-item",
        metadata: {
          shipmentId: id,
          htsCode: item.htsCode,
          countryOfOrigin: item.countryOfOrigin,
          quantity: item.quantity,
        },
        success: true,
      });
    }
  }

  // Cascade broker assignment change to related ExceptionItems and ComplianceFindings if it was updated
  if (assignedBrokerId !== undefined && assignedBrokerId !== shipment.assignedBrokerId) {
    // Cascade assignment to related exception items (assignedToUserId)
    await db.exceptionItem.updateMany({
      where: { shipmentId: id, accountId: ctx.accountId },
      data: { assignedToUserId: assignedBrokerId || null },
    });

    // Cascade assignment to related compliance findings (assignedToUserId)
    const filings = await db.customsFiling.findMany({
      where: { shipmentId: id, accountId: ctx.accountId },
      select: { id: true },
    });
    const filingIds = filings.map((f) => f.id);
    if (filingIds.length > 0) {
      await db.complianceFinding.updateMany({
        where: { filingId: { in: filingIds }, accountId: ctx.accountId },
        data: { assignedToUserId: assignedBrokerId || null },
      });
    }
  }

  // Log rename event if shipmentNumber changed
  if (shipmentNumber !== undefined && shipmentNumber.trim() !== shipment.shipmentNumber) {
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "shipment.rename",
      entity: "Shipment",
      entityId: id,
      metadata: {
        previousNumber: shipment.shipmentNumber,
        newNumber: shipmentNumber.trim(),
      },
      success: true,
    });
  }

  // Log assign event if broker changed
  if (assignedBrokerId !== undefined && assignedBrokerId !== shipment.assignedBrokerId) {
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "shipment.assign",
      entity: "Shipment",
      entityId: id,
      metadata: {
        shipmentNumber: updatedShipment.shipmentNumber,
        previousBrokerId: shipment.assignedBrokerId,
        newBrokerId: assignedBrokerId || "Unassigned",
      },
      success: true,
    });
  }

  return NextResponse.json({ shipment: updatedShipment });
});
