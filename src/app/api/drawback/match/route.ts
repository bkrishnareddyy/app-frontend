import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { matchMethod } = body; // FIFO | LIFO | specific_identification

    const importLineItems = await db.shipmentLineItem.findMany({
      where: { accountId: ctx.accountId },
      include: { shipment: true },
    });

    const exportLineItems = await db.exportLineItem.findMany({
      where: { accountId: ctx.accountId },
      include: { exportShipment: true },
    });

    const proposedMatches = [];

    for (const expItem of exportLineItems) {
      const matchingImport = importLineItems.find((imp) => imp.htsCode === expItem.htsCode || imp.partNumber === expItem.partNumber);
      if (matchingImport) {
        const matchedQuantity = Math.min(matchingImport.quantity, expItem.quantity);
        const estimatedDutyAttributed = Math.round((matchedQuantity * matchingImport.unitPrice * 0.035 * 0.99) * 100) / 100; // 99% duty drawback refund rate

        proposedMatches.push({
          shipmentLineItemId: matchingImport.id,
          exportLineItemId: expItem.id,
          htsCode: expItem.htsCode,
          partNumber: expItem.partNumber,
          matchedQuantity,
          matchMethod: matchMethod || "FIFO",
          dutyAttributed: estimatedDutyAttributed,
          importShipmentNumber: matchingImport.shipment.shipmentNumber,
          exportShipmentNumber: expItem.exportShipment.exportShipmentNumber,
        });
      }
    }

    return NextResponse.json({
      proposedMatchesCount: proposedMatches.length,
      proposedMatches,
    });
  } catch (error) {
    console.error("POST /api/drawback/match error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
