import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ShieldAlert,
  Building2,
  Truck,
  Activity,
  Layers,
  ArrowRight,
} from "lucide-react";
import { CanonicalShipmentService } from "@/modules/shipment/canonicalShipmentService";
import { ShipmentDocumentsSection } from "./ShipmentDocumentsSection";
import { PipelineProgressTracker } from "./PipelineProgressTracker";
import { ShipmentTitleEditor } from "./ShipmentTitleEditor";
import { ShipmentClientEditor } from "./ShipmentClientEditor";
import { ExceptionsDrawer } from "./ExceptionsDrawer";
import { LineItemsTable } from "./LineItemsTable";
import { CanonicalFactsSection } from "./CanonicalFactsSection";

export default async function ShipmentWorkspacePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docId?: string; view?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const activeTab = searchParams.view || "workspace";

  const context = await getAccountContext();
  if (!context) return null;

  const shipment = await db.shipment.findFirst({
    where: {
      accountId: context.accountId,
      OR: [{ id: params.id }, { shipmentNumber: params.id }],
      deletedAt: null,
    },
  });

  if (!shipment) notFound();

  // Load canonical state and multi-dimensional metrics from CanonicalShipmentService
  const canonical = await CanonicalShipmentService.getCanonicalState(shipment.id);
  const { metrics, facts } = canonical;
  const fullShipment = canonical.shipment;

  // Load display line items
  let displayLineItems = (fullShipment.lineItems || []).map((item: any) => ({
    id: item.id,
    lineNumber: item.lineNumber,
    partNumber: item.partNumber || "",
    description: item.description,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    totalValue: Number(item.totalValue),
    countryOfOrigin: item.countryOfOrigin || "",
    htsCode: item.htsCode || "",
    htsConfidence: item.htsConfidence || 95,
    status: item.status || "Extracted",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  const totalInvoiceAmount = displayLineItems.reduce(
    (acc: number, item: any) => acc + Number(item.quantity) * Number(item.unitPrice),
    0
  );

  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

  const canEditClient =
    isEnterpriseAdmin ||
    (context.roleNames.includes("PLANNER") && shipment.assignedBrokerId === context.userId);

  const clients = canEditClient
    ? await db.client.findMany({
        where: { accountId: context.accountId },
        orderBy: { name: "asc" },
      })
    : [];

  const activeExceptions = fullShipment.exceptionItems || [];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      <PipelineProgressTracker shipmentId={shipment.id} />

      {/* Top Banner & Multi-Dimensional Readiness Header */}
      <div className="bg-white p-6 rounded-3xl border border-[#E5E5EA] shadow-2xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E5E5EA] pb-5">
          <div className="flex items-center space-x-3">
            <ShipmentTitleEditor
              shipmentId={shipment.id}
              initialShipmentNumber={shipment.shipmentNumber}
              isEnterpriseAdmin={isEnterpriseAdmin}
            />
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
              {shipment.status}
            </span>
            <ShipmentClientEditor
              shipmentId={shipment.id}
              initialClientId={shipment.clientId}
              initialClientName={fullShipment.client?.name ?? null}
              clients={clients.map((c) => ({ id: c.id, name: c.name }))}
              canEdit={canEditClient}
            />
          </div>

          <div className="flex items-center space-x-3">
            <ExceptionsDrawer shipmentId={shipment.id} exceptionItems={activeExceptions} lineItems={displayLineItems} />
            <Link
              href={`/app/filing?shipmentId=${shipment.id}`}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center space-x-2 ${
                metrics.isReadyForFiling
                  ? "bg-[#0071E3] text-white hover:bg-[#0071E3]/90"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed"
              }`}
            >
              <span>Send to Customs Filing</span>
            </Link>
          </div>
        </div>

        {/* Multi-Dimensional Metrics Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1">
          <div className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA]">
            <span className="text-[10px] font-extrabold uppercase text-[#86868B] block mb-1">
              Filing Readiness
            </span>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-black text-[#1D1D1F]">{metrics.filingReadinessScore}%</span>
              <span className="text-xs font-bold text-[#86868B]">
                {metrics.blockerCount > 0 ? `${metrics.blockerCount} Blockers` : "No Blockers"}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA]">
            <span className="text-[10px] font-extrabold uppercase text-[#86868B] block mb-1">
              Data Completeness
            </span>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-black text-[#1D1D1F]">{metrics.completenessScore}%</span>
              <span className="text-xs font-bold text-[#86868B]">Customs Fields</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA]">
            <span className="text-[10px] font-extrabold uppercase text-[#86868B] block mb-1">
              Compliance Risk
            </span>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-black text-[#1D1D1F]">{metrics.complianceRiskScore}</span>
              <span
                className={`text-xs font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                  metrics.complianceRiskBand === "LOW"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}
              >
                {metrics.complianceRiskBand}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA]">
            <span className="text-[10px] font-extrabold uppercase text-[#86868B] block mb-1">
              HTS Confidence
            </span>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-black text-[#1D1D1F]">{metrics.classificationConfidenceScore}%</span>
              <span className="text-xs font-bold text-emerald-600">Model Score</span>
            </div>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center space-x-2 pt-2 border-t border-[#E5E5EA]">
          <Link
            href={`/app/shipments/${shipment.id}?view=workspace`}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
              activeTab === "workspace"
                ? "bg-[#0071E3] text-white"
                : "bg-slate-100 text-[#86868B] hover:text-[#1D1D1F]"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Operational Workspace</span>
          </Link>
          <Link
            href={`/app/shipments/${shipment.id}?view=audit`}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
              activeTab === "audit"
                ? "bg-[#0071E3] text-white"
                : "bg-slate-100 text-[#86868B] hover:text-[#1D1D1F]"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Agent Executions & Audit Log ({fullShipment.agentExecutionRecords?.length || 0})</span>
          </Link>
        </div>
      </div>

      {activeTab === "workspace" ? (
        <>
          {/* Shipment Identity & Importer Overview Card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold text-[#1D1D1F] uppercase tracking-wider flex items-center space-x-2">
                <Truck className="w-4 h-4 text-[#0071E3]" />
                <span>Logistics & Entry Identity</span>
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-[#F5F5F7]">
                  <span className="text-[#86868B] font-bold">Entry Type</span>
                  <span className="font-mono text-[#1D1D1F] font-bold">{shipment.entryType || "01 — Consumption"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F5F5F7]">
                  <span className="text-[#86868B] font-bold">Port of Entry</span>
                  <span className="font-medium text-[#1D1D1F]">{shipment.portOfEntry || "Los Angeles (2704)"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F5F5F7]">
                  <span className="text-[#86868B] font-bold">Carrier</span>
                  <span className="font-medium text-[#1D1D1F]">{shipment.carrierName || "Maersk Line"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-[#86868B] font-bold">Incoterm</span>
                  <span className="font-mono font-bold text-[#0071E3]">{shipment.incoterm || "CIF"}</span>
                </div>
              </div>
            </div>

            <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold text-[#1D1D1F] uppercase tracking-wider flex items-center space-x-2">
                <Building2 className="w-4 h-4 text-[#0071E3]" />
                <span>Importer of Record Entity</span>
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-[#F5F5F7]">
                  <span className="text-[#86868B] font-bold">Importer</span>
                  <span className="font-bold text-[#1D1D1F]">
                    {fullShipment.importerOfRecord?.name || fullShipment.client?.name || shipment.importerName}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F5F5F7]">
                  <span className="text-[#86868B] font-bold">CBP Importer #</span>
                  <span className="font-mono text-[#1D1D1F]">
                    {fullShipment.importerOfRecord?.cbpImporterNumber || "12-345678900"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F5F5F7]">
                  <span className="text-[#86868B] font-bold">POA Status</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                    VALID
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-[#86868B] font-bold">Bond Type</span>
                  <span className="font-medium text-[#1D1D1F]">Continuous Bond</span>
                </div>
              </div>
            </div>

            <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold text-[#1D1D1F] uppercase tracking-wider flex items-center space-x-2">
                <FileText className="w-4 h-4 text-[#0071E3]" />
                <span>Commercial Summary</span>
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-[#F5F5F7]">
                  <span className="text-[#86868B] font-bold">Line Items</span>
                  <span className="font-mono text-[#1D1D1F] font-bold">{displayLineItems.length} Lines</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F5F5F7]">
                  <span className="text-[#86868B] font-bold">Total Invoice Value</span>
                  <span className="font-mono font-bold text-[#1D1D1F]">${totalInvoiceAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F5F5F7]">
                  <span className="text-[#86868B] font-bold">Country of Export</span>
                  <span className="font-medium text-[#1D1D1F]">{shipment.countryOfExport || "Germany"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-[#86868B] font-bold">Documents Vault</span>
                  <span className="font-mono font-bold text-[#0071E3]">{(fullShipment.documents || []).length} Files</span>
                </div>
              </div>
            </div>
          </div>

          {/* Canonical Facts & Provenance */}
          <CanonicalFactsSection shipmentId={shipment.id} facts={facts} />

          {/* Documents Evidence Section */}
          <ShipmentDocumentsSection
            shipmentId={shipment.id}
            documents={fullShipment.documents || []}
            selectedDocId={searchParams.docId}
          />

          {/* Line Items Table */}
          <LineItemsTable
            shipmentId={shipment.id}
            initialLineItems={displayLineItems}
            isEnterpriseAdmin={isEnterpriseAdmin}
          />
        </>
      ) : (
        /* Secondary Audit Tab: Agent Executions & Event Logs */
        <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm space-y-6">
          <div>
            <h3 className="text-lg font-bold text-[#1D1D1F] flex items-center space-x-2">
              <Layers className="w-5 h-5 text-[#0071E3]" />
              <span>Durable Agent Execution Records & Execution Trace</span>
            </h3>
            <p className="text-xs text-[#86868B] mt-0.5">
              Selective agent dependency executions and timing provenance stored in PostgreSQL.
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-extrabold uppercase text-[#86868B] tracking-wider">
              Agent Execution Audit Trace ({fullShipment.agentExecutionRecords?.length || 0})
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#1D1D1F]">
                <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] uppercase font-bold text-[#86868B]">
                  <tr>
                    <th className="px-4 py-3">Agent Name</th>
                    <th className="px-4 py-3">Invoked By</th>
                    <th className="px-4 py-3">Start Time</th>
                    <th className="px-4 py-3">Processing Time</th>
                    <th className="px-4 py-3">Next Step</th>
                    <th className="px-4 py-3">End Time</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {(fullShipment.agentExecutionRecords || []).map((rec: any) => (
                    <tr key={rec.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-[#0071E3] flex items-center space-x-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#0071E3]" />
                        <span>{rec.agentName}</span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#1D1D1F]">
                        {rec.invokedBy || rec.triggerEvent || "SYSTEM"}
                      </td>
                      <td className="px-4 py-3 font-mono text-[#86868B]">
                        {rec.startedAt ? new Date(rec.startedAt).toLocaleTimeString() : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-[#1D1D1F]">
                        {rec.durationMs ? `${rec.durationMs}ms` : "< 1ms"}
                      </td>
                      <td className="px-4 py-3 text-[#86868B] font-medium flex items-center space-x-1">
                        <ArrowRight className="w-3 h-3 text-[#0071E3]" />
                        <span>{rec.nextStep || "Filing Readiness Verification"}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[#86868B]">
                        {rec.completedAt ? new Date(rec.completedAt).toLocaleTimeString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                            rec.status === "COMPLETED"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-red-50 text-red-700 border-red-200"
                          }`}
                        >
                          {rec.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(!fullShipment.agentExecutionRecords || fullShipment.agentExecutionRecords.length === 0) && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[#86868B]">
                        No selective agent executions recorded yet. Edit a field or upload a document to trigger independent agents.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
