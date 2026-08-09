import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { DecisionReviewClient } from "./DecisionReviewClient";
import {
  buildDecisionOrderBy,
  buildDecisionWhere,
  decisionSkip,
  parseDecisionQuery,
} from "@/modules/decisions/decisionQuery";
import {
  APPROVE_PERMISSION,
  OVERRIDE_PERMISSION,
  REJECT_PERMISSION,
  RE_EVALUATE_PERMISSION,
  checkReviewPermission,
} from "@/modules/decisions/reviewAuthority";

export default async function DecisionReviewCenterPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const context = await getAccountContext();
  if (!context) return null;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }

  const query = parseDecisionQuery(params);
  const where = buildDecisionWhere(query, context.accountId);

  const decisionInclude = {
    shipment: {
      include: {
        documents: true,
        lineItems: true,
      },
    },
    reviewedByUser: {
      select: { firstName: true, lastName: true, email: true, brokerLicenseNumber: true },
    },
  };

  // The queue used to load every decision in the account together with each
  // decision's shipment, documents and line items, then filter in the browser.
  const [pageDecisions, total] = await Promise.all([
    db.agentDecision.findMany({
      where,
      include: decisionInclude,
      orderBy: buildDecisionOrderBy(query),
      skip: decisionSkip(query),
      take: query.pageSize,
    }),
    db.agentDecision.count({ where }),
  ]);

  // A deep link names one decision. If the current filter and page do not
  // contain it, load it explicitly: selecting whichever decision happened to be
  // first would open a different record under the requested link.
  const requestedDecisionId = params.get("decisionId");
  let decisions = pageDecisions;
  let requestedDecisionMissing = false;

  if (requestedDecisionId && !pageDecisions.some((d) => d.id === requestedDecisionId)) {
    const requested = await db.agentDecision.findFirst({
      where: { id: requestedDecisionId, accountId: context.accountId },
      include: decisionInclude,
    });
    if (requested) {
      decisions = [requested, ...pageDecisions];
    } else {
      requestedDecisionMissing = true;
    }
  }

  // The filter options come from the account's own decisions, so the list never
  // offers an agent or a status that has never occurred here.
  const [agentGroups, statusGroups] = await Promise.all([
    db.agentDecision.groupBy({
      by: ["agentName"],
      where: { accountId: context.accountId },
      orderBy: { agentName: "asc" },
    }),
    db.agentDecision.groupBy({
      by: ["status"],
      where: { accountId: context.accountId },
      orderBy: { status: "asc" },
    }),
  ]);

  // Documents are fetched for the shipments on this page only. Reading every
  // document in the account to resolve at most one preview per row scanned the
  // whole table to answer a question about one page.
  const shipmentIds = [
    ...new Set(decisions.map((d) => d.shipmentId).filter((id): id is string => !!id)),
  ];
  const allDocuments =
    shipmentIds.length === 0
      ? []
      : await db.shipmentDocument.findMany({
          where: { shipmentId: { in: shipmentIds }, shipment: { accountId: context.accountId } },
          orderBy: { createdAt: "desc" },
        });

  // Convert Decimal and complex objects to plain objects for Client Component handoff
  const serializedDecisions = JSON.parse(JSON.stringify(decisions));
  const serializedDocuments = JSON.parse(JSON.stringify(allDocuments));

  return (
    <DecisionReviewClient
      decisions={serializedDecisions}
      allDocuments={serializedDocuments}
      initialDecisionId={requestedDecisionMissing ? undefined : requestedDecisionId ?? undefined}
      requestedDecisionMissing={requestedDecisionMissing}
      initialShipmentId={params.get("shipmentId") ?? undefined}
      initialAgentName={params.get("agentName") ?? undefined}
      total={total}
      reviewPermissions={{
        approve: checkReviewPermission(context, [APPROVE_PERMISSION]).allowed,
        reject: checkReviewPermission(context, [REJECT_PERMISSION]).allowed,
        reEvaluate: checkReviewPermission(context, [RE_EVALUATE_PERMISSION]).allowed,
        override: checkReviewPermission(context, [OVERRIDE_PERMISSION]).allowed,
      }}
      query={{
        search: query.search,
        status: query.status,
        agentName: query.agentName,
        confidence: query.confidence,
        age: query.age,
        page: query.page,
        pageSize: query.pageSize,
      }}
      agentNames={agentGroups.map((g) => g.agentName)}
      statuses={statusGroups.map((g) => g.status)}
    />
  );
}

