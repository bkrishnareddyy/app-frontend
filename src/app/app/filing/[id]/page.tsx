import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { resolveAllowUpdates } from "@/lib/canonicalMessaging/filingActionRules";
import { resolveChildActions } from "@/lib/canonicalMessaging/childActionRules";
import { canTransition } from "@/modules/filings/filingStateMachine";
import type { CanonicalMessageHeader } from "@/lib/canonicalMessaging/types";
import { FilingDetailClient } from "./FilingDetailClient";

export default async function CustomsFilingDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const context = await getAccountContext();
  if (!context) return null;

  const filing = await db.customsFiling.findFirst({
    where: { id, accountId: context.accountId },
    include: {
      snapshot: true,
      shipment: {
        include: {
          documents: true,
          lineItems: { orderBy: { lineNumber: "asc" } },
        },
      },
      responses: { orderBy: { receivedAt: "desc" } },
      filingMessages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!filing) notFound();

  const latestMessage = filing.filingMessages[filing.filingMessages.length - 1] ?? null;
  const latestHeader = latestMessage
    ? (latestMessage.envelope as unknown as { header: CanonicalMessageHeader }).header
    : null;

  const actionContext = {
    country: latestHeader?.country ?? filing.shipment.destinationCountry ?? "*",
    procedure: latestHeader?.procedure ?? "*",
    messageName: latestHeader?.messageName ?? "*",
    status: filing.filingStatus,
  };
  const [allowUpdates, resolvedChildActions] = await Promise.all([
    resolveAllowUpdates(actionContext),
    resolveChildActions(actionContext),
  ]);

  const canValidate = canTransition(filing.filingStatus, "validate.pass");
  const canApprove = canTransition(filing.filingStatus, "broker.approve");
  const canTransmit = canTransition(filing.filingStatus, "transmit.send");
  const canResubmit = canTransition(filing.filingStatus, "resubmit");
  // The table decides which statuses offer CANCEL; whether a message
  // actually exists to cancel is a fact about this filing, not a rule --
  // reused from FilingService.cancelFiling()'s own precondition.
  const hasOutboundMessage = filing.filingMessages.some((m) => m.direction === "OUTBOUND");
  const childActions = resolvedChildActions.filter((action) => action !== "CANCEL" || hasOutboundMessage);

  const filingProps = {
    id: filing.id,
    entryNumber: filing.entryNumber,
    entryType: filing.entryType ?? null, // Multi-country migration: entryType is now nullable
    filingType: filing.filingType,
    filingStatus: filing.filingStatus,
    paymentStatus: filing.paymentStatus,
    authority: filing.authority ?? null, // Multi-country migration: authority is now nullable
    country: filing.country ?? null, // Multi-country support
    totalValue: filing.totalValue === null ? null : Number(filing.totalValue),
    totalDuties: filing.totalDuties === null ? null : Number(filing.totalDuties),
    totalTaxes: filing.totalTaxes === null ? null : Number(filing.totalTaxes),
    totalAmount: filing.totalAmount === null ? null : Number(filing.totalAmount),
    dutyBreakdown: (filing.dutyBreakdown as { feeName: string; amount: number; rate: string }[] | null) ?? [],
    submittedAt: filing.submittedAt ? filing.submittedAt.toISOString() : null,
    releasedAt: filing.releasedAt ? filing.releasedAt.toISOString() : null,
    createdAt: filing.createdAt.toISOString(),
    updatedAt: filing.updatedAt.toISOString(),
  };

  const shipmentProps = {
    id: filing.shipment.id,
    shipmentNumber: filing.shipment.shipmentNumber,
    importerName: filing.shipment.importerName,
    destinationCountry: filing.shipment.destinationCountry,
    countryOfExport: filing.shipment.countryOfExport,
    portOfEntry: filing.shipment.portOfEntry,
    carrierName: filing.shipment.carrierName,
    incoterm: filing.shipment.incoterm,
    entryType: filing.shipment.entryType,
  };

  const lineItemProps = filing.shipment.lineItems.map((li) => ({
    id: li.id,
    lineNumber: li.lineNumber,
    partNumber: li.partNumber,
    description: li.description,
    quantity: li.quantity,
    unitPrice: Number(li.unitPrice),
    totalValue: Number(li.totalValue),
    countryOfOrigin: li.countryOfOrigin,
    htsCode: li.htsCode,
    htsConfidence: li.htsConfidence,
    status: li.status,
  }));

  const documentProps = filing.shipment.documents.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    docType: d.docType,
    status: d.status,
    fileUrl: d.fileUrl,
    confidence: d.confidence,
  }));

  const responseProps = filing.responses.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description,
    status: r.status,
    receivedAt: r.receivedAt.toISOString(),
  }));

  const messageProps = filing.filingMessages.map((m) => ({
    id: m.id,
    messageId: m.messageId,
    messageName: m.messageName,
    direction: m.direction,
    status: m.status,
    correlationId: m.correlationId,
    priorMessageId: m.priorMessageId,
    createdAt: m.createdAt.toISOString(),
    envelope: m.envelope as object,
  }));

  const auditLogs = await db.auditLog.findMany({
    where: { entity: "CustomsFiling", entityId: filing.id },
    orderBy: { createdAt: "asc" },
  });

  const auditLogProps = auditLogs.map((log) => ({
    id: log.id,
    action: log.action,
    actor: log.userId ?? "System",
    createdAt: log.createdAt.toISOString(),
    details: log.metadata as Record<string, unknown> | null,
  }));

  return (
    <FilingDetailClient
      filing={filingProps}
      shipment={shipmentProps}
      lineItems={lineItemProps}
      documents={documentProps}
      responses={responseProps}
      messages={messageProps}
      auditLogs={auditLogProps}
      allowUpdates={allowUpdates}
      canValidate={canValidate}
      canApprove={canApprove}
      canTransmit={canTransmit}
      canResubmit={canResubmit}
      childActions={childActions}
    />
  );
}
