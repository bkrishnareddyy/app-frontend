import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { DecisionReviewClient } from "./DecisionReviewClient";

export default async function DecisionReviewCenterPage(props: {
  searchParams: Promise<{ shipmentId?: string; decisionId?: string }>;
}) {
  const searchParams = await props.searchParams;
  const context = await getAccountContext();
  if (!context) return null;

  const decisions = await db.agentDecision.findMany({
    where: { accountId: context.accountId },
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
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <DecisionReviewClient
      decisions={decisions}
      allDocuments={allDocuments}
      initialDecisionId={searchParams.decisionId}
      initialShipmentId={searchParams.shipmentId}
    />
  );
}
