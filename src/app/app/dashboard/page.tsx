import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeReadinessScore } from "@/lib/shipmentReadiness";
import { CommandCenterClient } from "./CommandCenterClient";

export default async function CommandCenterPage() {
  const context = await getAccountContext();
  if (!context) return null;

  const accountId = context.accountId;

  // Fetch all shipments for active tenant account, including broker assignment
  const shipments = await db.shipment.findMany({
    where: { accountId, deletedAt: null },
    include: {
      assignedBroker: true,
      documents: true,
      lineItems: true,
      exceptionItems: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch all decisions for active tenant account. Broker assignment comes from
  // the parent shipment so the client can scope KPIs to selected team members.
  const decisions = await db.agentDecision.findMany({
    where: { accountId },
    select: {
      id: true,
      agentName: true,
      status: true,
      confidence: true,
      decisionSummary: true,
      shipmentId: true,
      shipment: { select: { assignedBrokerId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch active team members if user is an enterprise admin
  let teamMembers: Array<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }> = [];
  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

  if (isEnterpriseAdmin) {
    const memberships = await db.accountMembership.findMany({
      where: { accountId, status: "ACTIVE" },
      include: { user: true },
    });
    teamMembers = memberships.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
    }));
  }

  // Serialize models safely for client component props
  const formattedShipments = shipments.map((s) => {
    // readinessScore is a static column default, never updated as
    // documents/line items/exceptions change -- compute the real figure.
    const readinessScore = computeReadinessScore(s);
    // Primary HTS code and entered value were previously a hardcoded literal
    // and (readinessScore * 500) respectively -- neither reflected the
    // shipment's actual line items. Both are derived from real line items and
    // stay null when there are none, so the UI can render a missing state.
    const primaryLineItem = [...s.lineItems].sort(
      (a, b) => Number(b.totalValue) - Number(a.totalValue)
    )[0];
    return {
      id: s.id,
      shipmentNumber: s.shipmentNumber,
      referenceNumber: s.poReference,
      importerName: s.importerName,
      countryOfExport: s.countryOfExport,
      primaryHtsCode: primaryLineItem?.htsCode ?? null,
      totalValue:
        s.lineItems.length === 0
          ? null
          : s.lineItems.reduce((sum, li) => sum + Number(li.totalValue), 0),
      readinessScore,
      status: s.status,
      healthStatus: s.healthStatus,
      riskScore: s.riskScore,
      assignedBrokerId: s.assignedBrokerId,
      assignedBroker: s.assignedBroker
        ? {
            id: s.assignedBroker.id,
            firstName: s.assignedBroker.firstName,
            lastName: s.assignedBroker.lastName,
          }
        : null,
    };
  });

  const formattedDecisions = decisions.map((d) => ({
    id: d.id,
    agentName: d.agentName,
    status: d.status,
    confidence: d.confidence,
    decisionSummary: d.decisionSummary,
    shipmentId: d.shipmentId,
    assignedBrokerId: d.shipment?.assignedBrokerId ?? null,
  }));

  return (
    <CommandCenterClient
      accountName={context.accountName}
      initialShipments={formattedShipments}
      initialDecisions={formattedDecisions}
      teamMembers={teamMembers}
      context={{
        userId: context.userId,
        roleNames: context.roleNames,
        accountType: context.accountType,
        accountName: context.accountName,
        firstName: context.firstName,
        lastName: context.lastName,
        email: context.email,
      }}
    />
  );
}
