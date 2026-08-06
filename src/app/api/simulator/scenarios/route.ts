import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function GET(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const scenarios = await db.landedCostScenario.findMany({
      where: { accountId: ctx.accountId },
      include: {
        lineItems: {
          include: { htsCode: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ scenarios });
  } catch (error) {
    console.error("GET /api/simulator/scenarios error:", error);
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
    const { name, originCountry, destinationPort, incoterm, currency } = body;

    if (!name) {
      return NextResponse.json({ error: "Scenario name is required" }, { status: 400 });
    }

    const scenario = await db.landedCostScenario.create({
      data: {
        accountId: ctx.accountId,
        name,
        originCountry: originCountry || "China",
        destinationPort: destinationPort || "Port of Long Beach (2709)",
        incoterm: incoterm || "CIF",
        currency: currency || "USD",
        createdByUserId: ctx.userId,
        status: "Draft",
      },
      include: { lineItems: true },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "simulator.scenario_create",
      entity: "LandedCostScenario",
      entityId: scenario.id,
      metadata: { name },
    });

    return NextResponse.json({ scenario }, { status: 201 });
  } catch (error) {
    console.error("POST /api/simulator/scenarios error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
