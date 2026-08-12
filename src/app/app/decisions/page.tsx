import { permanentRedirect } from "next/navigation";

// /app/decisions is superseded by the unified /app/actions inbox.
// Forward deep links so bookmarks and email notifications continue to work.
export default async function DecisionReviewCenterPage(props: {
  searchParams: Promise<{ shipmentId?: string; decisionId?: string; agentName?: string }>;
}) {
  const searchParams = await props.searchParams;
  const params = new URLSearchParams();
  if (searchParams.decisionId) params.set("decisionId", searchParams.decisionId);
  if (searchParams.shipmentId) params.set("shipmentId", searchParams.shipmentId);
  permanentRedirect(`/app/actions${params.size > 0 ? `?${params}` : ""}`);
}
