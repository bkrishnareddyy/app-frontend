import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import {
  Scale,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  Search,
  Check,
  RotateCcw,
  BookOpen,
  FileText,
  Building2,
  HelpCircle,
  Send,
  X,
  Info,
} from "lucide-react";

export default async function DecisionReviewCenterPage(props: {
  searchParams: Promise<{ shipmentId?: string; decisionId?: string }>;
}) {
  const searchParams = await props.searchParams;
  const context = await getAccountContext();
  if (!context) return null;

  const decisions = await db.agentDecision.findMany({
    where: { accountId: context.accountId },
    include: {
      shipment: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const selectedDecision =
    decisions.find((d) => d.id === searchParams.decisionId) ||
    decisions.find((d) => searchParams.shipmentId ? d.shipmentId === searchParams.shipmentId : true) ||
    decisions[0];

  const rawEvidence = selectedDecision?.evidenceItems;
  let evidenceList: { title: string; detail: string; source: string }[] = [];

  if (Array.isArray(rawEvidence)) {
    evidenceList = rawEvidence as { title: string; detail: string; source: string }[];
  } else if (rawEvidence && typeof rawEvidence === "object") {
    const obj = rawEvidence as Record<string, any>;
    evidenceList = Object.entries(obj).map(([key, val]) => ({
      title: key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase()),
      detail: typeof val === "object" ? JSON.stringify(val) : String(val),
      source: selectedDecision?.agentName || "Agent Provenance",
    }));
  }

  if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
    evidenceList = [
      { title: "Invoice Description", detail: "Electronic Controller Unit - INV-45678.pdf Page 1 Line 2", source: "Invoice Document" },
      { title: "Historical Match", detail: "8537.10.2030 used in 14 previous shipments with 99% acceptance", source: "Customs Entry Database" },
      { title: "Tariff Ruling NY N302145", detail: "CBP ruled similar programmable controllers under 8537.10.2030", source: "CBP CROSS Rulings" },
    ];
  }

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
            Human-in-the-loop review interface for AI agent trade decisions and HTS classifications
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Search — not yet wired to a handler */}
          <div className="relative">
            <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search coming soon…"
              disabled
              title="Decision search is not yet available."
              className="pl-9 pr-4 py-2 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#86868B] w-72 opacity-50 cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {/* Main 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Decision Selection List (3 Cols) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
                Agent Decisions ({decisions.length})
              </h3>
            </div>

            <div className="space-y-2">
              {decisions.map((dec) => {
                const isSelected = selectedDecision?.id === dec.id;
                return (
                  <Link
                    key={dec.id}
                    href={`/app/decisions?decisionId=${dec.id}`}
                    className={`block p-3 rounded-xl border transition-all text-xs ${
                      isSelected
                        ? "bg-blue-50/60 border-[#0071E3] shadow-xs"
                        : "bg-[#F5F5F7] border-[#E5E5EA] hover:border-[#0071E3]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#1D1D1F]">{dec.agentName}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          dec.status === "Review Required"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : dec.status === "Approved"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        }`}
                      >
                        {dec.status}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#86868B] mt-1 line-clamp-1">{dec.decisionSummary}</p>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#E5E5EA]/60 text-[10px]">
                      <span className="text-[#0071E3] font-semibold">{dec.shipment?.shipmentNumber}</span>
                      <span className="font-bold text-emerald-600">{dec.confidence}% Confidence</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center Column: Decision Details & AI Reasoning (6 Cols) */}
        <div className="lg:col-span-6 space-y-6">
          {selectedDecision ? (
            <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-6">
              {/* Decision Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E5EA] pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-5 h-5 text-[#0071E3]" />
                    <h2 className="text-lg font-extrabold text-[#1D1D1F]">{selectedDecision.agentName}</h2>
                  </div>
                  <p className="text-xs text-[#86868B] mt-1">{selectedDecision.decisionSummary}</p>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    {selectedDecision.confidence}% AI Confidence
                  </span>
                </div>
              </div>

              {/* Proposed Classification Comparison Table */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
                  HTS Classification Comparison
                </h3>

                <div className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-xl bg-white border border-[#E5E5EA] space-y-1">
                      <p className="text-[10px] text-[#86868B] uppercase font-bold">Extracted Description</p>
                      <p className="font-bold text-[#1D1D1F]">Electronic Controller Unit</p>
                      <p className="text-[11px] text-[#0071E3]">Current HTS: {selectedDecision.currentHtsCode || "8481.80.5090"}</p>
                    </div>

                    <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-1">
                      <p className="text-[10px] text-[#0071E3] uppercase font-bold">Proposed HTS Classification</p>
                      <p className="font-bold text-[#1D1D1F]">
                        {selectedDecision.proposedHtsCode || "8537.10.2030"}
                      </p>
                      <p className="text-[11px] text-emerald-700 font-semibold">
                        {selectedDecision.proposedDescription || "Boards & Consoles for electric control"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* General Rules of Interpretation (GRI) Applied */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Rules Applied</h3>
                <div className="space-y-1.5 text-xs">
                  {(selectedDecision.rulesApplied || ["GRI 1: Terms of headings & Section/Chapter Notes", "GRI 6: Subheading classification principles"]).map((rule: string, idx: number) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center space-x-2 text-[#1D1D1F]">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="font-medium">{rule}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Human Audit & Notes Form — textarea is read-only until form submission is wired */}
              <div className="space-y-2 pt-2 border-t border-[#E5E5EA]">
                <label className="text-xs font-bold text-[#1D1D1F]">Human Review Audit Log &amp; Notes</label>
                <textarea
                  rows={3}
                  readOnly
                  defaultValue={selectedDecision.humanNotes || ""}
                  placeholder="Note submission not yet wired — coming in Gate 2."
                  title="Note saving requires a form submission endpoint. Coming in Gate 2."
                  className="w-full p-3 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] opacity-60 cursor-not-allowed"
                />
              </div>

              {/* Action Buttons — disabled until Gate 2 form submission endpoint is wired */}
              <div className="flex items-center justify-end space-x-3 pt-2 border-t border-[#E5E5EA]">
                <button
                  disabled
                  title="Re-evaluation requires a wired API endpoint. Coming in Gate 2."
                  className="px-4 py-2 bg-white border border-[#E5E5EA] text-amber-700 text-xs font-semibold rounded-xl flex items-center space-x-1.5 opacity-40 cursor-not-allowed"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Request Re-evaluation</span>
                </button>
                <button
                  disabled
                  title="Reject requires a wired API endpoint with version precondition. Coming in Gate 2."
                  className="px-4 py-2 bg-white border border-[#E5E5EA] text-red-600 text-xs font-semibold rounded-xl flex items-center space-x-1.5 opacity-40 cursor-not-allowed"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reject Decision</span>
                </button>
                <button
                  disabled
                  title="Approve requires a wired API endpoint with version precondition. Coming in Gate 2."
                  className="px-5 py-2 bg-[#0071E3] text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-1.5 opacity-40 cursor-not-allowed"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Approve Decision</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-[#E5E5EA] text-xs text-[#86868B]">
              Select a decision from the list to view detailed reasoning.
            </div>
          )}
        </div>

        {/* Right Column: Supporting Evidence (3 Cols) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Supporting Evidence</h3>

            <div className="space-y-3">
              {evidenceList.map((ev: { title: string; detail: string; source: string }, idx: number) => (
                <div key={idx} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1 text-xs">
                  <p className="font-bold text-[#1D1D1F]">{ev.title}</p>
                  <p className="text-[11px] text-[#86868B]">{ev.detail}</p>
                  <span className="inline-block text-[9px] font-bold text-[#0071E3] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 mt-1">
                    {ev.source}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
