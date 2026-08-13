import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
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
});

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { name, originCountry, destinationPort, incoterm, currency } = body;

  if (!name) {
    return NextResponse.json({ error: "Scenario name is required" });
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
    source: "UI",
    metadata: { name },
  });

  return NextResponse.json({ scenario }, { status: 201 });

}, { permission: "intel.read", write: true });
