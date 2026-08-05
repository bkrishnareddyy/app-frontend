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

  const totalInvoiceAmount = shipment.lineItems.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
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

      {/* AI Agent Orchestration Pipeline Stepper (Detailed with Confidence) */}
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

      {/* Main Workspace 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive Documents Set Summary (3 Cols) */}
        <div className="lg:col-span-3">
          <ShipmentDocumentsSection shipmentId={shipment.id} documents={shipment.documents} />
        </div>

        {/* Center Column: Embedded Commercial Invoice Viewer (5 Cols) */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 flex flex-col justify-between overflow-hidden">
          <div>
            {/* Viewer Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5E5EA] text-xs">
              <div className="flex items-center space-x-1.5 min-w-0">
                <span className="font-bold text-[#1D1D1F] shrink-0">Commercial Invoice</span>
                <span className="text-[#86868B] truncate text-[11px]">(INV-45678.pdf)</span>
              </div>
              <div className="flex items-center space-x-1.5 shrink-0">
                <button className="p-1 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F]"><ChevronLeft className="w-3.5 h-3.5" /></button>
                <span className="text-[11px] text-[#86868B]">1 / 2</span>
                <button className="p-1 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F]"><ChevronRight className="w-3.5 h-3.5" /></button>
                <span className="h-4 w-px bg-[#E5E5EA] mx-1" />
                <button className="p-1 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F]"><ZoomOut className="w-3.5 h-3.5" /></button>
                <span className="text-[11px] font-semibold text-[#1D1D1F]">100%</span>
                <button className="p-1 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F]"><ZoomIn className="w-3.5 h-3.5" /></button>
                <button className="p-1 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F]"><Download className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            {/* Embedded Invoice Document Canvas Mockup */}
            <div className="mt-4 p-5 rounded-xl bg-[#F9F9FB] border border-[#E5E5EA] space-y-4 text-xs font-mono overflow-x-auto">
              <div className="flex justify-between border-b border-[#E5E5EA] pb-3 min-w-[380px]">
                <div>
                  <p className="font-bold text-sm text-[#1D1D1F]">ABC Exports GmbH</p>
                  <p className="text-[10px] text-[#86868B]">Buyer / Importer: {shipment.importerName}</p>
                  <p className="text-[10px] text-[#86868B]">123 Industrial Area, Mumbai 400001</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-xs text-[#1D1D1F]">COMMERCIAL INVOICE</p>
                  <p className="text-[10px] text-[#0071E3]">INV-45678</p>
                  <p className="text-[10px] text-[#86868B]">Date: 15 May 2026</p>
                  <p className="text-[10px] text-[#86868B]">Incoterm: {shipment.incoterm}</p>
                </div>
              </div>

              {/* Invoice Line Items Table (Fixed Grid Spacing & Explicit Padding) */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse min-w-[420px]">
                  <thead>
                    <tr className="border-b border-[#E5E5EA] text-[#86868B]">
                      <th className="pb-2 font-semibold pr-3">Description</th>
                      <th className="pb-2 font-semibold px-2">HS Code</th>
                      <th className="pb-2 font-semibold px-2">Origin</th>
                      <th className="pb-2 font-semibold px-2 text-center">Qty</th>
                      <th className="pb-2 font-semibold px-2 text-right">Unit Price</th>
                      <th className="pb-2 font-semibold pl-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E5EA]">
                    {shipment.lineItems.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2.5 pr-3 text-[#1D1D1F] font-bold max-w-[140px] truncate">{item.description}</td>
                        <td className="py-2.5 px-2 text-[#0071E3] font-medium whitespace-nowrap">{item.htsCode}</td>
                        <td className="py-2.5 px-2 text-[#86868B] whitespace-nowrap">{item.countryOfOrigin}</td>
                        <td className="py-2.5 px-2 text-[#1D1D1F] text-center whitespace-nowrap">{item.quantity} PCS</td>
                        <td className="py-2.5 px-2 text-[#1D1D1F] text-right whitespace-nowrap">${item.unitPrice.toFixed(2)}</td>
                        <td className="py-2.5 pl-2 text-right font-bold text-[#1D1D1F] whitespace-nowrap">${(item.quantity * item.unitPrice).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-3 border-t border-[#E5E5EA]">
                <div className="text-right space-y-1 text-xs">
                  <p className="text-[#86868B]">Subtotal: <span className="font-bold text-[#1D1D1F]">${totalInvoiceAmount.toLocaleString()}</span></p>
                  <p className="text-[#86868B]">Freight & Insurance: <span className="font-bold text-[#1D1D1F]">$2,850.00</span></p>
                  <p className="font-bold text-[#1D1D1F] text-sm">Invoice Total (CIF): ${(totalInvoiceAmount + 2850).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-[#86868B] pt-3">
            <span>Page 1 of 2</span>
            <span>Document ID: doc_inv_45678</span>
          </div>
        </div>

        {/* Right Column: Extracted Entry Data & AI Copilot (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Extracted Entry Data Panel */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Extracted Entry Data</h3>
              <span className="text-xs font-bold text-emerald-600">96% Confidence</span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex justify-between items-center"><span className="text-[#86868B]">Header Information</span><span className="font-bold text-emerald-600">95% ✓</span></div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex justify-between items-center"><span className="text-[#86868B]">Parties & Importer</span><span className="font-bold text-emerald-600">98% ✓</span></div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex justify-between items-center"><span className="text-[#86868B]">Transport & Port</span><span className="font-bold text-emerald-600">93% ✓</span></div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex justify-between items-center"><span className="text-[#86868B]">Commercial Terms</span><span className="font-bold text-emerald-600">96% ✓</span></div>
            </div>

            {/* Line Items Extracted Summary */}
            <div className="space-y-2 pt-2 border-t border-[#E5E5EA]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#1D1D1F]">Line Items ({shipment.lineItems.length})</span>
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">2 Issues</span>
              </div>

              {shipment.lineItems.map((item) => (
                <div key={item.id} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1 text-xs">
                  <div className="flex justify-between font-bold text-[#1D1D1F]">
                    <span className="truncate pr-2">Line {item.lineNumber}: {item.description}</span>
                    <span className={item.htsConfidence < 80 ? "text-amber-600 shrink-0" : "text-emerald-600 shrink-0"}>{item.htsConfidence}%</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-[#86868B]">
                    <span>HTS: <strong className="text-[#0071E3]">{item.htsCode}</strong> ({item.countryOfOrigin})</span>
                    <span>USD ${(item.unitPrice * item.quantity).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Copilot & Regulatory Alerts Panel */}
          <div className="bg-gradient-to-br from-[#0071E3]/5 to-purple-50 p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-[#0071E3]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Qubere AI Copilot</h3>
            </div>

            <div className="space-y-1.5 text-xs">
              <button className="w-full text-left p-2 rounded-xl bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] transition-all">
                Why is HTS review required?
              </button>
              <button className="w-full text-left p-2 rounded-xl bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] transition-all">
                Explain valuation calculation
              </button>
              <button className="w-full text-left p-2 rounded-xl bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] transition-all">
                Show compliance requirements
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Drawer: Exceptions & Validation Drawer */}
      <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 text-xs">
          <div className="flex items-center space-x-4">
            <button className="font-bold text-[#0071E3] border-b-2 border-[#0071E3] pb-3 -mb-3">Exceptions (5)</button>
            <button className="text-[#86868B] hover:text-[#1D1D1F]">Missing Data (2)</button>
            <button className="text-[#86868B] hover:text-[#1D1D1F]">Conflicts (2)</button>
            <button className="text-[#86868B] hover:text-[#1D1D1F]">Validation (1)</button>
            <button className="text-[#86868B] hover:text-[#1D1D1F]">Warnings (3)</button>
          </div>
          <Link href="/app/exceptions" className="text-[#0071E3] font-semibold hover:underline">View All Exceptions</Link>
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
            <button className="text-xs font-semibold text-[#0071E3] hover:underline pt-1">
              Add Document →
            </button>
          </div>

          <div className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-[#1D1D1F]">
              <Info className="w-4 h-4 text-blue-500" />
              <span>Country of Origin</span>
            </div>
            <p className="text-[11px] text-[#86868B]">Line 2: Electronic Controller origin required</p>
            <button className="text-xs font-semibold text-[#0071E3] hover:underline pt-1">
              Provide Origin →
            </button>
          </div>

          <div className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-[#1D1D1F]">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Quantity Mismatch</span>
            </div>
            <p className="text-[11px] text-[#86868B]">Invoice: 20 PCS vs Packing List: 18 PCS</p>
            <button className="text-xs font-semibold text-[#0071E3] hover:underline pt-1">
              Review Mismatch →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
