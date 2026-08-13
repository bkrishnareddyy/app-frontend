import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";

// Scan is intentionally a no-op until a real refund calculation engine exists.
// The previous version multiplied totalDuties by 0.4 or 0.15 depending on
// country of origin — heuristics with no statutory basis that produced
// fabricated numbers an importer might act on. No fake numbers.
export const POST = withAuthenticatedRoute(async ({ requestId }) => {
  return NextResponse.json({
    opportunitiesCreatedCount: 0,
    opportunities: [],
    message: "Automated refund identification requires a real calculation engine. No opportunities were generated.",
    requestId,
  });
}, { write: true });
