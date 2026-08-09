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

// Custom "Enterprise Admin" check below combines accountType + roleName —
// distinct from the OWNER-role wildcard that authorizeRequest's `permission`
// option grants, so it stays a manual check rather than a `permission` string.
export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const isEnterpriseAdmin =
    ctx.accountType === "ENTERPRISE" &&
    (ctx.roleName === "ADMIN" || ctx.roleName === "OWNER");

  if (!isEnterpriseAdmin) {
    return NextResponse.json(
      { error: "Forbidden: Only Enterprise Admins can reassign shipments" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { assignedBrokerId } = body;

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

  // Update shipment assignment
  const updatedShipment = await db.shipment.update({
    where: { id },
    data: {
      assignedBrokerId: assignedBrokerId || null,
    },
  });

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

  // Log the assignment shift in audit logs
  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "shipment.assign",
    entity: "Shipment",
    entityId: id,
    metadata: {
      shipmentNumber: shipment.shipmentNumber,
      previousBrokerId: shipment.assignedBrokerId,
      newBrokerId: assignedBrokerId || "Unassigned",
    },
    success: true,
  });

  return NextResponse.json({ shipment: updatedShipment });
});
