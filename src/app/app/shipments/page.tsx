import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeReadinessScore } from "@/lib/shipmentReadiness";
import { ShipmentsWorkbenchClient } from "./ShipmentsWorkbenchClient";
import type { TeamMember } from "@/lib/team";

export default async function ShipmentsConsolePage() {
  const ctx = await getAccountContext();
  if (!ctx) {
    return null;
  }

  // A stopgap cap, not real pagination: the workbench's KPI tiles and
  // client-side search/filters are documented as reading the *whole* filtered
  // set (see ShipmentsWorkbenchClient's pagination comment), so this only
  // bounds the worst case rather than truly paginating at the query level.
  const SHIPMENT_ROW_CAP = 500;

  // Select only the columns ShipmentsWorkbenchClient actually reads, plus
  // documents/lineItems/exceptionItems for computeReadinessScore below. The
  // previous `include: { ...: true }` pulled full rows -- including
  // customsFilings and lineItems, neither of which the client component
  // reads (see its own "not read by this screen" comment) -- for every
  // shipment on every page load.
  const shipments = await db.shipment.findMany({
    where: { accountId: ctx.accountId, deletedAt: null },
    select: {
      id: true,
      shipmentNumber: true,
      importerName: true,
      countryOfExport: true,
      entryType: true,
      poReference: true,
      portOfEntry: true,
      carrierName: true,
      incoterm: true,
      status: true,
      healthStatus: true,
      createdAt: true,
      clientId: true,
      client: { select: { id: true, name: true } },
      assignedBrokerId: true,
      assignedBroker: { select: { id: true, firstName: true, lastName: true, email: true } },
      // computeReadinessScore's inputs -- not sent to the client, only used
      // to derive the readinessScore scalar below.
      documents: { select: { docType: true, status: true } },
      lineItems: { select: { htsCode: true, countryOfOrigin: true, quantity: true, unitPrice: true } },
      exceptionItems: { select: { status: true, severity: true } },
    },
    orderBy: { createdAt: "desc" },
    take: SHIPMENT_ROW_CAP,
  });

  const clients = await db.client.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { name: "asc" },
  });

  // Fetch active team members if user is an enterprise admin
  let teamMembers: TeamMember[] = [];
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

  // ISF and Entry Filing deadlines per shipment for the dedicated table columns.
  const deadlineRows = await db.complianceDeadline.findMany({
    where: { accountId: ctx.accountId, type: { in: ["ISF_10_2", "ENTRY_FILING"] },
             status: { in: ["OPEN", "SATISFIED", "MISSED"] } },
    select: { type: true, dueAt: true, status: true, estimated: true,
              shipment: { select: { shipmentNumber: true } } },
    orderBy: { dueAt: "asc" },
  });
  type DeadlineInfo = { dueAt: string | null; status: string; estimated: boolean };
  const deadlinesByShipment: Record<string, { isf?: DeadlineInfo; entryFiling?: DeadlineInfo }> = {};
  for (const d of deadlineRows) {
    const num = d.shipment?.shipmentNumber;
    if (!num) continue;
    if (!deadlinesByShipment[num]) deadlinesByShipment[num] = {};
    const info: DeadlineInfo = { dueAt: d.dueAt?.toISOString() ?? null, status: d.status, estimated: d.estimated };
    if (d.type === "ISF_10_2" && !deadlinesByShipment[num].isf) deadlinesByShipment[num].isf = info;
    if (d.type === "ENTRY_FILING" && !deadlinesByShipment[num].entryFiling) deadlinesByShipment[num].entryFiling = info;
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
    // documents/lineItems/customsFilings are deliberately not serialized here:
    // ShipmentsWorkbenchClient never reads them (see its own prop-type
    // comment) -- only the computed readinessScore above is used.
  }));

  return (
    <ShipmentsWorkbenchClient
      initialShipments={formattedShipments}
      deadlinesByShipment={deadlinesByShipment}
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
