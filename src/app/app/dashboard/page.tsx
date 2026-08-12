import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeReadinessScore } from "@/lib/shipmentReadiness";
import { checkRequiredDocumentTypes } from "@/lib/requiredDocumentTypes";
import { extractedCurrency } from "@/modules/documents/extractedCurrency";
import { triageDecision } from "@/modules/decisions/decisionState";
import { CommandCenterClient } from "./CommandCenterClient";
import type { TeamMember } from "@/lib/team";

export default async function CommandCenterPage() {
  const context = await getAccountContext();
  if (!context) return null;

  const accountId = context.accountId;

  // A stopgap cap, not real pagination: the Command Center's KPI tiles and
  // client-side search are documented as reading the *whole* filtered set (see
  // CommandCenterClient's filter comment), so paginating the query would make
  // "Total: 25" mean "25 on this page" and let search miss off-page rows.
  // Moving KPIs/search server-side is the real fix; this cap only bounds the
  // worst case for now.
  const SHIPMENT_ROW_CAP = 500;

  // Fetch shipments for the active tenant account, selecting only the columns
  // this page's formatting actually reads. The previous `include: { ...: true
  // }` pulled every column of six relations per shipment -- including two
  // (agentDecisions, customsFilings) that formattedShipments below never uses
  // at all, and large text/JSON columns (documents.rawContent, lineItem
  // description, etc.) on the two relations that are used.
  const shipments = await db.shipment.findMany({
    where: { accountId, deletedAt: null },
    select: {
      id: true,
      shipmentNumber: true,
      poReference: true,
      importerName: true,
      entryType: true,
      incoterm: true,
      portOfEntry: true,
      countryOfExport: true,
      status: true,
      healthStatus: true,
      riskScore: true,
      clientId: true,
      client: { select: { id: true, name: true } },
      assignedBrokerId: true,
      assignedBroker: { select: { id: true, firstName: true, lastName: true } },
      estimatedArrival: true,
      // computeReadinessScore's inputs
      documents: { select: { docType: true, fileName: true, status: true, fileUrl: true, extractedJson: true } },
      lineItems: { select: { htsCode: true, countryOfOrigin: true, quantity: true, unitPrice: true, totalValue: true } },
      exceptionItems: { select: { status: true, severity: true } },
      agentDecisions: { select: { id: true, agentName: true, status: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: SHIPMENT_ROW_CAP,
  });

  const clients = await db.client.findMany({
    where: { accountId },
    orderBy: { name: "asc" },
  });

  // Fetch decisions for the active tenant account -- only the columns
  // formattedDecisions reads, not the full row (which includes an
  // `evidenceItems` JSON blob and several string-array columns per decision).
  const decisions = await db.agentDecision.findMany({
    where: { accountId },
    select: {
      id: true,
      status: true,
      shipment: {
        select: {
          assignedBrokerId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: SHIPMENT_ROW_CAP,
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
      userId: m.userId,
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

    const activeExceptions = (s.exceptionItems || []).filter(
      (e) => e.status !== "RESOLVED" && e.status !== "WAIVED" && e.status !== "Resolved"
    );
    const blockedExceptions = activeExceptions.filter(
      (e) => e.severity === "Critical" || e.severity === "High"
    );
    const openExceptions = activeExceptions.filter(
      (e) => e.severity !== "Critical" && e.severity !== "High"
    );

    const latestByAgent = new Map<string, typeof s.agentDecisions[number]>();
    for (const d of s.agentDecisions || []) {
      const existing = latestByAgent.get(d.agentName);
      if (!existing || new Date(d.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        latestByAgent.set(d.agentName, d);
      }
    }

    let blockedDecisions = 0;
    let needsReviewDecisions = 0;
    let verifiedDecisions = 0;

    for (const d of latestByAgent.values()) {
      const triage = triageDecision({ status: d.status });
      if (triage === "blocked") blockedDecisions++;
      else if (triage === "review") needsReviewDecisions++;
      else verifiedDecisions++;
    }

    const blockedCount = blockedExceptions.length + blockedDecisions;
    const needsReviewCount = openExceptions.length + needsReviewDecisions;
    const verifiedCount = verifiedDecisions;

    return {
      id: s.id,
      shipmentNumber: s.shipmentNumber,
      referenceNumber: s.poReference,
      exporterName: s.importerName, // matches previous fallback naming
      primaryHtsCode: primaryLineItem?.htsCode ?? "Not Yet Classified",
      totalValue,
      // Per shipment, from its own documents. The table used to print "$" over
      // every entered value; this account's invoice is denominated in EUR, so
      // that figure was being reported in the wrong currency.
      currency: extractedCurrency(s.documents),
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
      openExceptions: activeExceptions.length,
      aiReview: {
        blocked: blockedCount,
        needsReview: needsReviewCount,
        verified: verifiedCount,
      },
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
