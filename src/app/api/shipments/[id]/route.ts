import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const whereClause: any = {
      accountId: ctx.accountId,
      OR: [{ id: params.id }, { shipmentNumber: params.id }],
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
  } catch (error) {
    console.error("GET /api/shipments/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Require OWNER or ADMIN role to modify shipment assignments
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
      where: { id: params.id, accountId: ctx.accountId, deletedAt: null },
    });

    if (!shipment) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    // Update shipment assignment
    const updatedShipment = await db.shipment.update({
      where: { id: params.id },
      data: {
        assignedBrokerId: assignedBrokerId || null,
      },
    });

    // Cascade assignment to related exception items (assignedToUserId)
    await db.exceptionItem.updateMany({
      where: { shipmentId: params.id, accountId: ctx.accountId },
      data: { assignedToUserId: assignedBrokerId || null },
    });

    // Cascade assignment to related compliance findings (assignedToUserId)
    const filings = await db.customsFiling.findMany({
      where: { shipmentId: params.id, accountId: ctx.accountId },
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
      entityId: params.id,
      metadata: {
        shipmentNumber: shipment.shipmentNumber,
        previousBrokerId: shipment.assignedBrokerId,
        newBrokerId: assignedBrokerId || "Unassigned",
      },
      success: true,
    });

    return NextResponse.json({ shipment: updatedShipment });
  } catch (error) {
    console.error("PATCH /api/shipments/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
