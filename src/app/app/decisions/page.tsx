import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { DecisionReviewClient } from "./DecisionReviewClient";

export default async function DecisionReviewCenterPage(props: {
  searchParams: Promise<{ shipmentId?: string; decisionId?: string; agentName?: string }>;
}) {
  const searchParams = await props.searchParams;
  const context = await getAccountContext();
  if (!context) return null;

  // When arriving scoped to a shipment (e.g. from that shipment's Exceptions
  // panel), filter to just that shipment's decisions -- previously this
  // query always loaded every decision account-wide and only used the
  // shipmentId client-side as a best-effort initial selection, which meant
  // a shipment with no decisions of its own silently fell back to showing
  // an unrelated shipment's decision and documents.
  const decisions = await db.agentDecision.findMany({
    where: {
      accountId: context.accountId,
      ...(searchParams.shipmentId ? { shipmentId: searchParams.shipmentId } : {}),
    },
    include: {
      shipment: {
        include: {
          documents: true,
          lineItems: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const allDocuments = await db.shipmentDocument.findMany({
    where: {
      shipment: { accountId: context.accountId },
      ...(searchParams.shipmentId ? { shipmentId: searchParams.shipmentId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  // Convert Decimal and complex objects to plain objects for Client Component handoff
  const serializedDecisions = JSON.parse(JSON.stringify(decisions));
  const serializedDocuments = JSON.parse(JSON.stringify(allDocuments));

  return (
    <DecisionReviewClient
      decisions={serializedDecisions}
      allDocuments={serializedDocuments}
      initialDecisionId={searchParams.decisionId}
      initialShipmentId={searchParams.shipmentId}
      initialAgentName={searchParams.agentName}
    />
  );
}
