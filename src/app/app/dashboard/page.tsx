import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeReadinessBreakdown, deriveReadinessDimensions } from "@/lib/shipmentReadiness";
import { checkRequiredDocumentTypes } from "@/lib/requiredDocumentTypes";
import { extractedCurrency } from "@/modules/documents/extractedCurrency";
import { triageDecision } from "@/modules/decisions/decisionState";
import { computeAttentionPriority } from "@/lib/dashboard/attentionPriority";
import { computeAgentOperations } from "@/lib/dashboard/agentOperationsSummary";
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
      agentDecisions: { select: { id: true, agentName: true, status: true, triageState: true, proposedDescription: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: SHIPMENT_ROW_CAP,
  });

  const clients = await db.client.findMany({
    where: { accountId },
    orderBy: { name: "asc" },
  });

  // Fetch decisions for the active tenant account -- only the columns
  // formattedDecisions and the Agent Operations summary read, not the full
  // row (which includes an `evidenceItems` JSON blob and several
  // string-array columns per decision).
  const decisions = await db.agentDecision.findMany({
    where: { accountId },
    select: {
      id: true,
      status: true,
      triageState: true,
      proposedDescription: true,
      agentName: true,
      shipmentId: true,
      createdAt: true,
      shipment: {
        select: {
          assignedBrokerId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: SHIPMENT_ROW_CAP,
  });

  // Agent Operations table: real per-agent processed/review/blocked counts,
  // deduped to the latest decision per (shipment, agent) pair -- same rule
  // page.tsx already applies per-shipment for aiReview below. Capped to the
  // same SHIPMENT_ROW_CAP-bounded decision list as the rest of this page (see
  // the comment on SHIPMENT_ROW_CAP above); this is a documented UI-list
  // limitation, not a tenant-wide undercount claim.
  const agentOperations = computeAgentOperations(decisions);

  // Classification Signals: tenant-wide (ClassificationCase has no shipment/
  // client link -- see ClassificationSubject.canonicalProductId, which is
  // optional -- so this cannot be scoped to the selected client/broker).
  const classificationCaseCounts = await db.classificationCase.groupBy({
    by: ["status"],
    where: { accountId },
    _count: { _all: true },
  });
  const classificationOverrideCount = await db.classificationDecision.count({
    where: { decisionStatus: "OVERRIDDEN", case: { accountId } },
  });
  const caseCountByStatus = new Map(classificationCaseCounts.map((c) => [c.status, c._count._all]));
  const classificationSignals = {
    newOrInProgress:
      (caseCountByStatus.get("DRAFT") ?? 0) +
      (caseCountByStatus.get("AWAITING_DOCUMENTS") ?? 0) +
      (caseCountByStatus.get("QUEUED") ?? 0) +
      (caseCountByStatus.get("PROCESSING") ?? 0),
    proposed: caseCountByStatus.get("PROPOSED") ?? 0,
    needsInformation: caseCountByStatus.get("NEEDS_INFORMATION") ?? 0,
    humanReviewRequired: caseCountByStatus.get("HUMAN_REVIEW_REQUIRED") ?? 0,
    approved: caseCountByStatus.get("APPROVED") ?? 0,
    overridden: classificationOverrideCount,
  };

  // Product Intelligence / Revalidation: real, persisted signals only --
  // ProductRevalidationFlag + ProductChangeEvent are actually written by
  // productService.ts's change-detection path, unlike "product match" /
  // "conflict" states which only exist transiently inside an agent run today
  // and are never persisted as their own queryable field. Tenant-wide (a
  // Product can be client-scoped via Product.clientId, but revalidation
  // flags don't carry clientId directly, so this stays tenant-wide like
  // Classification Signals above).
  const openRevalidationFlags = await db.productRevalidationFlag.groupBy({
    by: ["flag"],
    where: { accountId, status: "OPEN" },
    _count: { _all: true },
  });
  const revalidationByFlag = new Map(openRevalidationFlags.map((f) => [f.flag, f._count._all]));
  const productReviewCount = await db.product.count({
    where: { accountId, deletedAt: null, reviewStatus: "NEEDS_REVIEW" },
  });
  // Server Component executed once per request, not memoized by the
  // compiler -- reading the current time here is safe.
  // eslint-disable-next-line react-hooks/purity
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const significantProductChanges30d = await db.productChangeEvent.count({
    where: { accountId, significance: "CUSTOMS_SIGNIFICANT", createdAt: { gte: thirtyDaysAgo } },
  });
  const productIntelligenceSignals = {
    classificationRevalidationRequired: revalidationByFlag.get("CLASSIFICATION_REVALIDATION_REQUIRED") ?? 0,
    originRevalidationRequired: revalidationByFlag.get("ORIGIN_REVALIDATION_REQUIRED") ?? 0,
    regulatoryRevalidationRequired: revalidationByFlag.get("REGULATORY_REVALIDATION_REQUIRED") ?? 0,
    valuationReviewRequired: revalidationByFlag.get("VALUATION_REVIEW_REQUIRED") ?? 0,
    productsNeedingReview: productReviewCount,
    significantChanges30d: significantProductChanges30d,
  };

  // Review Queue: compact per-category counts, reusing the sources above
  // rather than inventing a new work-item model. "Document Intelligence" /
  // "Origin" / "Valuation" reuse the same Agent Operations needsReview tally.
  const needsReviewByAgent = new Map(agentOperations.map((a) => [a.agentName, a.needsReview]));
  const reviewQueue = {
    classification: classificationSignals.humanReviewRequired,
    productIntelligence: productIntelligenceSignals.productsNeedingReview,
    documentIntelligence: needsReviewByAgent.get("Document Intelligence Agent") ?? 0,
    origin: needsReviewByAgent.get("Origin Agent") ?? 0,
    valuation: needsReviewByAgent.get("Valuation Agent") ?? 0,
  };

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

  // Most-urgent open deadline per shipment for countdown chips and attention
  // priority. Queried before formattedShipments below so the deadline lookup
  // is available while deriving each shipment's attention priority.
  const openDeadlines = await db.complianceDeadline.findMany({
    where: { accountId, status: "OPEN", dueAt: { not: null } },
    select: { shipmentId: true, type: true, dueAt: true, estimated: true, penaltyEstimate: true,
              shipment: { select: { shipmentNumber: true } } },
    orderBy: { dueAt: "asc" },
  });
  const urgencyByShipment: Record<string, { deadlineType: string; dueAt: string; estimated: boolean; exposureUsd: number | null }> = {};
  for (const d of openDeadlines) {
    const num = d.shipment?.shipmentNumber;
    if (!num || urgencyByShipment[num]) continue;
    urgencyByShipment[num] = { deadlineType: d.type, dueAt: d.dueAt!.toISOString(),
      estimated: d.estimated, exposureUsd: d.penaltyEstimate != null ? Number(d.penaltyEstimate) : null };
  }

  // Server Component executed once per request, not memoized by the
  // compiler -- reading the current time here is safe.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // Serialize models safely for client component props
  const formattedShipments = shipments.map((s) => {
    // readinessScore is a static column default, never updated as
    // documents/line items/exceptions change -- compute the real figure.
    const readinessBreakdown = computeReadinessBreakdown(s);
    const readinessScore = readinessBreakdown.totalScore;
    const { dimensions: readinessDimensions, blockers: readinessBlockers } =
      deriveReadinessDimensions(readinessBreakdown);
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
      const triage = triageDecision({ status: d.status, triageState: d.triageState, proposedDescription: d.proposedDescription });
      if (triage === "blocked") blockedDecisions++;
      else if (triage === "review") needsReviewDecisions++;
      else verifiedDecisions++;
    }

    const blockedCount = blockedExceptions.length + blockedDecisions;
    const needsReviewCount = openExceptions.length + needsReviewDecisions;
    const verifiedCount = verifiedDecisions;

    const hasCriticalException = activeExceptions.some((e) => e.severity === "Critical");
    const isOverdue =
      !!s.estimatedArrival &&
      s.estimatedArrival.getTime() < now &&
      s.status !== "Submitted" &&
      s.status !== "Completed";
    const deadlineInfo = urgencyByShipment[s.shipmentNumber];
    const hoursUntilDeadline = deadlineInfo
      ? (new Date(deadlineInfo.dueAt).getTime() - now) / (1000 * 60 * 60)
      : null;

    const { priority, reasons: attentionReasons } = computeAttentionPriority({
      hasCriticalException,
      blockedDecisions,
      needsReviewDecisions,
      isOverdue,
      missingDocCount: docCheck.missingTypes.length,
      hoursUntilDeadline,
    });

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
      readinessDimensions,
      readinessBlockers,
      priority,
      attentionReasons,
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
      urgencyByShipment={urgencyByShipment}
      initialDecisions={formattedDecisions}
      regUpdates={formattedRegUpdates}
      teamMembers={teamMembers}
      clients={clients.map((c) => ({ id: c.id, name: c.name }))}
      agentOperations={agentOperations}
      classificationSignals={classificationSignals}
      productIntelligenceSignals={productIntelligenceSignals}
      reviewQueue={reviewQueue}
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
