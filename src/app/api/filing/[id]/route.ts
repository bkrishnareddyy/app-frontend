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
    where: { id, accountId: ctx.accountId },
    include: {
      snapshot: true,
      shipment: {
        include: {
          documents: true,
          lineItems: { orderBy: { lineNumber: "asc" } },
          agentDecisions: { omit: { triageState: true, blockedReason: true, autoApprovalPolicy: true } },
        },
      },
      responses: { orderBy: { receivedAt: "desc" } },
    },
  });

  if (!filing) return NextResponse.json({ error: "Filing not found" }, { status: 404 });

  const relatedFilings = await db.customsFiling.findMany({
    where: {
      accountId: ctx.accountId,
      id: { not: filing.id },
      ...(filing.shipment
        ? { shipment: { OR: [{ importerName: filing.shipment.importerName }, { portOfEntry: filing.shipment.portOfEntry }] } }
        : {}),
    },
    take: 5,
    select: {
      id: true,
      entryNumber: true,
      filingStatus: true,
      totalDuties: true,
      submittedAt: true,
      shipment: { select: { importerName: true, shipmentNumber: true } },
    },
  });

  const auditTrail = await db.auditLog.findMany({
    where: { accountId: ctx.accountId, entityId: filing.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const snapshot = filing.snapshot ? (filing.snapshot.snapshotData as unknown as FilingSnapshotData) : null;
  const lineItems = snapshot ? (snapshot.lineItems ?? []) : (filing.shipment?.lineItems ?? []);
  const primaryCOO = lineItems[0]?.countryOfOrigin ?? (snapshot ? null : filing.shipment?.countryOfExport) ?? null;
  const primaryHTS = lineItems[0]?.htsCode ?? null;

  const tariffResult = computeFilingTariff(lineItems, await loadHtsCodesMap(lineItems));
  const dutyBreakdown = filing.dutyBreakdown ?? tariffResult.dutyBreakdown;

  const documents = (filing.shipment?.documents ?? []).map((doc) => ({
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
    aiExtractionStatus: doc.confidence === null ? "Awaiting extraction" : doc.confidence > 90 ? "Verified" : "Needs Review",
  }));

  const primaryConfidence = snapshot ? null : (filing.shipment?.lineItems[0]?.htsConfidence ?? null);
  const aiInsights = [
    primaryHTS === null ? "No HTS code has been assigned to the entry line items." : `HTS code ${primaryHTS} evaluated for entry line items.`,
    primaryConfidence === null ? "Model confidence is not recorded for this entry." : `Classification model confidence score: ${primaryConfidence}%.`,
  ];

  const htsRecommendation = primaryHTS === null ? null : {
    code: primaryHTS,
    confidence: primaryConfidence,
    dutyRate: tariffResult.dutyBreakdown[0]?.rate ?? null,
    source: "HTS Master Release 2026",
  };

  const timeline = [
    { stage: "Created", date: filing.createdAt.toISOString(), status: "Completed" },
    ...(filing.submittedAt
      ? [{ stage: "Submitted to CBP", date: filing.submittedAt.toISOString(), status: "Completed" }]
      : [{ stage: "Submitted to CBP", date: null, status: "Pending" }]),
    ...(filing.releasedAt
      ? [{ stage: "CBP Release", date: filing.releasedAt.toISOString(), status: "Completed" }]
      : [{ stage: "CBP Release", date: null, status: "Pending" }]),
  ];

  const detailedFiling = {
    id: filing.id,
    entryNumber: filing.entryNumber,
    status: filing.filingStatus,
    filingStatus: filing.filingStatus,
    paymentStatus: filing.paymentStatus,
    authority: filing.authority,
    importerOfRecord: snapshot ? snapshot.shipment.importerName : (filing.shipment?.importerName ?? "Unknown Importer"),
    portOfEntry: snapshot ? (snapshot.shipment.portOfEntry ?? null) : (filing.shipment?.portOfEntry ?? null),
    modeOfTransport: null,
    carrier: snapshot ? (snapshot.shipment.carrierName ?? null) : (filing.shipment?.carrierName ?? null),
    containerCount: null,
    countryOfOrigin: primaryCOO,
    supplier: null,
    shipmentReference: snapshot ? snapshot.shipment.shipmentNumber : (filing.shipment?.shipmentNumber ?? "N/A"),
    totalCustomsValue: snapshot ? Number(snapshot.filingHeader.totalValue) : filing.totalValue === null ? null : Number(filing.totalValue),
    currency: "USD",
    totalDuty: snapshot ? Number(snapshot.filingHeader.totalDuties) : filing.totalDuties,
    unratedLineCount: tariffResult.unratedLineCount,
    totalTaxes: snapshot ? Number(snapshot.filingHeader.totalTaxes) : filing.totalTaxes,
    totalFees: null,
    totalAmount: snapshot ? Number(snapshot.filingHeader.totalAmount) : filing.totalAmount === null ? null : Number(filing.totalAmount),
    dutyBreakdown,
    shipment: filing.shipment,
    products: lineItems,
    documents,
    responses: filing.responses,
    timeline,
    aiInsights,
    htsRecommendation,
    relatedFilings,
    auditTrail,
    aiRiskScore: filing.shipment?.riskScore ?? null,
    readinessScore: filing.shipment?.readinessScore ?? null,
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
  const existingFiling = await db.customsFiling.findFirst({ where: { id, accountId: ctx.accountId } });
  if (!existingFiling) return NextResponse.json({ error: "Filing not found" });

  const updateData: import("@prisma/client").Prisma.CustomsFilingUpdateInput = {};
  if (filingStatus || paymentStatus) {
    return NextResponse.json({ error: "Forbidden: State mutations must be performed via the workflow engine." }, { status: 403 });
  }
  if (dutyBreakdown) updateData.dutyBreakdown = dutyBreakdown;
  if (localReferenceNumber !== undefined) updateData.localReferenceNumber = localReferenceNumber;
  if (registrationNumber !== undefined) updateData.registrationNumber = registrationNumber;

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
