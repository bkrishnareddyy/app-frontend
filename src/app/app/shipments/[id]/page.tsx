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
  ChevronRight,
  Download,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  Info,
} from "lucide-react";
import { ShipmentDocumentsSection } from "./ShipmentDocumentsSection";
import { PipelineProgressTracker } from "./PipelineProgressTracker";
import { DocumentViewerControls } from "./DocumentViewerControls";

export default async function ShipmentWorkspacePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
      customsFilings: { include: { responses: true } },
    },
  });

  if (!shipment) notFound();

  const totalInvoiceAmount = shipment.lineItems.reduce((acc, item) => acc + Number(item.quantity) * Number(item.unitPrice), 0);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      <PipelineProgressTracker shipmentId={shipment.id} />
      {/* Top Banner Header */}
      <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">
              Shipment: {shipment.shipmentNumber}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              {shipment.status}
            </span>
            <div className="flex items-center space-x-1.5 text-xs text-[#86868B]">
              <Sparkles className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>Consumption Entry • US Customs</span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Link
              href={`/app/decisions?shipmentId=${shipment.id}`}
              className="px-4 py-2 bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] text-xs font-semibold rounded-xl shadow-2xs transition-all flex items-center space-x-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>Ask Qubere AI</span>
            </Link>

            <Link
              href="/app/filing"
              className="px-5 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1.5"
            >
              <span>Send to Filing</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Shipment Metadata Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 pt-4 border-t border-[#E5E5EA] text-xs">
          <div><p className="text-[#86868B]">Importer</p><p className="font-bold text-[#1D1D1F] truncate">{shipment.importerName}</p></div>
          <div><p className="text-[#86868B]">PO / Ref</p><p className="font-bold text-[#1D1D1F]">{shipment.poReference}</p></div>
          <div><p className="text-[#86868B]">Entry Type</p><p className="font-bold text-[#1D1D1F]">{shipment.entryType}</p></div>
          <div><p className="text-[#86868B]">Incoterm</p><p className="font-bold text-[#1D1D1F]">{shipment.incoterm}</p></div>
          <div><p className="text-[#86868B]">Est. Arrival</p><p className="font-bold text-[#1D1D1F]">15 May 2026</p></div>
          <div><p className="text-[#86868B]">Shipment Health</p><p className="font-bold text-emerald-600 flex items-center space-x-1"><CheckCircle2 className="w-3.5 h-3.5" /><span>Healthy</span></p></div>
          <div><p className="text-[#86868B]">Documents</p><p className="font-bold text-[#1D1D1F]">{shipment.documents.filter(d => d.status === "Received").length} / {shipment.documents.length} Received</p></div>
          <div><p className="text-[#86868B]">Risk Score</p><p className="font-bold text-amber-600 flex items-center space-x-1"><span className="w-5 h-5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] flex items-center justify-center font-extrabold">{shipment.riskScore}</span><span>Medium</span></p></div>
        </div>
      </div>

      {/* Top Drawer: Exceptions & Validation Drawer */}
      <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 text-xs">
          <div className="flex items-center space-x-4">
            <button className="font-bold text-[#0071E3] border-b-2 border-[#0071E3] pb-3 -mb-3">Exceptions (5)</button>
            <button className="text-[#86868B] hover:text-[#1D1D1F]">Missing Data (2)</button>
            <button className="text-[#86868B] hover:text-[#1D1D1F]">Conflicts (2)</button>
            <button className="text-[#86868B] hover:text-[#1D1D1F]">Validation (1)</button>
            <button className="text-[#86868B] hover:text-[#1D1D1F]">Warnings (3)</button>
          </div>
          <Link
            href={`/app/decisions?shipmentId=${shipment.id}`}
            className="text-xs font-semibold text-[#0071E3] hover:underline"
          >
            View All Exceptions
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-[#1D1D1F]">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span>HTS Classification Review</span>
            </div>
            <p className="text-[11px] text-[#86868B]">Line 2: Electronic Controller low confidence (76%)</p>
            <Link href={`/app/decisions?shipmentId=${shipment.id}`} className="inline-block text-xs font-semibold text-[#0071E3] hover:underline pt-1">
              Review Classification →
            </Link>
          </div>

          <div className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-[#1D1D1F]">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Certificate of Origin Missing</span>
            </div>
            <p className="text-[11px] text-[#86868B]">Required for US entry & preferential duty rules</p>
            <span className="inline-block text-xs font-semibold text-[#86868B] opacity-50 cursor-not-allowed pt-1" title="Action coming in Gate 2">
              Add Document →
            </span>
          </div>

          <div className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-[#1D1D1F]">
              <Info className="w-4 h-4 text-blue-500" />
              <span>Country of Origin</span>
            </div>
            <p className="text-[11px] text-[#86868B]">Line 2: Electronic Controller origin required</p>
            <span className="inline-block text-xs font-semibold text-[#86868B] opacity-50 cursor-not-allowed pt-1" title="Action coming in Gate 2">
              Provide Origin →
            </span>
          </div>

          <div className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-[#1D1D1F]">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Quantity Mismatch</span>
            </div>
            <p className="text-[11px] text-[#86868B]">Invoice: 20 PCS vs Packing List: 18 PCS</p>
            <span className="inline-block text-xs font-semibold text-[#86868B] opacity-50 cursor-not-allowed pt-1" title="Action coming in Gate 2">
              Review Mismatch →
            </span>
          </div>
        </div>
      </div>

      {/* Main Workspace 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive Documents Set Summary (3 Cols) */}
        <div className="lg:col-span-3">
          <ShipmentDocumentsSection shipmentId={shipment.id} documents={shipment.documents} />
        </div>
              {/* Center Column: Embedded Document Viewer (5 Cols) */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 flex flex-col justify-between overflow-hidden min-h-[480px]">
          {shipment.documents.length > 0 ? (
            (() => {
              const primaryDoc = shipment.documents.find((d) => d.status === "Received") || shipment.documents[0];
              const proxyUrl = primaryDoc.fileUrl?.includes("vercel-storage.com")
                ? `/api/documents/proxy?url=${encodeURIComponent(primaryDoc.fileUrl)}`
                : primaryDoc.fileUrl || "#";

              return (
                <div className="flex flex-col justify-between h-full space-y-4">
                  <div>
                    {/* Viewer Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5E5EA] text-xs">
                      <div className="flex items-center space-x-2 min-w-0">
                        <FileText className="w-4 h-4 text-[#0071E3] shrink-0" />
                        <span className="font-bold text-[#1D1D1F] truncate">{primaryDoc.fileName || "Trade Document"}</span>
                        <span className="text-[#86868B] text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#F5F5F7]">
                          {!primaryDoc.docType || primaryDoc.docType === "AUTO_DETECT" ? "Commercial Invoice" : primaryDoc.docType}
                        </span>
                      </div>
                      <DocumentViewerControls
                        documentId={primaryDoc.id}
                        fileName={primaryDoc.fileName}
                        fileUrl={primaryDoc.fileUrl}
                        proxyUrl={proxyUrl}
                        shipmentNumber={shipment.shipmentNumber}
                      />
                    </div>

                    {/* Document Metadata Details */}
                    <div className="mt-4 p-4 rounded-xl bg-[#F9F9FB] border border-[#E5E5EA] space-y-3">
                      <div className="flex items-center justify-between text-xs pb-2 border-b border-[#E5E5EA]">
                        <span className="text-[#86868B]">Document Status</span>
                        {primaryDoc.extractedJson ? (
                          <span className="font-bold text-emerald-600">Verified & Ingested (AI Vision Parsed)</span>
                        ) : (
                          <span className="font-bold text-amber-600 font-mono">Received (Pending Vision Processing)</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-[10px] text-[#86868B] uppercase font-bold">Uploaded File Name</p>
                          <p className="font-bold text-[#1D1D1F] truncate">{primaryDoc.fileName}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#86868B] uppercase font-bold">Document Type</p>
                          <p className="font-bold text-[#1D1D1F]">{primaryDoc.docType || "Commercial Invoice / Trade Document"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#86868B] uppercase font-bold">Page Count</p>
                          <p className="font-mono text-[#1D1D1F]">{primaryDoc.pageCount ? `${primaryDoc.pageCount} Pages` : "1 Page"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#86868B] uppercase font-bold">Uploaded Date</p>
                          <p className="text-[#1D1D1F]">{new Date(primaryDoc.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>

                    {/* Real Extracted Line Items */}
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-[#1D1D1F]">
                        <span>Extracted Line Items ({shipment.lineItems.length})</span>
                      </div>
                      {shipment.lineItems.length > 0 ? (
                        <div className="border border-[#E5E5EA] rounded-xl overflow-hidden text-xs max-h-48 overflow-y-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-[#F5F5F7] text-[10px] font-bold text-[#86868B] uppercase border-b border-[#E5E5EA]">
                              <tr>
                                <th className="p-2">Description</th>
                                <th className="p-2">HTS Code</th>
                                <th className="p-2 text-right">Qty</th>
                                <th className="p-2 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E5E5EA]">
                              {shipment.lineItems.map((item) => (
                                <tr key={item.id}>
                                  <td className="p-2 font-bold text-[#1D1D1F]">{item.description}</td>
                                  <td className="p-2 font-mono text-[#0071E3]">{item.htsCode}</td>
                                  <td className="p-2 text-right font-mono">{item.quantity}</td>
                                  <td className="p-2 text-right font-mono font-bold">${(Number(item.quantity) * Number(item.unitPrice)).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
                          <p className="font-bold">No Commercial Line Items Extracted</p>
                          <p className="text-[11px]">Line items will appear here automatically upon document vision extraction.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#86868B] pt-3 border-t border-[#E5E5EA]">
                    <span>Vault Document ID: {primaryDoc.id.slice(0, 16)}...</span>
                    <span>Qubere Document Vault</span>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-12 text-xs">
              <FileText className="w-10 h-10 text-[#86868B] opacity-50" />
              <div className="space-y-1">
                <h4 className="font-extrabold text-[#1D1D1F]">No Trade Documents Attached</h4>
                <p className="text-[#86868B] text-[11px]">Upload a Commercial Invoice, Bill of Lading, or Packing List to run vision extraction.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Extracted Entry Data & AI Copilot (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Extracted Entry Data Panel */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Extracted Entry Data</h3>
              {shipment.lineItems.length > 0 ? (
                <span className="text-xs font-bold text-emerald-600">
                  {Math.round(shipment.lineItems.reduce((acc, item) => acc + (item.htsConfidence || 95), 0) / shipment.lineItems.length)}% AI Confidence
                </span>
              ) : (
                <span className="text-xs font-semibold text-amber-700">Pending Vision Scan</span>
              )}
            </div>

            {/* Real Extracted Shipment Metadata Fields */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-0.5">
                <p className="text-[10px] text-[#86868B] font-bold uppercase">Importer of Record</p>
                <p className="font-bold text-[#1D1D1F] truncate">{shipment.importerName || "Not Extracted"}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-0.5">
                <p className="text-[10px] text-[#86868B] font-bold uppercase">Shipper / Exporter</p>
                <p className="font-bold text-[#1D1D1F] truncate">{shipment.countryOfExport ? `Export from ${shipment.countryOfExport}` : "Not Extracted"}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-0.5">
                <p className="text-[10px] text-[#86868B] font-bold uppercase">Incoterms</p>
                <p className="font-bold text-[#1D1D1F]">{shipment.incoterm || "Not Declared"}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-0.5">
                <p className="text-[10px] text-[#86868B] font-bold uppercase">Entry Type</p>
                <p className="font-bold text-[#1D1D1F]">{shipment.entryType || "Consumption Entry"}</p>
              </div>
            </div>

            {/* Line Items Extracted Summary */}
            <div className="space-y-2 pt-2 border-t border-[#E5E5EA]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#1D1D1F]">Extracted Line Items ({shipment.lineItems.length})</span>
                {shipment.lineItems.length > 0 && (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    {shipment.lineItems.length} Verified
                  </span>
                )}
              </div>

              {shipment.lineItems.length > 0 ? (
                shipment.lineItems.map((item) => (
                  <div key={item.id} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1 text-xs">
                    <div className="flex justify-between font-bold text-[#1D1D1F]">
                      <span className="truncate pr-2">Line {item.lineNumber}: {item.description}</span>
                      <span className={item.htsConfidence < 80 ? "text-amber-600 shrink-0" : "text-emerald-600 shrink-0"}>{item.htsConfidence}%</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-[#86868B]">
                      <span>HTS: <strong className="text-[#0071E3]">{item.htsCode}</strong> ({item.countryOfOrigin})</span>
                      <span>USD ${(Number(item.unitPrice) * Number(item.quantity)).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <p className="font-bold">0 Line Items Extracted</p>
                  <p className="text-[11px]">Upload a Commercial Invoice to extract line item descriptions, tariff codes, and quantities.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI Agent Orchestration Pipeline Stepper */}
      <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#0071E3]" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">AI Agent Orchestration</h2>
          </div>
          <span className="text-xs text-[#86868B]">10 Active Pipeline Agents</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-3">
          {[
            { step: 1, name: "Document Intake Agent", status: "Completed", detail: "12 Docs Processed", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 2, name: "Document Intelligence Agent", status: "Completed", detail: "142 Fields Extracted", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 3, name: "Product Intelligence Agent", status: "Completed", detail: "20 Products Identified", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 4, name: "Classification Agent", status: "Review Required", detail: "95% Confidence (2 Items)", badgeBg: "bg-amber-50 text-amber-700 border-amber-200" },
            { step: 5, name: "Origin Agent", status: "Completed", detail: "1 Country Determined", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 6, name: "Valuation Agent", status: "Completed", detail: "USD 13,400.00", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 7, name: "Compliance Agent", status: "Attention", detail: "94% Confidence (1 Issue)", badgeBg: "bg-amber-50 text-amber-700 border-amber-200" },
            { step: 8, name: "Filing Readiness Agent", status: "In Progress", detail: "87% Complete", badgeBg: "bg-blue-50 text-blue-700 border-blue-200" },
            { step: 9, name: "Customs Filing Agent", status: "Pending", detail: "0%", badgeBg: "bg-slate-50 text-slate-600 border-slate-200" },
            { step: 10, name: "Response Management Agent", status: "Waiting", detail: "Waiting", badgeBg: "bg-slate-50 text-slate-600 border-slate-200" },
          ].map((ag) => (
            <div key={ag.step} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-center space-y-1 hover:border-[#0071E3] transition-colors">
              <span className="w-5 h-5 rounded-full bg-white border border-[#E5E5EA] text-[10px] font-bold text-[#1D1D1F] inline-flex items-center justify-center">
                {ag.step}
              </span>
              <p className="text-[11px] font-bold text-[#1D1D1F] line-clamp-1">{ag.name}</p>
              <span className={`inline-block text-[9px] font-semibold px-2 py-0.5 rounded-full border ${ag.badgeBg}`}>
                {ag.status}
              </span>
              <p className="text-[9px] text-[#86868B]">{ag.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
