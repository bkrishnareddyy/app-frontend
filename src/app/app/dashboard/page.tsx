import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { CommandCenterClient } from "./CommandCenterClient";

export default async function CommandCenterPage() {
  const context = await getAccountContext();
  if (!context) return null;

  const accountId = context.accountId;

  // Fetch all shipments for active tenant account, including broker assignment
  const shipments = await db.shipment.findMany({
    where: { accountId, deletedAt: null },
    include: {
      agentDecisions: true,
      customsFilings: true,
      assignedBroker: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch all decisions for active tenant account
  const decisions = await db.agentDecision.findMany({
    where: { accountId },
    include: {
      shipment: {
        select: {
          assignedBrokerId: true,
        },
      },
    },
  });

  // Fetch active team members if user is an enterprise admin
  let teamMembers: any[] = [];
  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleName === "ADMIN" || context.roleName === "OWNER");

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

  // Dynamic Regulatory Intelligence Updates
  const regUpdates = await db.regulatoryUpdate.findMany({
    take: 3,
    orderBy: { effectiveDate: "desc" },
  });

  // Serialize models safely for client component props
  const formattedShipments = shipments.map((s) => ({
    id: s.id,
    shipmentNumber: s.shipmentNumber,
    referenceNumber: s.poReference,
    exporterName: s.importerName, // matches previous fallback naming
    primaryHtsCode: "7318.15.2065", // fallback
    totalValue: s.readinessScore * 500, // mock fallback matches previous layout
    readinessScore: s.readinessScore,
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
  }));

  const formattedDecisions = decisions.map((d) => ({
    id: d.id,
    status: d.status,
    assignedBrokerId: d.shipment?.assignedBrokerId || null,
  }));

  const formattedRegUpdates = regUpdates.map((ru) => ({
    id: ru.id,
    title: ru.title,
    summary: ru.description,
    effectiveDate: ru.effectiveDate.toISOString(),
  }));

  return (
    <CommandCenterClient
      accountName={context.accountName}
      initialShipments={formattedShipments}
      initialDecisions={formattedDecisions}
      regUpdates={formattedRegUpdates}
      teamMembers={teamMembers}
      context={{
        userId: context.userId,
        roleName: context.roleName,
        accountType: context.accountType,
        accountName: context.accountName,
        firstName: context.firstName,
        lastName: context.lastName,
        email: context.email,
      }}
    />
  );
}
