import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeReadinessScore } from "@/lib/shipmentReadiness";
import { checkRequiredDocumentTypes } from "@/lib/requiredDocumentTypes";
import { CommandCenterClient } from "./CommandCenterClient";
import type { TeamMember } from "@/lib/team";

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
      documents: true,
      lineItems: true,
      exceptionItems: true,
      client: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const clients = await db.client.findMany({
    where: { accountId },
    orderBy: { name: "asc" },
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
  let teamMembers: TeamMember[] = [];
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

  // Dynamic Regulatory Intelligence Updates
  const regUpdates = await db.regulatoryUpdate.findMany({
    take: 3,
    orderBy: { effectiveDate: "desc" },
  });

  // Serialize models safely for client component props
  const formattedShipments = shipments.map((s) => {
    // readinessScore is a static column default, never updated as
    // documents/line items/exceptions change -- compute the real figure.
    const readinessScore = computeReadinessScore(s);
    // Primary HTS code and entered value were previously a hardcoded literal
    // and (readinessScore * 500) respectively -- neither reflected the
    // shipment's actual line items. Derive both from real data instead.
    const primaryLineItem = [...s.lineItems].sort(
      (a, b) => Number(b.totalValue) - Number(a.totalValue)
    )[0];
    const totalValue = s.lineItems.reduce((sum, li) => sum + Number(li.totalValue), 0);
    // Same "required document types" definition as the shipment detail page
    // (Certificate of Origin only required when a preferential-tariff HTS
    // code is present), so My Work's Pending column always agrees with it.
    const includeCertificateOfOrigin =
      s.documents.length === 0 || s.lineItems.some((li) => li.htsCode?.startsWith("02"));
    const docCheck = checkRequiredDocumentTypes(s.documents, includeCertificateOfOrigin);
    return {
      id: s.id,
      shipmentNumber: s.shipmentNumber,
      referenceNumber: s.poReference,
      exporterName: s.importerName, // matches previous fallback naming
      primaryHtsCode: primaryLineItem?.htsCode ?? "Not Yet Classified",
      totalValue,
      readinessScore,
      status: s.status,
      healthStatus: s.healthStatus,
      riskScore: s.riskScore,
      clientId: s.clientId,
      client: s.client ? { id: s.client.id, name: s.client.name } : null,
      assignedBrokerId: s.assignedBrokerId,
      assignedBroker: s.assignedBroker
        ? {
            id: s.assignedBroker.id,
            firstName: s.assignedBroker.firstName,
            lastName: s.assignedBroker.lastName,
          }
        : null,
      estimatedArrival: s.estimatedArrival ? s.estimatedArrival.toISOString() : null,
      requiredDocTypes: docCheck.requiredTypes,
      missingDocTypes: docCheck.missingTypes,
      receivedDocCount: docCheck.receivedCount,
      totalRequiredDocs: docCheck.totalRequired,
    };
  });

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
      clients={clients.map((c) => ({ id: c.id, name: c.name }))}
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
