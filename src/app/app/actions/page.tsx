import { redirect } from "next/navigation";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { canWrite } from "@/lib/api/write-access";
import { db } from "@/lib/db";
import { groupDecisions } from "@/modules/decisions/groupDecisions";
import { buildShipmentActionGroups } from "@/modules/actions/shipmentActions";
import { DECISION_ACTIONABLE_STATUSES, buildWorkQueue, filterWorkQueue, parseWorkFilter } from "@/modules/work/workQueue";
import { loadWorkQueueForAccount } from "@/modules/work/workQueueLoader";
import { RISK_ACCEPTANCE_PERMISSION, openStatusVariants } from "@/modules/exceptions/exceptionState";
import { ActionsClient } from "./ActionsClient";

export const dynamic = "force-dynamic";

const exceptionSelect = {
  id: true,
  type: true,
  severity: true,
  description: true,
  status: true,
  version: true,
  createdAt: true,
  resolvedAt: true,
  shipmentId: true,
  filingId: true,
  assignedToUserId: true,
  shipment: {
    select: {
      id: true,
      shipmentNumber: true,
      assignedBrokerId: true,
      assignedBroker: { select: { id: true, firstName: true, lastName: true, email: true } },
      client: { select: { id: true, name: true } },
    },
  },
  assignedToUser: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

export default async function ActionsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const shipmentId =
    typeof searchParams.shipmentId === "string" ? searchParams.shipmentId : undefined;

  const [decisions, allDocuments, exceptions] = await Promise.all([
    db.agentDecision.findMany({
      where: {
        accountId: context.accountId,
        // DECISION_ACTIONABLE_STATUSES now covers every legacy status string
        // that maps to NEEDS_REVIEW or BLOCKED. "Approved" is still included so
        // brokers can see recently-approved decisions in the verified section.
        status: { in: [...DECISION_ACTIONABLE_STATUSES, "Approved", "AUTO_VERIFIED", "Auto-Approved", "Verified"] },
        ...(shipmentId ? { shipmentId } : {}),
      },
      // Explicit select to avoid triageState/blockedReason/autoApprovalPolicy which
      // are in the Prisma schema but not yet applied to the live DB (migration pending).
      select: {
        id: true,
        accountId: true,
        agentName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        decisionSummary: true,
        humanNotes: true,
        currentHtsCode: true,
        proposedHtsCode: true,
        proposedDescription: true,
        evidenceItems: true,
        shipmentId: true,
        documentId: true,
        lineNumber: true,
        confidence: true,
        shipment: {
          select: {
            id: true,
            shipmentNumber: true,
            documents: { select: { id: true, docType: true, fileName: true, status: true, fileUrl: true, extractedJson: true, shipmentId: true, createdAt: true, updatedAt: true } },
            lineItems: { select: { id: true, lineNumber: true, htsCode: true, description: true, quantity: true, unitPrice: true, totalValue: true, countryOfOrigin: true, status: true } },
            assignedBrokerId: true,
            assignedBroker: { select: { id: true, firstName: true, lastName: true, email: true } },
            client: { select: { id: true, name: true } },
          },
        },
        reviewedByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.shipmentDocument.findMany({
      where: {
        shipment: { accountId: context.accountId },
        ...(shipmentId ? { shipmentId } : {}),
      },
      orderBy: { createdAt: "desc" },
    }),
    db.exceptionItem.findMany({
      where: {
        accountId: context.accountId,
        status: { in: openStatusVariants() },
        shipmentId: { not: null },
        ...(shipmentId ? { shipmentId } : {}),
      },
      select: exceptionSelect,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const [writable, mayWaive, queueLoaderResult] = await Promise.all([
    Promise.resolve(canWrite(context)),
    hasPermission(RISK_ACCEPTANCE_PERMISSION).then((ok) => canWrite(context) && ok),
    loadWorkQueueForAccount(context.accountId, context.userId, { shipmentId }),
  ]);

  const serializedDecisions = JSON.parse(JSON.stringify(decisions));
  const serializedDocuments = JSON.parse(JSON.stringify(allDocuments));
  const serializedExceptions = JSON.parse(JSON.stringify(exceptions));

  const decisionGroups = groupDecisions(serializedDecisions, serializedDocuments);
  const groups = buildShipmentActionGroups(decisionGroups, serializedExceptions);

  // Build the ordered work queue — first production call to buildWorkQueue.
  // The queue drives ordering and urgency display; groups drive the detailed
  // review UI. Both are passed so ActionsClient can show countdown chips.
  const workQueueParams = new URLSearchParams(
    Object.entries(searchParams)
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => [k, v as string])
  );
  const workFilter = parseWorkFilter(workQueueParams);
  const workQueue = buildWorkQueue(queueLoaderResult.input);
  const filteredQueue = filterWorkQueue(workQueue, workFilter);

  const firstName = context.firstName ?? null;
  const lastName = context.lastName ?? null;
  const userName = [firstName, lastName].filter(Boolean).join(" ") || context.email;

  const documents = serializedDocuments.map((d: { id: string; fileName: string; fileUrl: string | null }) => ({
    id: d.id,
    fileName: d.fileName,
    fileUrl: d.fileUrl ?? null,
  }));

  // Serialize the urgency map (shipmentId → most-urgent deadline) so the
  // client can render countdown chips without its own DB access.
  const urgencyByShipment = Object.fromEntries(
    filteredQueue
      .filter((item) => item.urgency != null && item.shipmentNumber != null)
      .map((item) => [
        item.shipmentNumber!,
        {
          deadlineType: item.urgency!.deadlineType,
          dueAt: item.urgency!.dueAt.toISOString(),
          msRemaining: item.urgency!.msRemaining,
          breached: item.urgency!.breached,
          estimated: item.urgency!.estimated,
          exposureUsd: item.urgency!.exposureUsd,
        },
      ])
  );

  return (
    <ActionsClient
      groups={groups}
      canWrite={writable}
      canWaive={mayWaive}
      initialShipmentId={shipmentId}
      userId={context.userId}
      userName={userName}
      documents={documents}
      urgencyByShipment={urgencyByShipment}
    />
  );
}
