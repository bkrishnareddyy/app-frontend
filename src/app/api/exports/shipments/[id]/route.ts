import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    const exportShipment = await db.exportShipment.findFirst({
      where: { id, accountId: ctx.accountId },
      include: {
        documents: true,
        lineItems: true,
      },
    });

    if (!exportShipment) {
      return NextResponse.json({ error: "Export shipment not found" }, { status: 404 });
    }

    return NextResponse.json({ exportShipment });
  } catch (error) {
    console.error("GET /api/exports/shipments/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
