"use client";

import { useState } from "react";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { Code2, X, CheckCircle2, Clock, Server, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ApiEndpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  name: string;
  description: string;
  status: "READY" | "IN_PROGRESS" | "MOCK";
  tag: string;
}

const API_ENDPOINTS: ApiEndpoint[] = [
  // 🟢 READY TO GO - CUSTOMS CLEARANCE ENGINE & FILING
  {
    method: "GET",
    path: "/api/filing",
    name: "List Customs Filings",
    description: "Fetches customs declarations with natural language search, multi-category filtering (status, date, duty/value, risk), pagination, and metrics.",
    status: "READY",
    tag: "Customs Clearance",
  },
  {
    method: "POST",
    path: "/api/filing",
    name: "Submit Customs Entry",
    description: "Submits official entry summary, computes tariff breakdowns, generates initial CBP response acknowledgements, and records audit logs.",
    status: "READY",
    tag: "Customs Clearance",
  },
  {
    method: "GET",
    path: "/api/filing/[id]",
    name: "Get Filing Workspace Detail",
    description: "Retrieves complete workspace details including line items, itemized duty breakdowns (Section 301, MPF, HMF), trade documents, CBP responses, and AI insights.",
    status: "READY",
    tag: "Customs Clearance",
  },
  {
    method: "PATCH",
    path: "/api/filing/[id]",
    name: "Update Filing Lifecycle State",
    description: "Updates customs filing state transitions (Released, Liquidated, Customs Hold) and payment status.",
    status: "READY",
    tag: "Customs Clearance",
  },
  {
    method: "GET",
    path: "/api/filing/[id]/entry-summary",
    name: "CBP Form 7501 Entry Summary Generator",
    description: "Generates official CBP Form 7501–style entry summary document data packages.",
    status: "READY",
    tag: "Customs Clearance",
  },
  {
    method: "POST",
    path: "/api/filing/[id]/transmit",
    name: "Simulate ABI Transmission",
    description: "Executes simulated ABI entry summary transmission to CBP ACE system and logs customs response feeds.",
    status: "READY",
    tag: "Customs Clearance",
  },
  {
    method: "POST",
    path: "/api/filing/[id]/validate",
    name: "Pre-Filing Validation Rules Engine",
    description: "Runs automated compliance pre-filing validation checks and raises exception items prior to submission.",
    status: "READY",
    tag: "Customs Clearance",
  },
  {
    method: "GET",
    path: "/api/importers-of-record",
    name: "List Importers of Record & Bonds",
    description: "Fetches enterprise Importer of Record entities, active continuous/single bonds, and granted Power of Attorney records.",
    status: "READY",
    tag: "Customs Clearance",
  },

  // 🟢 READY TO GO - HTS MASTER & CLASSIFICATION ENGINE
  {
    method: "GET",
    path: "/api/v1/hts/search",
    name: "HTS Master Code Lookup & Search",
    description: "Searches the real ingested HTS Master Release dataset (29k+ nodes) by keyword, chapter, or code.",
    status: "READY",
    tag: "HTS & Classification",
  },
  {
    method: "GET",
    path: "/api/v1/hts/codes/[code]/rates",
    name: "HTS Code Detail & Rates",
    description: "Retrieves real parsed tariff rates (General, Special, Column 2) from the ingested HTS Master Release data.",
    status: "READY",
    tag: "HTS & Classification",
  },
  {
    method: "POST",
    path: "/api/classification/classify",
    name: "AI Classification Engine",
    description: "Classifies product descriptions into 10-digit HTS codes with legal GRI rule citations, duty rates, and AgentDecision records.",
    status: "READY",
    tag: "HTS & Classification",
  },

  // 🟢 READY TO GO - TARIFF & DUTY SIMULATOR
  {
    method: "GET",
    path: "/api/simulator/scenarios",
    name: "List Landed Cost Scenarios",
    description: "Lists saved landed-cost simulation scenarios across sourcing countries and ports.",
    status: "READY",
    tag: "Duty Simulator",
  },
  {
    method: "POST",
    path: "/api/simulator/scenarios",
    name: "Create Simulation Scenario",
    description: "Creates what-if landed cost scenario for evaluating sourcing shifts, freight cost changes, and tariff impacts.",
    status: "READY",
    tag: "Duty Simulator",
  },
  {
    method: "POST",
    path: "/api/simulator/scenarios/[id]/calculate",
    name: "Calculate Landed Cost",
    description: "Computes effective duty, Section 301/232 tariffs, MPF, HMF, and total landed cost breakdown.",
    status: "READY",
    tag: "Duty Simulator",
  },
  {
    method: "POST",
    path: "/api/simulator/compare",
    name: "Compare Sourcing Scenarios",
    description: "Performs side-by-side comparison of multiple landed cost scenarios for strategic supply chain decisions.",
    status: "READY",
    tag: "Duty Simulator",
  },

  // 🟢 READY TO GO - TARIFF REFUNDS & POST-SUMMARY CORRECTION (PSC)
  {
    method: "POST",
    path: "/api/refunds/opportunities/scan",
    name: "Scan Refund Opportunities",
    description: "Scans historic customs filings to identify duty overpayments and retroactive Section 301 exclusion refunds.",
    status: "READY",
    tag: "Tariff Refunds",
  },
  {
    method: "GET",
    path: "/api/refunds/opportunities",
    name: "List Refund Opportunities",
    description: "Retrieves identified duty refund opportunities with confidence scores and rule basis metadata.",
    status: "READY",
    tag: "Tariff Refunds",
  },
  {
    method: "GET",
    path: "/api/refunds/psc",
    name: "List Post-Summary Corrections",
    description: "Fetches active Post-Summary Corrections (PSC) filed with customs authorities.",
    status: "READY",
    tag: "Tariff Refunds",
  },
  {
    method: "POST",
    path: "/api/refunds/psc",
    name: "Create Post-Summary Correction",
    description: "Drafts a new PSC for duty refund recovery on historic entry summaries.",
    status: "READY",
    tag: "Tariff Refunds",
  },

  // 🟢 READY TO GO - COMPLIANCE AUDIT ENGINE
  {
    method: "POST",
    path: "/api/compliance/audits/run",
    name: "Run Reasonable Care Audit",
    description: "Executes automated 19 U.S.C. 1508 Reasonable Care checklist audits against customs filings.",
    status: "READY",
    tag: "Compliance Audit",
  },
  {
    method: "GET",
    path: "/api/compliance/audits/[id]",
    name: "Generate Reasonable Care Defense File",
    description: "Generates audit defense report packages for customs audit readiness and legal defense.",
    status: "READY",
    tag: "Compliance Audit",
  },

  // 🟢 READY TO GO - BROKERAGE WORKBENCH & EXCEPTIONS
  {
    method: "GET",
    path: "/api/exceptions",
    name: "List Exception Queue",
    description: "Fetches broker exception workbench queue filtered by status, severity, and assignee.",
    status: "READY",
    tag: "Brokerage OS",
  },
  {
    method: "PATCH",
    path: "/api/exceptions/[id]",
    name: "Resolve / Reassign Exception",
    description: "Resolves or reassigns broker exception queue items with audit notes.",
    status: "READY",
    tag: "Brokerage OS",
  },

  // 🟢 READY TO GO - TRADE ADVISORY & POLICY AGENT
  {
    method: "POST",
    path: "/api/advisory/origin-determination",
    name: "Calculate FTA Origin Eligibility",
    description: "Evaluates Free Trade Agreement (USMCA, KORUS) origin qualification rules and RVC percentages.",
    status: "READY",
    tag: "Trade Advisory",
  },
  {
    method: "POST",
    path: "/api/advisory/query",
    name: "AI Policy Agent Q&A",
    description: "Runs trade policy and regulatory queries returning evidence-backed answers and legal citations.",
    status: "READY",
    tag: "Trade Advisory",
  },
  {
    method: "GET",
    path: "/api/regulatory/[id]/impacted",
    name: "List Impacted Shipments",
    description: "Retrieves specific tenant shipments affected by a global regulatory update.",
    status: "READY",
    tag: "Trade Advisory",
  },

  // 🟢 READY TO GO - DUTY DRAWBACK AUTOMATION
  {
    method: "GET",
    path: "/api/exports/shipments",
    name: "List Export Shipments",
    description: "Manages export side shipment records required for import-export drawback matching.",
    status: "READY",
    tag: "Duty Drawback",
  },
  {
    method: "POST",
    path: "/api/drawback/match",
    name: "Import-Export Matching Engine",
    description: "Runs FIFO/LIFO matching algorithm between import line items and export shipments for drawback refunds.",
    status: "READY",
    tag: "Duty Drawback",
  },
  {
    method: "GET",
    path: "/api/drawback/claims",
    name: "List Duty Drawback Claims",
    description: "Retrieves prepared duty drawback refund claims submitted to customs.",
    status: "READY",
    tag: "Duty Drawback",
  },

  // DENIED PARTY SCREENING & EMBARGOES
  {
    method: "POST",
    path: "/api/demo/screening/dps",
    name: "Denied Party & Sanctions Screening",
    description:
      "Substring match against whatever denied-party rows are loaded. No OFAC, BIS, UN or EU list is ingested, so this cannot clear a party.",
    status: "MOCK",
    tag: "Sanctions & Screening",
  },
  {
    method: "POST",
    path: "/api/screening/embargo",
    name: "Embargo & UFLPA Region Screening",
    description:
      "Matches origin, transshipment and manufacturer text against loaded embargo rules. Returns not-screened until rules are ingested.",
    status: "MOCK",
    tag: "Sanctions & Screening",
  },
  {
    method: "GET",
    path: "/api/trade-intel/benchmarks",
    name: "Global Trade Intelligence Benchmarks",
    description: "Retrieves nationwide duty, valuation, and trade volume benchmarks by HTS code for strategic sourcing comparisons.",
    status: "READY",
    tag: "Trade Intelligence",
  },

  // 🟢 READY TO GO - SHIPMENTS & DOCUMENTS
  {
    method: "GET",
    path: "/api/shipments",
    name: "List Tenant Shipments",
    description: "Fetches all active shipments for the authenticated account with line items and documents.",
    status: "READY",
    tag: "Shipments & Docs",
  },
  {
    method: "POST",
    path: "/api/documents/upload",
    name: "Upload Trade Document",
    description: "Uploads commercial trade files (Commercial Invoice, BOL, Packing List) and runs OCR intake.",
    status: "READY",
    tag: "Shipments & Docs",
  },
  {
    method: "GET",
    path: "/api/decisions",
    name: "List AI Agent Decisions",
    description: "Fetches AI agent classification and compliance decisions requiring human review.",
    status: "READY",
    tag: "AI Decisions",
  },
  {
    method: "POST",
    path: "/api/assistant/chat",
    name: "Streaming AI Chat Assistant",
    description: "Interactive real-time streaming LLM chat assistant with RBAC-gated tool access, quota metering, and audit logging.",
    status: "READY",
    tag: "AI Decisions",
  },
];

