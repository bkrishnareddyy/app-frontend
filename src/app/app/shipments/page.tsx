import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
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
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch active team members if user is an enterprise admin
  let teamMembers: any[] = [];
  const isEnterpriseAdmin =
    ctx.accountType === "ENTERPRISE" &&
    (ctx.roleName === "ADMIN" || ctx.roleName === "OWNER");

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
    readinessScore: s.readinessScore,
    healthStatus: s.healthStatus,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
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
    lineItems: s.lineItems,
    customsFilings: s.customsFilings,
  }));

  return (
    <ShipmentsWorkbenchClient
      initialShipments={formattedShipments}
      teamMembers={teamMembers}
      context={{
        userId: ctx.userId,
        roleName: ctx.roleName,
        accountType: ctx.accountType,
        accountName: ctx.accountName,
        firstName: ctx.firstName,
        lastName: ctx.lastName,
        email: ctx.email,
      }}
    />
  );
}
