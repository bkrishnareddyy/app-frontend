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

    const shipments = await db.shipment.findMany({
      where: { accountId: ctx.accountId, deletedAt: null },
      include: {
        documents: true,
        lineItems: true,
        agentDecisions: true,
        customsFilings: true,
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
    const { importerName, poReference, entryType, incoterm, estimatedArrival } = body;

    const shipmentCount = await db.shipment.count({
      where: { accountId: ctx.accountId },
    });

    const shipmentNumber = `SHP-2026-${String(shipmentCount + 4873).padStart(6, "0")}`;

    const shipment = await db.shipment.create({
      data: {
        accountId: ctx.accountId,
        shipmentNumber,
        importerName: importerName || "ABC Manufacturing India Pvt Ltd",
        poReference: poReference || "PO-889900",
        entryType: entryType || "Consumption Entry",
        incoterm: incoterm || "CIF Los Angeles",
        estimatedArrival: estimatedArrival ? new Date(estimatedArrival) : new Date("2026-05-20"),
        status: "In Progress",
        readinessScore: 87,
        riskScore: 28,
        ownerName: ctx.firstName || "Stephen",
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "shipment.create",
      entity: "Shipment",
      entityId: shipment.id,
      metadata: { shipmentNumber },
    });

    return NextResponse.json({ shipment }, { status: 201 });
  } catch (error) {
    console.error("POST /api/shipments error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