interface ApiStatusDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ApiStatusDrawer({ isOpen, onClose }: ApiStatusDrawerProps) {
  const [activeTab, setActiveTab] = useState<"READY" | "IN_PROGRESS">("READY");
  const [selectedTag, setSelectedTag] = useState<string>("ALL");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const drawerRef = useDialogFocus<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  const readyApis = API_ENDPOINTS.filter((e) => e.status === "READY");
  const inProgressApis = API_ENDPOINTS.filter((e) => e.status !== "READY");

  const currentTabList = activeTab === "READY" ? readyApis : inProgressApis;
  const tags = ["ALL", ...Array.from(new Set(currentTabList.map((e) => e.tag)))];

  const currentList = selectedTag === "ALL"
    ? currentTabList
    : currentTabList.filter((e) => e.tag === selectedTag);

  const handleCopy = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-directory-title"
        tabIndex={-1}
        className="bg-white rounded-3xl border border-border shadow-2xl max-w-4xl w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-brand text-white flex items-center justify-center shadow-md shadow-brand/20">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="api-directory-title" className="text-lg font-extrabold text-ink tracking-tight">Qubere Trade API Directory</h2>
              <p className="text-xs text-ink-muted">Complete REST API endpoints across all 8 enterprise product lines</p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close API directory"
            className="p-1.5 rounded-full hover:bg-surface-muted text-ink-muted hover:text-ink transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher & Filters */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center bg-surface-muted p-1 rounded-2xl border border-border text-xs font-bold w-full sm:w-auto">
            <button
              onClick={() => { setActiveTab("READY"); setSelectedTag("ALL"); }}
              className={`px-4 py-2 rounded-xl transition-all flex items-center justify-center space-x-2 cursor-pointer ${
                activeTab === "READY"
                  ? "bg-white text-brand shadow-xs"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>Ready Endpoint APIs ({readyApis.length})</span>
            </button>

            <button
              onClick={() => { setActiveTab("IN_PROGRESS"); setSelectedTag("ALL"); }}
              className={`px-4 py-2 rounded-xl transition-all flex items-center justify-center space-x-2 cursor-pointer ${
                activeTab === "IN_PROGRESS"
                  ? "bg-white text-purple-600 shadow-xs"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              <Clock className="w-4 h-4 text-amber-500" />
              <span>Not production ready ({inProgressApis.length})</span>
            </button>
          </div>

          {/* Tag Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 text-sm font-semibold">
            {tags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
                  selectedTag === tag
                    ? "bg-brand text-white border-brand"
                    : "bg-surface-muted text-ink-muted border-border hover:text-ink"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* API Endpoint Cards List */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {currentList.map((api, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-2xl bg-surface-muted border border-border space-y-1.5 hover:border-brand transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 font-mono text-xs">
                  <span
                    className={`px-2 py-0.5 rounded-md font-bold text-sm ${
                      api.method === "GET"
                        ? "bg-emerald-100 text-emerald-800"
                        : api.method === "POST"
                        ? "bg-blue-100 text-brand"
                        : "bg-purple-100 text-purple-800"
                    }`}
                  >
                    {api.method}
                  </span>
                  <span className="font-bold text-ink">{api.path}</span>
                  <button
                    onClick={() => handleCopy(api.path)}
                    className="p-1 text-ink-muted hover:text-brand transition-colors cursor-pointer"
                  >
                    {copiedPath === api.path ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <span className="text-sm font-bold px-2.5 py-0.5 rounded-full bg-white border border-border text-brand">
                  {api.tag}
                </span>
              </div>

              <p className="text-xs font-bold text-ink">{api.name}</p>
              <p className="text-xs text-ink-muted leading-relaxed">{api.description}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-border flex items-center justify-between shrink-0 text-xs text-ink-muted">
          <span className="flex items-center space-x-1.5">
            <Server className="w-3.5 h-3.5 text-brand" />
            <span>Base URL: <strong className="text-ink">https://app.qubere.ai</strong></span>
          </span>
          <Button onClick={onClose} className="px-4 py-2">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
