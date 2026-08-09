import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function GET() {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const whereClause: any = { accountId: ctx.accountId, deletedAt: null };
    
    // RLS: Planners can only see shipments assigned to them
    if (ctx.roleName === "PLANNER") {
      whereClause.assignedBrokerId = ctx.userId;
    }

    const shipments = await db.shipment.findMany({
      where: whereClause,
      include: {
        documents: true,
        lineItems: true,
        agentDecisions: true,
        customsFilings: true,
        assignedBroker: true,
        masterShipment: true,
        houseShipments: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ shipments });
  } catch (error) {
    console.error("GET /api/shipments error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { importerName, poReference, entryType, incoterm, estimatedArrival, masterShipmentId } = body;

    // Dynamic sequence calculation directly from database count
    const shipmentCount = await db.shipment.count({
      where: { accountId: ctx.accountId },
    });

    const nextSeq = shipmentCount + 1;
    const shipmentNumber = `SHP-2026-${String(nextSeq).padStart(6, "0")}`;

    // Verify masterShipment exists and belongs to the same account if specified
    if (masterShipmentId) {
      const master = await db.shipment.findFirst({
        where: { id: masterShipmentId, accountId: ctx.accountId },
      });
      if (!master) {
        return NextResponse.json({ error: "Invalid masterShipmentId: Master shipment not found in this account" }, { status: 400 });
      }
    }

    const shipment = await db.shipment.create({
      data: {
        accountId: ctx.accountId,
        shipmentNumber,
        importerName: importerName || "ABC Manufacturing India Pvt Ltd",
        poReference: poReference || `PO-${Math.floor(100000 + Math.random() * 900000)}`,
        entryType: entryType || "Consumption Entry",
        incoterm: incoterm || "CIF Los Angeles",
        estimatedArrival: estimatedArrival ? new Date(estimatedArrival) : new Date("2026-05-20"),
        status: "In Progress",
        readinessScore: 85,
        riskScore: 20,
        ownerName: ctx.firstName || "Stephen",
        assignedBrokerId: ctx.roleName === "PLANNER" ? ctx.userId : null,
        masterShipmentId: masterShipmentId || null,
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "shipment.create",
      entity: "Shipment",
      entityId: shipment.id,
      metadata: { shipmentNumber, masterShipmentId },
    });

    return NextResponse.json({ shipment }, { status: 201 });
  } catch (error) {
    console.error("POST /api/shipments error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
