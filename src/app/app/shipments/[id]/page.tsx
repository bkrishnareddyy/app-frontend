import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileText,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { ShipmentDocumentsSection } from "./ShipmentDocumentsSection";
import { ShipmentExceptionsSection } from "./ShipmentExceptionsSection";
import { PipelineProgressTracker } from "./PipelineProgressTracker";
import { DocumentViewerControls } from "./DocumentViewerControls";
import { ShipmentTitleEditor } from "./ShipmentTitleEditor";
import { documentViewUrl } from "@/lib/documentUrl";
import { openStatusVariants } from "@/modules/exceptions/exceptionState";
import { evaluateFilingReadiness } from "@/modules/filing/filingReadiness";
import { entryTypeLabel } from "@/modules/filing/entryType";
import {
  averageOfKnown,
  displayCurrency,
  displayPercent,
  displayText,
  displayDate,
  displayNumber,
  AWAITING_PROCESSING,
  NOT_CALCULATED,
  NOT_PROVIDED,
} from "@/lib/honest";

export default async function ShipmentWorkspacePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docId?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const docId = searchParams.docId;
  const context = await getAccountContext();
  if (!context) return null;

  const shipment = await db.shipment.findFirst({
    where: {
      accountId: context.accountId,
      OR: [{ id: params.id }, { shipmentNumber: params.id }],
      deletedAt: null,
    },
    include: {
      documents: true,
      lineItems: true,
      agentDecisions: true,
      assignedBroker: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          brokerLicenseNumber: true,
        },
      },
      customsFilings: { include: { responses: true } },
      exceptionItems: {
        where: { status: { in: openStatusVariants() } },
        orderBy: { createdAt: "desc" },
      },
      reconciliationIssues: {
        where: { status: "Open" },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!shipment) notFound();

  // The pipeline stepper reports logged runs. An agent that never ran has no row.
  const agentRuns = await db.agentExecutionLog.findMany({
    where: { accountId: context.accountId, shipmentId: shipment.id },
    orderBy: [{ stepNumber: "asc" }, { timestamp: "desc" }],
  });
  const latestRunByStep = new Map<number, (typeof agentRuns)[number]>();
  for (const run of agentRuns) {
    if (!latestRunByStep.has(run.stepNumber)) latestRunByStep.set(run.stepNumber, run);
  }
  const pipelineRuns = [...latestRunByStep.values()].sort((a, b) => a.stepNumber - b.stepNumber);

  // The step count belongs to the job, not to a literal in the markup.
  const latestJob = await db.pipelineJob.findFirst({
    where: { accountId: context.accountId, shipmentId: shipment.id },
    orderBy: { createdAt: "desc" },
    select: { totalSteps: true },
  });
  const totalPipelineSteps = latestJob?.totalSteps ?? pipelineRuns.length;

  const openFiling = shipment.customsFilings.find((f) => f.filingStatus !== "CANCELLED");

  // "Blocking" is the subset that stops the entry, not every open item.
  const blockingExceptions = shipment.exceptionItems.filter(
    (ex) => ex.severity === "Critical" || ex.severity === "High"
  );
  const criticalReconciliation = shipment.reconciliationIssues.filter(
    (issue) => issue.severity === "Critical"
  );
  const blockingCount = blockingExceptions.length + criticalReconciliation.length;

  // Whether this entry can be filed is answered from stored columns, not assumed
  // by the button that sends the user to the filing screen.
  const readiness = evaluateFilingReadiness({
    importerOfRecordId: shipment.importerOfRecordId,
    entryType: shipment.entryType,
    lineItems: shipment.lineItems.map((li) => ({
      lineNumber: li.lineNumber,
      htsCode: li.htsCode,
      countryOfOrigin: li.countryOfOrigin,
    })),
    documents: shipment.documents.map((d) => ({ docType: d.docType, status: d.status })),
    openExceptions: shipment.exceptionItems.map((ex) => ({ severity: ex.severity })),
    openReconciliationIssues: shipment.reconciliationIssues.map((issue) => ({
      severity: issue.severity,
    })),
  });

  // The route is what the record actually holds. There is no transport-mode column,
  // so the header does not claim one.
  const routeFrom = shipment.countryOfExport?.trim() || null;
  const routeTo = shipment.portOfEntry?.trim() || null;
  const route =
    routeFrom && routeTo ? `${routeFrom} \u2192 ${routeTo}` : routeFrom ?? routeTo ?? null;

  const brokerName = shipment.assignedBroker
    ? [shipment.assignedBroker.firstName, shipment.assignedBroker.lastName]
        .filter((part) => part !== null && part.trim() !== "")
        .join(" ")
        .trim() || shipment.assignedBroker.email
    : null;
  // The licence number is what makes a broker a broker; showing a name without it
  // would imply a credential the record does not hold.
  const brokerLicense = shipment.assignedBroker?.brokerLicenseNumber ?? null;

  const receivedDocuments = shipment.documents.filter((d) => d.status === "Received").length;

  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

  const SECTIONS = [
    { id: "overview", label: "Overview" },
    { id: "documents", label: "Documents" },
    { id: "line-items", label: "Line items and classification" },
    { id: "exceptions", label: "Exceptions" },
    { id: "customs-filing", label: "Customs filing" },
    { id: "activity", label: "Activity and audit history" },
  ] as const;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      <PipelineProgressTracker shipmentId={shipment.id} />
      {/* 1. Overview */}
      <section
        id="overview"
        aria-labelledby="overview-heading"
        className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 scroll-mt-6"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 id="overview-heading" className="sr-only">
              Shipment {shipment.shipmentNumber}
            </h1>
            <ShipmentTitleEditor
              shipmentId={shipment.id}
              initialShipmentNumber={shipment.shipmentNumber}
              isEnterpriseAdmin={isEnterpriseAdmin}
            />
            {/* The chip reports the stored status; it is not a success signal. */}
            <span className="px-2.5 py-0.5 rounded-full text-sm font-semibold bg-[#F5F5F7] text-[#1D1D1F] border border-[#E5E5EA]">
              {shipment.status}
            </span>
            {blockingCount > 0 && (
              <Link
                href="#exceptions"
                className="px-2.5 py-0.5 rounded-full text-sm font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
              >
                {blockingCount} blocking {blockingCount === 1 ? "exception" : "exceptions"}
              </Link>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <Link
              href={`/app/decisions?shipmentId=${shipment.id}`}
              className="px-4 py-2 bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] text-sm font-semibold rounded-xl shadow-2xs transition-all flex items-center space-x-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#0071E3]" aria-hidden="true" />
              <span>Agent decisions for this shipment</span>
            </Link>

            {/* Filing is per shipment; a generic link would open somebody else's entry.
                When the entry is not ready, the button says so and goes to the reasons
                rather than promising a transmission the record cannot support. */}
            <Link
              href={
                openFiling || readiness.ready
                  ? `/app/filing?shipmentId=${shipment.id}`
                  : "#filing-readiness"
              }
              className={`px-5 py-2 text-sm font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1.5 ${
                openFiling || readiness.ready
                  ? "bg-[#0071E3] hover:bg-[#0077ED] text-white"
                  : "bg-white border border-amber-300 text-amber-900 hover:bg-amber-50"
              }`}
            >
              <span>
                {openFiling
                  ? "Open Filing"
                  : readiness.ready
                    ? "Send to Filing"
                    : `Not ready to file: ${readiness.blockers.length} ${
                        readiness.blockers.length === 1 ? "blocker" : "blockers"
                      }`}
              </span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* Section navigation. The workspace is one page, so these are anchors. */}
        <nav aria-label="Shipment workspace sections" className="border-t border-[#E5E5EA] pt-3">
          <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {SECTIONS.map((section, index) => (
              <li key={section.id}>
                <Link
                  href={`#${section.id}`}
                  className="font-semibold text-[#0071E3] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
                >
                  {index + 1}. {section.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        {/* Operational header facts. Every value here is a stored column. */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pt-4 border-t border-[#E5E5EA] text-sm">
          <div>
            <dt className="text-[#86868B]">Route</dt>
            <dd className="font-bold text-[#1D1D1F]">{displayText(route)}</dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Carrier</dt>
            <dd className="font-bold text-[#1D1D1F] truncate">{displayText(shipment.carrierName)}</dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Estimated arrival</dt>
            <dd className="font-bold text-[#1D1D1F]">{displayDate(shipment.estimatedArrival)}</dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Entry type</dt>
            <dd className="font-bold text-[#1D1D1F]">{entryTypeLabel(shipment.entryType, NOT_PROVIDED)}</dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Assigned operator</dt>
            <dd className="font-bold text-[#1D1D1F] truncate">{displayText(shipment.ownerName)}</dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Assigned broker</dt>
            <dd className="font-bold text-[#1D1D1F] truncate">{displayText(brokerName)}</dd>
            <dd className="text-[#6E6E73]">
              {brokerName === null
                ? ""
                : `Licence ${displayText(brokerLicense, "not recorded")}`}
            </dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Customs readiness</dt>
            <dd className="font-bold text-[#1D1D1F]">
              {displayPercent(shipment.readinessScore, NOT_CALCULATED)}
            </dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Blocking exceptions</dt>
            <dd className="font-bold text-[#1D1D1F]">{blockingCount}</dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Importer</dt>
            <dd className="font-bold text-[#1D1D1F] truncate">{shipment.importerName}</dd>
          </div>
          <div>
            <dt className="text-[#86868B]">PO / reference</dt>
            <dd className="font-bold text-[#1D1D1F]">{displayText(shipment.poReference)}</dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Incoterm</dt>
            <dd className="font-bold text-[#1D1D1F]">{displayText(shipment.incoterm)}</dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Documents received</dt>
            <dd className="font-bold text-[#1D1D1F]">
              {receivedDocuments} of {shipment.documents.length}
            </dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Shipment health</dt>
            <dd className="font-bold text-[#1D1D1F]">
              {displayText(shipment.healthStatus, NOT_CALCULATED)}
            </dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Risk score</dt>
            <dd className="font-bold text-[#1D1D1F]">
              {displayNumber(shipment.riskScore, NOT_CALCULATED)}
            </dd>
          </div>
          <div>
            <dt className="text-[#86868B]">Last updated</dt>
            <dd className="font-bold text-[#1D1D1F]">
              <time dateTime={shipment.updatedAt.toISOString()}>
                {displayDate(shipment.updatedAt)}
              </time>
            </dd>
          </div>
        </dl>
      </section>

      {/* 2. Documents */}
      <section
        id="documents"
        aria-labelledby="documents-heading"
        className="space-y-4 scroll-mt-6"
      >
        <h2 id="documents-heading" className="sr-only">
          2. Documents
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Interactive Documents Set Summary (3 Cols) */}
          <div className="lg:col-span-3">
            <ShipmentDocumentsSection shipmentId={shipment.id} documents={shipment.documents} />
          </div>
              {/* Center Column: Embedded Document Viewer */}
        <div className="lg:col-span-9 bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 flex flex-col justify-between overflow-hidden min-h-[480px]">
          {shipment.documents.length > 0 ? (
            (() => {
              // The document list links here with ?docId, so the viewer shows the
              // document the user picked rather than always the first one.
              const primaryDoc =
                (docId ? shipment.documents.find((d) => d.id === docId) : undefined) ??
                shipment.documents.find((d) => d.status === "Received") ??
                shipment.documents[0];
              const proxyUrl = primaryDoc.fileUrl ? documentViewUrl(primaryDoc.id) : "#";

              return (
                <div className="flex flex-col justify-between h-full space-y-4">
                  <div>
                    {/* Viewer Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5E5EA] text-sm">
                      <div className="flex items-center space-x-2 min-w-0">
                        <FileText className="w-4 h-4 text-[#0071E3] shrink-0" aria-hidden="true" />
                        <span className="font-bold text-[#1D1D1F] truncate">
                          {displayText(primaryDoc.fileName)}
                        </span>
                        {/* A document awaiting type detection is not a Commercial Invoice. */}
                        <span className="text-[#86868B] text-[11px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#F5F5F7] shrink-0 whitespace-nowrap">
                          {!primaryDoc.docType || primaryDoc.docType === "AUTO_DETECT"
                            ? "Type not detected"
                            : primaryDoc.docType}
                        </span>
                      </div>
                      <DocumentViewerControls
                        documentId={primaryDoc.id}
                        fileName={primaryDoc.fileName}
                        fileUrl={primaryDoc.fileUrl}
                        proxyUrl={proxyUrl}
                        shipmentNumber={shipment.shipmentNumber}
                      >
                        <span className="text-[#0071E3] font-semibold whitespace-nowrap group-hover:underline">
                          View extraction
                        </span>
                      </DocumentViewerControls>
                    </div>

                    {/* Document Metadata Details */}
                    <div className="mt-4 p-4 rounded-xl bg-[#F9F9FB] border border-[#E5E5EA] space-y-3">
                      <div className="flex items-center justify-between text-sm pb-2 border-b border-[#E5E5EA]">
                        <span className="text-[#86868B]">Document status</span>
                        <span className="font-bold text-[#1D1D1F]">
                          {displayText(primaryDoc.status)}
                          {primaryDoc.extractedJson
                            ? " \u00b7 extraction stored"
                            : " \u00b7 no extraction stored"}
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        <div className="min-w-0">
                          <dt className="text-[#86868B] uppercase font-bold text-[11px] tracking-wider">File name</dt>
                          <dd className="font-bold text-[#1D1D1F] truncate">
                            {displayText(primaryDoc.fileName)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[#86868B] uppercase font-bold text-[11px] tracking-wider">Document type</dt>
                          <dd className="font-bold text-[#1D1D1F]">
                            {primaryDoc.docType === "AUTO_DETECT"
                              ? "Type not detected"
                              : displayText(primaryDoc.docType)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[#86868B] uppercase font-bold text-[11px] tracking-wider">Page count</dt>
                          <dd className="font-mono text-[#1D1D1F]">
                            {/* Unparsed documents have no page count; "1 Page" was a guess. */}
                            {primaryDoc.pageCount === null
                              ? AWAITING_PROCESSING
                              : `${primaryDoc.pageCount} ${primaryDoc.pageCount === 1 ? "page" : "pages"}`}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[#86868B] uppercase font-bold text-[11px] tracking-wider">Uploaded</dt>
                          <dd className="text-[#1D1D1F]">{displayDate(primaryDoc.createdAt)}</dd>
                        </div>
                      </dl>
                    </div>

                  </div>

                  <div className="flex items-center justify-between text-sm text-[#86868B] pt-3 border-t border-[#E5E5EA]">
                    <span>Document ID: {primaryDoc.id}</span>
                    <span>
                      {shipment.documents.length}{" "}
                      {shipment.documents.length === 1 ? "document" : "documents"} attached
                    </span>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-12 text-sm">
              <FileText className="w-10 h-10 text-[#86868B] opacity-50" aria-hidden="true" />
              <div className="space-y-1">
                <h4 className="font-extrabold text-[#1D1D1F]">No documents attached</h4>
                <p className="text-[#86868B]">
                  Upload a commercial invoice, bill of lading, or packing list to start extraction.
                </p>
              </div>
            </div>
          )}
        </div>
        </div>
      </section>

      {/* 3. Line items and classification */}
      <section
        id="line-items"
        aria-labelledby="line-items-heading"
        className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 scroll-mt-6"
      >
        <div className="space-y-6">
          {/* Extracted Entry Data Panel */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="line-items-heading"
                className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]"
              >
                3. Line items and classification ({shipment.lineItems.length})
              </h2>
              {shipment.lineItems.length > 0 ? (
                (() => {
                  const avgConfidence = averageOfKnown(
                    shipment.lineItems.map((item) => item.htsConfidence)
                  );
                  return (
                    <span className="text-sm font-semibold text-[#1D1D1F]">
                      {avgConfidence === null
                        ? "Model confidence not calculated"
                        : `${avgConfidence}% average model confidence`}
                    </span>
                  );
                })()
              ) : (
                <span className="text-sm font-semibold text-amber-700">{AWAITING_PROCESSING}</span>
              )}
            </div>

            {/* Line items, as stored. Totals come from the persisted totalValue rather
                than being recomputed here, so the page cannot disagree with the filing. */}
            {shipment.lineItems.length > 0 ? (
              <div className="border border-[#E5E5EA] rounded-xl overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <caption className="sr-only">
                    Line items extracted for shipment {shipment.shipmentNumber}
                  </caption>
                  <thead className="bg-[#F5F5F7] text-[11px] font-bold text-[#6E6E73] uppercase tracking-wider border-b border-[#E5E5EA]">
                    <tr>
                      <th scope="col" className="p-2.5">Line</th>
                      <th scope="col" className="p-2.5">Description</th>
                      <th scope="col" className="p-2.5 whitespace-nowrap">HTS code</th>
                      <th scope="col" className="p-2.5 whitespace-nowrap">Model confidence</th>
                      <th scope="col" className="p-2.5">Origin</th>
                      <th scope="col" className="p-2.5">Status</th>
                      <th scope="col" className="p-2.5 text-right">Quantity</th>
                      <th scope="col" className="p-2.5 text-right whitespace-nowrap">Total value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E5EA]">
                    {shipment.lineItems.map((item) => (
                      <tr key={item.id}>
                        <td className="p-2.5 font-mono text-[#6E6E73]">{item.lineNumber}</td>
                        <td className="p-2.5 font-bold text-[#1D1D1F]">
                          {displayText(item.description)}
                        </td>
                        <td className="p-2.5 font-mono text-[#0071E3]">
                          {displayText(item.htsCode, "Not classified")}
                        </td>
                        <td
                          className={`p-2.5 font-semibold ${
                            item.htsConfidence === null
                              ? "text-[#86868B]"
                              : item.htsConfidence < 80
                              ? "text-amber-700"
                              : "text-emerald-700"
                          }`}
                        >
                          {displayPercent(item.htsConfidence)}
                        </td>
                        <td className="p-2.5 text-[#1D1D1F]">
                          {displayText(item.countryOfOrigin)}
                        </td>
                        <td className="p-2.5 text-[#1D1D1F]">{displayText(item.status)}</td>
                        <td className="p-2.5 text-right font-mono">{item.quantity}</td>
                        <td className="p-2.5 text-right font-mono font-bold">
                          {displayCurrency(item.totalValue.toString())}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-sm text-[#6E6E73]">
                No line items have been extracted for this shipment. They appear here once a
                commercial invoice has been processed.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 4. Exceptions */}
      <ShipmentExceptionsSection
        shipmentId={shipment.id}
        exceptions={shipment.exceptionItems}
        reconciliationIssues={shipment.reconciliationIssues}
      />

      {/* 5. Customs filing */}
      <section
        id="customs-filing"
        aria-labelledby="customs-filing-heading"
        className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 scroll-mt-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E5EA] pb-3">
          <h2
            id="customs-filing-heading"
            className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]"
          >
            5. Customs filing ({shipment.customsFilings.length})
          </h2>
          <Link
            href={`/app/filing?shipmentId=${shipment.id}`}
            className="text-sm font-semibold text-[#0071E3] hover:underline"
          >
            {openFiling ? "Open filing workspace" : "Start a filing for this shipment"}
          </Link>
        </div>

        {/* Filing readiness. Only checks that are genuinely performed are listed;
            bond, PGA and broker licence are absent because no column answers them. */}
        <div id="filing-readiness" className="scroll-mt-6 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-[#1D1D1F]">Filing readiness</h3>
            <p className="text-sm text-[#6E6E73]">
              {readiness.checksPassed} of {readiness.checksPerformed} checks pass
            </p>
          </div>

          {readiness.ready ? (
            <p role="status" className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-xl p-3">
              Every check this workspace can perform passes. Bond sufficiency, partner
              government agency requirements and broker licensing are not among them,
              because this record holds no data to check them against.
            </p>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-sm font-semibold text-amber-900">
                {readiness.blockers.length}{" "}
                {readiness.blockers.length === 1 ? "requirement is" : "requirements are"} not
                met. Filing this entry now would declare information the record does not
                hold.
              </p>
              <ul className="space-y-2">
                {readiness.blockers.map((blocker) => (
                  <li key={blocker.code} className="text-sm">
                    <Link
                      href={blocker.anchor}
                      className="font-semibold text-amber-900 underline hover:no-underline"
                    >
                      {blocker.label}
                    </Link>
                    <p className="text-amber-800">{blocker.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {shipment.customsFilings.length === 0 ? (
          <p className="text-sm text-[#6E6E73]">
            No customs filing has been created for this shipment.
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {shipment.customsFilings.map((f) => (
              <li
                key={f.id}
                className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1 text-sm"
              >
                <p className="font-bold text-[#1D1D1F]">
                  {displayText(f.entryNumber, "Entry number not assigned")}
                </p>
                <p className="text-[#6E6E73]">
                  {displayText(f.filingType)} · {displayText(f.filingStatus)}
                </p>
                <p className="text-[#6E6E73]">Submitted {displayDate(f.submittedAt)}</p>
                <p className="text-[#6E6E73]">
                  {f.responses.length === 0
                    ? "No customs response recorded"
                    : `${f.responses.length} customs ${
                        f.responses.length === 1 ? "response" : "responses"
                      } recorded`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6. Activity and audit history */}
      <section
        id="activity"
        aria-labelledby="activity-heading"
        className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 scroll-mt-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#0071E3]" aria-hidden="true" />
            <h2
              id="activity-heading"
              className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]"
            >
              6. Activity and audit history
            </h2>
          </div>
          <span className="text-sm text-[#6E6E73]">
            {pipelineRuns.length === 0
              ? "No agent run recorded"
              : `${pipelineRuns.length} of ${totalPipelineSteps} pipeline steps recorded a run`}
          </span>
        </div>

        {pipelineRuns.length === 0 ? (
          <p className="text-sm text-[#6E6E73]">
            No agent has recorded a run against this shipment yet. Steps appear here once the
            pipeline executes them.
          </p>
        ) : (
          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pipelineRuns.map((run) => (
              <li
                key={run.id}
                className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1.5 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-bold text-[#1D1D1F]">
                    <span className="w-5 h-5 rounded-full bg-white border border-[#E5E5EA] text-sm font-bold inline-flex items-center justify-center">
                      {run.stepNumber}
                    </span>
                    <span className="line-clamp-1">{run.agentName}</span>
                  </span>
                  <span
                    className={`shrink-0 inline-block text-sm font-semibold px-2 py-0.5 rounded-full border ${
                      run.status === "Completed"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : run.status === "BLOCKED"
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {run.status}
                  </span>
                </div>
                <p className="text-sm text-[#6E6E73] line-clamp-3">
                  {displayText(run.summary, "No summary recorded")}
                </p>
                <p className="text-sm text-[#86868B]">
                  <time dateTime={run.timestamp.toISOString()}>{displayDate(run.timestamp)}</time>
                  {" \u00b7 "}
                  {displayText(run.aiProviderUsed, "Provider not recorded")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
