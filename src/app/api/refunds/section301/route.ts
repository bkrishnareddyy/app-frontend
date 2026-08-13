import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { Decimal } from "@/lib/tariff/decimal";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const accountId = ctx.accountId;

  // 1. Fetch filings from accepted snapshots that have Section 301 duties
  const filings = await db.customsFiling.findMany({
    where: {
      accountId,
      filingStatus: { in: ["Accepted", "Closed"] },
    },
    include: { snapshot: true },
  });

  let totalEntries = 0;
  let totalDutyPaid = new Decimal(0);
  const byListMap = new Map<string, { entries: number; dutyPaid: Decimal }>();

  // Initialize lists
  const LISTS = ["List1", "List2", "List3", "List4A", "List4B"];
  for (const list of LISTS) {
    byListMap.set(list, { entries: 0, dutyPaid: new Decimal(0) });
  }

  for (const filing of filings) {
    // If snapshot has Section 301 flagged, accumulate
    if (filing.snapshot && filing.snapshot.hasSection301) {
      totalEntries++;
      const duty = new Decimal(filing.totalDuties || 0);
      totalDutyPaid = totalDutyPaid.plus(duty);

      const listName = filing.snapshot.section301List || "List3";
      const current = byListMap.get(listName) || { entries: 0, dutyPaid: new Decimal(0) };
      byListMap.set(listName, {
        entries: current.entries + 1,
        dutyPaid: current.dutyPaid.plus(duty),
      });
    }
  }

  const byList = Array.from(byListMap.entries()).map(([list, data]) => ({
    list,
    entries: data.entries,
    dutyPaid: data.dutyPaid.toNumber(),
  }));

  return NextResponse.json({
    totalEntries,
    totalDutyPaid: totalDutyPaid.toNumber(),
    byList,
  });
});
