import { redirect } from "next/navigation";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { canWrite } from "@/lib/api/write-access";
import { db } from "@/lib/db";
import { groupDecisions } from "@/modules/decisions/groupDecisions";
import { buildShipmentActionGroups } from "@/modules/actions/shipmentActions";
import { DECISION_ACTIONABLE_STATUSES } from "@/modules/work/workQueue";
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
        status: { in: [...DECISION_ACTIONABLE_STATUSES, "Approved"] },
        ...(shipmentId ? { shipmentId } : {}),
      },
      include: {
        shipment: {
          include: {
            documents: true,
            lineItems: true,
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

  const writable = canWrite(context);
  const mayWaive = writable && (await hasPermission(RISK_ACCEPTANCE_PERMISSION));

  const serializedDecisions = JSON.parse(JSON.stringify(decisions));
  const serializedDocuments = JSON.parse(JSON.stringify(allDocuments));
  const serializedExceptions = JSON.parse(JSON.stringify(exceptions));

  const decisionGroups = groupDecisions(serializedDecisions, serializedDocuments);
  const groups = buildShipmentActionGroups(decisionGroups, serializedExceptions);

  const firstName = context.firstName ?? null;
  const lastName = context.lastName ?? null;
  const userName = [firstName, lastName].filter(Boolean).join(" ") || context.email;

  const documents = serializedDocuments.map((d: { id: string; fileName: string; fileUrl: string | null }) => ({
    id: d.id,
    fileName: d.fileName,
    fileUrl: d.fileUrl ?? null,
  }));

  return (
    <ActionsClient
      groups={groups}
      canWrite={writable}
      canWaive={mayWaive}
      initialShipmentId={shipmentId}
      userId={context.userId}
      userName={userName}
      documents={documents}
    />
  );
}
