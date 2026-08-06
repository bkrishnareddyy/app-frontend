import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: Request,
  context: { params: Promise<{ lineItemId: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { lineItemId } = await context.params;

    const lineItem = await db.shipmentLineItem.findFirst({
      where: { id: lineItemId, accountId: ctx.accountId },
    });

    if (!lineItem) {
      return NextResponse.json({ error: "Shipment line item not found" }, { status: 404 });
    }

    const originDeterminations = await db.originDetermination.findMany({
      where: { shipmentLineItemId: lineItemId },
      include: { tradeAgreement: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ originDeterminations });
  } catch (error) {
    console.error("GET /api/advisory/origin-determination/[lineItemId] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
