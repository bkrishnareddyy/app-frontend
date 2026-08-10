import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeReadinessScore } from "@/lib/shipmentReadiness";
import { ShipmentsWorkbenchClient } from "./ShipmentsWorkbenchClient";

export default async function ShipmentsConsolePage() {
  const ctx = await getAccountContext();
  if (!ctx) {
    return null;
  }

  // Fetch all shipments for active tenant account, including relations
  const shipments = await db.shipment.findMany({
    where: { accountId: ctx.accountId, deletedAt: null },
    include: {
      documents: true,
      lineItems: true,
      customsFilings: true,
      assignedBroker: true,
      exceptionItems: true,
      client: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const clients = await db.client.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { name: "asc" },
  });

  // Fetch active team members if user is an enterprise admin
  let teamMembers: any[] = [];
  const isEnterpriseAdmin =
    ctx.accountType === "ENTERPRISE" &&
    (ctx.roleNames.includes("ADMIN") || ctx.roleNames.includes("OWNER"));

  if (isEnterpriseAdmin) {
    const memberships = await db.accountMembership.findMany({
      where: { accountId: ctx.accountId, status: "ACTIVE" },
      include: { user: true },
    });
    teamMembers = memberships.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
    }));
  }

  // Formatted shipments to fit client component props (ensures Next.js serialization compatibility)
  const formattedShipments = shipments.map((s) => ({
    id: s.id,
    shipmentNumber: s.shipmentNumber,
    importerName: s.importerName,
    countryOfExport: s.countryOfExport,
    entryType: s.entryType,
    poReference: s.poReference,
    portOfEntry: s.portOfEntry,
    carrierName: s.carrierName,
    // readinessScore is a static column default, never updated as
    // documents/line items/exceptions change -- compute the real figure.
    readinessScore: computeReadinessScore(s),
    healthStatus: s.healthStatus,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    clientId: s.clientId,
    client: s.client ? { id: s.client.id, name: s.client.name } : null,
    assignedBrokerId: s.assignedBrokerId,
    assignedBroker: s.assignedBroker
      ? {
          id: s.assignedBroker.id,
          firstName: s.assignedBroker.firstName,
          lastName: s.assignedBroker.lastName,
          email: s.assignedBroker.email,
        }
      : null,
    documents: s.documents.map((d) => ({
      id: d.id,
      docType: d.docType,
      fileName: d.fileName,
      pageCount: d.pageCount,
      confidence: d.confidence,
      status: d.status,
      fileUrl: d.fileUrl,
    })),
    lineItems: s.lineItems.map((li) => ({
      ...li,
      unitPrice: Number(li.unitPrice),
      totalValue: Number(li.totalValue),
      createdAt: li.createdAt.toISOString(),
      updatedAt: li.updatedAt.toISOString(),
    })),
    customsFilings: s.customsFilings.map((cf) => ({
      ...cf,
      totalValue: Number(cf.totalValue),
      totalDuties: Number(cf.totalDuties),
      totalTaxes: Number(cf.totalTaxes),
      totalAmount: Number(cf.totalAmount),
      submittedAt: cf.submittedAt ? cf.submittedAt.toISOString() : null,
      releasedAt: cf.releasedAt ? cf.releasedAt.toISOString() : null,
      createdAt: cf.createdAt.toISOString(),
      updatedAt: cf.updatedAt.toISOString(),
    })),
  }));

  return (
    <ShipmentsWorkbenchClient
      initialShipments={formattedShipments}
      teamMembers={teamMembers}
      clients={clients.map((c) => ({ id: c.id, name: c.name }))}
      context={{
        userId: ctx.userId,
        roleNames: ctx.roleNames,
        accountType: ctx.accountType,
        accountName: ctx.accountName,
        firstName: ctx.firstName,
        lastName: ctx.lastName,
        email: ctx.email,
      }}
    />
  );
}
