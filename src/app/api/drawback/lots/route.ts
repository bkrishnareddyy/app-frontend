import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const lots = await db.drawbackLot.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { exportDeadline: "asc" },
  });

  return NextResponse.json({
    lots: lots.map((l) => ({
      id: l.id,
      entryNumber: l.entryNumber,
      htsCode: l.htsCode,
      quantity: Number(l.quantity),
      availableQty: Number(l.availableQty),
      dutyPaidPerUnit: Number(l.dutyPaidPerUnit),
      exportDeadline: l.exportDeadline.toISOString().split("T")[0],
      hasSection301: l.hasSection301,
      section301List: l.section301List,
    })),
  });
});
