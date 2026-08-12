import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { allCapabilityStatuses } from "@/modules/product/productIntelligence";

/**
 * What the product master can and cannot do for you today.
 *
 * Classification proposal, origin determination and regulatory screening are
 * extension points with no provider registered. This endpoint reports that
 * plainly so a caller — or a screen — states "not connected" rather than
 * implying a capability that would have to be faked to answer.
 */
export const GET = withAuthenticatedRoute(async ({ requestId }) => {
  return NextResponse.json({ capabilities: allCapabilityStatuses(), requestId });
});
