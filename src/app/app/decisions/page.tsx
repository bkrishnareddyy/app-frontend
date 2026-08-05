import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Filter,
  FileText,
  ExternalLink,
  ShieldCheck,
  Scale,
  RefreshCw,
  XCircle,
  Check,
} from "lucide-react";

export default async function DecisionReviewCenterPage() {
  const context = await getAccountContext();
  if (!context) return null;

  const decisions = await db.agentDecision.findMany({
    where: { accountId: context.accountId },
    include: { shipment: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <Scale className="w-5 h-5 text-[#0071E3]" />
            <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">Decision Review Center</h1>
          </div>
          <p className="text-xs text-[#86868B] mt-1">
            Review and approve AI agent recommendations for shipment SHP-2026-004872
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-900 flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-[#0071E3]" />
            <span>Filing Readiness: <strong>87% (2 blocking issues)</strong></span>
          </div>

          <Link
            href="/app/shipments/SHP-2026-004872"
            className="px-4 py-2 bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] text-xs font-semibold rounded-xl shadow-2xs transition-all"
          >
            View Readiness
          </Link>
        </div>
      </div>

      {/* Main 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Decision Selection List (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Decision Category Tabs */}
          <div className="flex items-center justify-between bg-white p-2 rounded-2xl border border-[#E5E5EA] text-xs font-semibold">
            <button className="px-3 py-1.5 rounded-xl bg-[#0071E3] text-white">All Decisions (7)</button>
            <button className="px-3 py-1.5 rounded-xl text-amber-700 bg-amber-50">Needs Review (2)</button>
            <button className="px-3 py-1.5 rounded-xl text-[#86868B] hover:text-[#1D1D1F]">Warnings (5)</button>
            <button className="px-3 py-1.5 rounded-xl text-emerald-700 bg-emerald-50">Approved (18)</button>
          </div>

          {/* Decision Cards List */}
          <div className="space-y-3">
            {decisions.map((dec) => (
              <div
                key={dec.id}
                className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                  dec.agentName === "Classification Agent"
                    ? "bg-white border-[#0071E3] shadow-md ring-2 ring-[#0071E3]/10"
                    : "bg-white border-[#E5E5EA] hover:border-[#0071E3] shadow-2xs"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center font-bold text-xs">
                      ⚖️
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-[#1D1D1F]">{dec.agentName}</h4>
                      <p className="text-[10px] text-[#86868B]">Confidence: {dec.confidence}%</p>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                      dec.status === "Review Required"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : dec.status === "Approved"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-blue-50 text-blue-700 border-blue-200"
                    }`}
                  >
                    {dec.status}
                  </span>
                </div>
                <p className="text-xs text-[#86868B]">{dec.decisionSummary}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Center Column: Decision Details & AI Reasoning (5 Cols) */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-6 flex flex-col justify-between">
          <div className="space-y-6">
            {/* Header & Tabs */}
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#1D1D1F]">Classification Agent Decision</h3>
                <p className="text-xs text-[#86868B]">AI Agent Recommendation for 2 line items</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                Review Required
              </span>
            </div>

            {/* AI Recommendation Summary */}
            <div className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-[#1D1D1F]">AI Recommendation</p>
                <p className="text-[11px] text-[#86868B]">The agent recommends the following classification for 2 line items</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-[#86868B]">Average Confidence</p>
                <p className="text-xl font-extrabold text-amber-600">76%</p>
              </div>
            </div>

            {/* Proposed HTS Codes Table */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#1D1D1F]">Proposed HTS Classifications</h4>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5EA] text-[#86868B]">
                    <th className="pb-2">Line</th>
                    <th className="pb-2">Product Description</th>
                    <th className="pb-2">Proposed HTS</th>
                    <th className="pb-2">Confidence</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  <tr>
                    <td className="py-2.5 font-bold text-[#1D1D1F]">3</td>
                    <td className="py-2.5 text-[#1D1D1F]">Electronic Controller Model EC-2000</td>
                    <td className="py-2.5 font-bold text-[#0071E3]">8537.10.2030</td>
                    <td className="py-2.5 text-amber-600 font-bold">76%</td>
                    <td className="py-2.5"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Review</span></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-bold text-[#1D1D1F]">7</td>
                    <td className="py-2.5 text-[#1D1D1F]">Stainless Steel Valve 1/2" NPT, 316 Grade</td>
                    <td className="py-2.5 font-bold text-[#0071E3]">8481.80.5090</td>
                    <td className="py-2.5 text-amber-600 font-bold">74%</td>
                    <td className="py-2.5"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Review</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Summary Metadata */}
            <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-xs">
              <div><p className="text-[#86868B]">Purpose</p><p className="font-semibold text-[#1D1D1F]">Determine correct HS/HTS classification for all line items</p></div>
              <div><p className="text-[#86868B]">Data Sources</p><p className="font-semibold text-[#1D1D1F]">Documents, Product Master, Historical Shipments, Tariff Rulings</p></div>
              <div><p className="text-[#86868B]">Regulations</p><p className="font-semibold text-[#1D1D1F]">US HTS 2025, General Rules of Interpretation (GRI 1 & 6)</p></div>
              <div><p className="text-[#86868B]">Executed At</p><p className="font-semibold text-[#1D1D1F]">10:21 AM • 12 May 2026</p></div>
            </div>
          </div>

          {/* Action Buttons Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-[#E5E5EA] gap-3">
            <button className="px-4 py-2.5 bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] text-xs font-semibold rounded-xl shadow-2xs flex items-center space-x-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>Request Re-evaluation</span>
            </button>

            <div className="flex items-center space-x-2">
              <button className="px-4 py-2.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 text-xs font-semibold rounded-xl flex items-center space-x-1">
                <XCircle className="w-3.5 h-3.5" />
                <span>Reject Decision</span>
              </button>

              <button className="px-5 py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-1.5">
                <Check className="w-4 h-4" />
                <span>Approve All Items</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Supporting Evidence & Human Audit Notes (3 Cols) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Supporting Evidence Card */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Supporting Evidence</h3>
              <span className="text-xs font-semibold text-[#0071E3]">6 Sources</span>
            </div>

            <div className="space-y-2 text-xs">
              {[
                { type: "PDF", title: "Commercial Invoice", subtitle: "INV-45678.pdf", badge: "Primary Source" },
                { type: "PDF", title: "Product Specification", subtitle: "SPEC-EC-2000.pdf" },
                { type: "XLS", title: "Historical Shipment", subtitle: "HS-2026-001234.xlsx" },
                { type: "LINK", title: "US HTS 8537.10.2030", subtitle: "Official Tariff Database" },
                { type: "LINK", title: "US HTS 8481.80.5090", subtitle: "Official Tariff Database" },
                { type: "LINK", title: "WCO Explanatory Notes", subtitle: "Chapter 85" },
              ].map((ev, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between hover:border-[#0071E3] transition-colors">
                  <div className="flex items-center space-x-2.5">
                    <FileText className="w-4 h-4 text-red-500 shrink-0" />
                    <div>
                      <p className="font-bold text-[#1D1D1F]">{ev.title}</p>
                      <p className="text-[10px] text-[#86868B]">{ev.subtitle}</p>
                    </div>
                  </div>
                  {ev.badge ? (
                    <span className="text-[9px] font-bold text-[#0071E3] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                      {ev.badge}
                    </span>
                  ) : (
                    <ExternalLink className="w-3.5 h-3.5 text-[#86868B]" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Human Audit Notes Card */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Human Notes & Audit</h3>
            <textarea
              rows={4}
              placeholder="Add your notes for this decision..."
              className="w-full p-3 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
            />
            <button className="w-full py-2 bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] text-xs font-semibold rounded-xl shadow-2xs transition-all">
              Save Audit Note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
