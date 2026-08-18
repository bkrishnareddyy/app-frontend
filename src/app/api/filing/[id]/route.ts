import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { computeFilingTariff, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";
import type { FilingSnapshotData } from "@/modules/filings/filing.service";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const filing = await db.customsFiling.findFirst({
    where: {
      id,
      accountId: ctx.accountId,
    },
    include: {
      snapshot: true,
      shipment: {
        include: {
          documents: true,
          // Ordered because the reads below treat lineItems[0] as the filing's
          // primary line: unordered rows made the declared primary HTS and
          // country of origin whichever line Postgres happened to return first.
          lineItems: { orderBy: { lineNumber: "asc" } },
          agentDecisions: { omit: { triageState: true, blockedReason: true, autoApprovalPolicy: true } },
        },
      },
      responses: {
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  if (!filing) {
    return NextResponse.json({ error: "Filing not found" }, { status: 404 });
  }

  // Retrieve related filings (same importer, HTS, or port)
  const relatedFilings = await db.customsFiling.findMany({
    where: {
      accountId: ctx.accountId,
      id: { not: filing.id },
      shipment: {
        OR: [
          { importerName: filing.shipment.importerName },
          { portOfEntry: filing.shipment.portOfEntry },
        ],
      },
    },
    take: 5,
    select: {
      id: true,
      entryNumber: true,
      filingStatus: true,
      totalDuties: true,
      submittedAt: true,
      shipment: {
        select: {
          importerName: true,
          shipmentNumber: true,
        },
      },
    },
  });

  // Fetch audit logs for this filing
  const auditTrail = await db.auditLog.findMany({
    where: {
      accountId: ctx.accountId,
      entityId: filing.id,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Prefer the immutable filing snapshot (frozen at submission time) over
  // live shipment data when one exists, so this endpoint reflects what was
  // actually filed even if the underlying shipment record changes later.
  const snapshot = filing.snapshot
    ? (filing.snapshot.snapshotData as unknown as FilingSnapshotData)
    : null;
  const lineItems = snapshot ? (snapshot.lineItems ?? []) : (filing.shipment.lineItems ?? []);
  // Country of origin is a line-item attribute, not a shipment one: there is no
  // Shipment.countryOfOrigin column and the snapshot never carried one.
  const primaryCOO =
    lineItems[0]?.countryOfOrigin ?? (snapshot ? null : filing.shipment.countryOfExport) ?? null;
  const primaryHTS = lineItems[0]?.htsCode ?? null;

  // Standardized Duty Breakdown computed via Tariff Engine
  const tariffResult = computeFilingTariff(lineItems, await loadHtsCodesMap(lineItems));
  const dutyBreakdown = filing.dutyBreakdown ?? tariffResult.dutyBreakdown;

  const documents = filing.shipment.documents.map((doc) => ({
    id: doc.id,
    docType: doc.docType,
    fileName: doc.fileName,
    pageCount: doc.pageCount,
    fileUrl: doc.fileUrl,
    confidence: doc.confidence,
    status: doc.status,
    uploadedAt: doc.createdAt,
    version: doc.version,
    sha256: doc.checksum ?? null,
    aiExtractionStatus:
      doc.confidence === null
        ? "Awaiting extraction"
        : doc.confidence > 90
        ? "Verified"
        : "Needs Review",
  }));

  // Classification confidence is not part of the snapshot, so it cannot be
  // reported for a filing served from one.
  const primaryConfidence = snapshot ? null : (filing.shipment.lineItems[0]?.htsConfidence ?? null);
  const aiInsights = [
    primaryHTS === null
      ? "No HTS code has been assigned to the entry line items."
      : `HTS code ${primaryHTS} evaluated for entry line items.`,
    primaryConfidence === null
      ? "Product classification confidence has not been calculated."
      : `Product classification model confidence is ${primaryConfidence}%.`,
    filing.totalDuties === null
      ? "Duty has not been calculated for this entry."
      : `Duty assessed at $${Number(filing.totalDuties).toFixed(2)} matching predicted tariff calculations.`,
  ];

  // Evidence is only ever what the classifier actually recorded.
  const htsRecommendation = {
    htsCode: primaryHTS,
    confidence: primaryConfidence === null ? null : `${primaryConfidence}%`,
    evidence: [] as string[],
  };

  // Only timestamps that were actually recorded. The previous version
  // synthesised events at createdAt + 2/5/15 minutes and attributed them to a
  // "Customs Specialist" and "CBP ACE", then labelled the result immutable.
  const timeline = [
    { event: "Filing created", timestamp: filing.createdAt, source: "System" },
    ...(filing.submittedAt
      ? [{ event: "Transmitted to CBP", timestamp: filing.submittedAt, source: "ABI Interface" }]
      : []),
    ...filing.responses.map((resp) => ({
      event: resp.title,
      timestamp: resp.receivedAt,
      source: "CBP",
    })),
    ...(filing.releasedAt
      ? [{ event: "Customs released", timestamp: filing.releasedAt, source: "CBP" }]
      : []),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const detailedFiling = {
    id: filing.id,
    shipmentId: filing.shipmentId,
    entryNumber: filing.entryNumber,
    entryType: filing.entryType,
    filingType: filing.filingType,
    filingStatus: filing.filingStatus,
    paymentStatus: filing.paymentStatus,
    authority: filing.authority,

    // Summary
    importerOfRecord: snapshot ? snapshot.shipment.importerName : filing.shipment.importerName,
    portOfEntry: snapshot ? (snapshot.shipment.portOfEntry ?? null) : (filing.shipment.portOfEntry ?? null),
    modeOfTransport: null,
    carrier: snapshot ? (snapshot.shipment.carrierName ?? null) : (filing.shipment.carrierName ?? null),
    containerCount: null,
    countryOfOrigin: primaryCOO,
    supplier: null,
    shipmentReference: snapshot ? snapshot.shipment.shipmentNumber : filing.shipment.shipmentNumber,

    // Financial Breakdown
    totalCustomsValue: snapshot
      ? Number(snapshot.filingHeader.totalValue)
      : filing.totalValue === null
      ? null
      : Number(filing.totalValue),
    currency: "USD",
    totalDuty: snapshot ? Number(snapshot.filingHeader.totalDuties) : filing.totalDuties,
    // > 0 means some lines carry no published rate, so totalDuty is a floor.
    unratedLineCount: tariffResult.unratedLineCount,
    totalTaxes: snapshot ? Number(snapshot.filingHeader.totalTaxes) : filing.totalTaxes,
    totalFees: null,
    totalAmount: snapshot
      ? Number(snapshot.filingHeader.totalAmount)
      : filing.totalAmount === null
      ? null
      : Number(filing.totalAmount),
    dutyBreakdown,

    // Associated Entities
    shipment: filing.shipment,
    products: lineItems,
    documents,
    responses: filing.responses,
    timeline,
    aiInsights,
    htsRecommendation,
    relatedFilings,
    auditTrail,

    // Risk & Confidence
    aiRiskScore: filing.shipment.riskScore,
    readinessScore: filing.shipment.readinessScore,

    submittedAt: filing.submittedAt,
    releasedAt: filing.releasedAt,
    createdAt: filing.createdAt,
    updatedAt: filing.updatedAt,
  };

  return NextResponse.json({ filing: detailedFiling });
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { filingStatus, paymentStatus, dutyBreakdown, localReferenceNumber, registrationNumber } = body;

  const existingFiling = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
});

  if (!existingFiling) {
    return NextResponse.json({ error: "Filing not found" });
  }

  const updateData: import("@prisma/client").Prisma.CustomsFilingUpdateInput = {};

  if (filingStatus || paymentStatus) {
    return NextResponse.json(
      { error: "Forbidden: State mutations must be performed via the workflow engine." },
      { status: 403 }
    );
  }

  if (dutyBreakdown) {
    updateData.dutyBreakdown = dutyBreakdown;
  }

  if (localReferenceNumber !== undefined) {
    updateData.localReferenceNumber = localReferenceNumber;
  }

  if (registrationNumber !== undefined) {
    updateData.registrationNumber = registrationNumber;
  }

  const updatedFiling = await db.customsFiling.update({
    where: { id },
    data: updateData,
    include: { responses: true, shipment: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.FILING_UPDATED,
    entity: "CustomsFiling",
    entityId: id,
    source: "UI",
    metadata: {
      previousStatus: existingFiling.filingStatus,
      newStatus: filingStatus || existingFiling.filingStatus,
      updatedFields: Object.keys(body),
    },
  });

  return NextResponse.json({ filing: updatedFiling });

}, { permission: "filings.create", write: true });
