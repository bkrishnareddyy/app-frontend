import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

async function ensureEmbargoesSeeded() {
  const count = await db.embargoRule.count();
  if (count === 0) {
    await db.embargoRule.createMany({
      data: [
        {
          countryCode: "CU",
          countryName: "Cuba",
          regime: "Comprehensive Sanctions",
          restriction: "Total trade embargo under 31 CFR Part 515 (CACR)",
        },
        {
          countryCode: "IR",
          countryName: "Iran",
          regime: "Comprehensive Sanctions",
          restriction: "Total trade embargo under 31 CFR Part 560 (ITSR)",
        },
        {
          countryCode: "KP",
          countryName: "North Korea",
          regime: "Comprehensive Sanctions",
          restriction: "Total trade embargo under 31 CFR Part 510 (NKSR)",
        },
        {
          countryCode: "UFLPA_XINJIANG",
          countryName: "China (Xinjiang Region)",
          regime: "UFLPA Forced Labor Presumption",
          restriction: "Rebuttable presumption of forced labor under Uyghur Forced Labor Prevention Act (UFLPA)",
        },
      ],
      skipDuplicates: true,
    });
  }
}

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  await ensureEmbargoesSeeded();

  const body = await req.json();
  const { countryOfOrigin, transshipmentPort, manufacturerLocation } = body;

  const rules = await db.embargoRule.findMany();
  const matchedRules = [];

  for (const rule of rules) {
    if (
      (countryOfOrigin && countryOfOrigin.toLowerCase().includes(rule.countryName.toLowerCase())) ||
      (transshipmentPort && transshipmentPort.toLowerCase().includes(rule.countryName.toLowerCase())) ||
      (manufacturerLocation && manufacturerLocation.toLowerCase().includes(rule.countryName.toLowerCase()))
    ) {
      matchedRules.push(rule);
    }
  }

  const isEmbargoed = matchedRules.length > 0;

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "screening.embargo",
    entity: "EmbargoRule",
    entityId: ctx.accountId,
    metadata: { countryOfOrigin, isEmbargoed, matchedCount: matchedRules.length },
  });

  return NextResponse.json({
    embargoResult: {
      countryOfOrigin,
      isEmbargoed,
      status: isEmbargoed ? "BLOCKED_SANCTIONED_REGION" : "CLEARED",
      matchedRules,
      actionRequired: isEmbargoed ? "Obtain specific OFAC/CBP authorization license before entry filing." : "None",
    },
  });
});
