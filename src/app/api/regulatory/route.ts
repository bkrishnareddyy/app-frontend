import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async () => {
  const updates = await db.regulatoryUpdate.findMany({
    orderBy: { effectiveDate: "desc" },
  });

  return NextResponse.json({ updates });
});
