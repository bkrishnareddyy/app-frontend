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

    const filings = await db.customsFiling.findMany({
      where: { accountId: ctx.accountId },
      include: {
        shipment: {
          include: { documents: true },
        },
        responses: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ filings });
  } catch (error) {
    console.error("GET /api/filing error:", error);
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
    const { shipmentId } = body;

    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId, accountId: ctx.accountId },
    });

    if (!shipment) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    // Create or update filing to Filed
    const entryNumber = `5901-26-${shipment.shipmentNumber.split("-")[2] || "004872"}`;

    const filing = await db.customsFiling.create({
      data: {
        shipmentId,
        accountId: ctx.accountId,
        entryNumber,
        authority: "US Customs (CBP)",
        entryType: shipment.entryType,
        filingType: "ABI - Automated",
        filingStatus: "Filed",
        paymentStatus: "Paid",
        totalValue: 17750.0,
        totalDuties: 2850.0,
        totalTaxes: 13100.0,
        totalAmount: 16250.0,
        responses: {
          create: [
            {
              accountId: ctx.accountId,
              code: "ACK",
              title: "ACK - Acceptance",
              description: "Customs has accepted your entry summary.",
              status: "Accepted",
            },
          ],
        },
      },
      include: { responses: true },
    });

    await db.shipment.update({
      where: { id: shipmentId },
      data: { status: "Submitted" },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "customs_filing.submit",
      entity: "CustomsFiling",
      entityId: filing.id,
      metadata: { entryNumber },
    });

    return NextResponse.json({ filing }, { status: 201 });
  } catch (error) {
    console.error("POST /api/filing error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
