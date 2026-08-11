import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { matchesRule } from "@/lib/screening/embargoMatch";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { countryOfOrigin, transshipmentPort, manufacturerLocation } = body;

  const rules = await db.embargoRule.findMany();

  // No rules loaded means nothing was checked. "CLEARED" would be a false all-clear.
  if (rules.length === 0) {
    return NextResponse.json(
      {
        embargoResult: {
          countryOfOrigin,
          isEmbargoed: null,
          status: "NOT_SCREENED",
          matchedRules: [],
          actionRequired:
            "No embargo rules are loaded, so this shipment has not been screened against OFAC country sanctions or UFLPA.",
        },
      },
      { status: 503 }
    );
  }

  const matchedRules = [];

  for (const rule of rules) {
    if (
      matchesRule(countryOfOrigin, rule) ||
      matchesRule(transshipmentPort, rule) ||
      matchesRule(manufacturerLocation, rule)
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
}, { write: true });
