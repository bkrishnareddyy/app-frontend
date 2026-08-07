import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

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
