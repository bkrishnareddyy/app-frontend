"use client";

import { useState } from "react";
import { Code2, X, CheckCircle2, Clock, Sparkles, Server, Copy, Check, ArrowUpRight } from "lucide-react";

interface ApiEndpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  name: string;
  description: string;
  status: "READY" | "IN_PROGRESS";
  tag: string;
}

const API_ENDPOINTS: ApiEndpoint[] = [
  // 🟢 READY TO GO
  {
    method: "GET",
    path: "/api/shipments",
    name: "List Tenant Shipments",
    description: "Fetches all active shipments for the authenticated account with line items and documents.",
    status: "READY",
    tag: "Shipment Operations",
  },
  {
    method: "POST",
    path: "/api/shipments",
    name: "Create Shipment",
    description: "Creates a new shipment with dynamic auto-incrementing shipment numbers (SHP-2026-XXXXXX).",
    status: "READY",
    tag: "Shipment Operations",
  },
  {
    method: "GET",
    path: "/api/shipments/[id]",
    name: "Get Shipment Detail",
    description: "Retrieves complete shipment data, line items, documents set, and agent decisions.",
    status: "READY",
    tag: "Shipment Operations",
  },
  {
    method: "POST",
    path: "/api/documents/upload",
    name: "Upload Trade Document",
    description: "Uploads commercial trade files via Vercel Blob Storage in production or local storage.",
    status: "READY",
    tag: "Document Intelligence",
  },
  {
    method: "GET",
    path: "/api/decisions",
    name: "List Agent Decisions",
    description: "Fetches all AI agent decisions requiring human review for HTS classification & compliance.",
    status: "READY",
    tag: "AI Decisions",
  },
  {
    method: "POST",
    path: "/api/decisions",
    name: "Submit Human Review",
    description: "Processes human-in-the-loop actions (APPROVE, REJECT, RE_EVALUATE) with audit comments.",
    status: "READY",
    tag: "AI Decisions",
  },
  {
    method: "GET",
    path: "/api/filing",
    name: "List Customs Filings",
    description: "Fetches customs entry summaries (CBP 7501), duty breakdowns, and CBP response feeds.",
    status: "READY",
    tag: "Customs Filing",
  },
  {
    method: "POST",
    path: "/api/filing",
    name: "Submit Customs Entry",
    description: "Creates official customs entry filing and triggers automated ABI customs transmission.",
    status: "READY",
    tag: "Customs Filing",
  },
  {
    method: "GET",
    path: "/api/regulatory",
    name: "Regulatory Intelligence",
    description: "Queries real-time regulatory updates and analytics across global trade jurisdictions.",
    status: "READY",
    tag: "Regulatory Intel",
  },
  {
    method: "POST",
    path: "/api/auth/switch-account",
    name: "Switch Workspace Account",
    description: "Sets multi-tenant context cookie for switching between enterprise workspaces.",
    status: "READY",
    tag: "Multi-Tenancy",
  },
  {
    method: "GET",
    path: "/api/admin/account",
    name: "Account Administration",
    description: "Manages company profile settings, account name, slug, and subscription metadata.",
    status: "READY",
    tag: "Account Admin",
  },
  {
    method: "GET",
    path: "/api/admin/users",
    name: "User & Role Management",
    description: "Manages workspace user memberships and RBAC permission roles (OWNER, ADMIN, MEMBER).",
    status: "READY",
    tag: "Account Admin",
  },

  // 🚀 IN PROGRESS / ROADMAP
  {
    method: "POST",
    path: "/api/copilot/chat",
    name: "Qubere AI Copilot Streaming",
    description: "Streaming LLM endpoint powering interactive compliance chat & shipment summaries.",
    status: "IN_PROGRESS",
    tag: "AI Intelligence",
  },
  {
    method: "POST",
    path: "/api/agents/ocr-extract",
    name: "Document Parsing & OCR Pipeline",
    description: "Automated OCR extraction pipeline for raw invoice PDF parsing into line items.",
    status: "IN_PROGRESS",
    tag: "AI Intelligence",
  },
  {
    method: "POST",
    path: "/api/agents/classify-hts",
    name: "Gemini HTS Classifier Engine",
    description: "Deep tariff classification engine using WCO Explanatory Notes & CBP CROSS rulings.",
    status: "IN_PROGRESS",
    tag: "AI Intelligence",
  },
  {
    method: "GET",
    path: "/api/filing/export-7501",
    name: "CBP Form 7501 PDF Generator",
    description: "Generates downloadable official US Customs CBP Form 7501 entry summary PDF packages.",
    status: "IN_PROGRESS",
    tag: "Customs Filing",
  },
];

interface ApiStatusDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ApiStatusDrawer({ isOpen, onClose }: ApiStatusDrawerProps) {
  const [activeTab, setActiveTab] = useState<"READY" | "IN_PROGRESS">("READY");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  if (!isOpen) return null;

  const readyApis = API_ENDPOINTS.filter((e) => e.status === "READY");
  const inProgressApis = API_ENDPOINTS.filter((e) => e.status === "IN_PROGRESS");

  const currentList = activeTab === "READY" ? readyApis : inProgressApis;

  const handleCopy = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-3xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-4 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-[#0071E3] text-white flex items-center justify-center shadow-md shadow-[#0071E3]/20">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[#1D1D1F] tracking-tight">Qubere Enterprise API Matrix</h2>
              <p className="text-xs text-[#86868B]">REST API endpoints status and specifications</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center justify-between bg-[#F5F5F7] p-1.5 rounded-2xl border border-[#E5E5EA] shrink-0 text-xs font-bold">
          <button
            onClick={() => setActiveTab("READY")}
            className={`flex-1 py-2 rounded-xl transition-all flex items-center justify-center space-x-2 ${
              activeTab === "READY"
                ? "bg-white text-[#0071E3] shadow-xs"
                : "text-[#86868B] hover:text-[#1D1D1F]"
            }`}
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Ready to Go ({readyApis.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("IN_PROGRESS")}
            className={`flex-1 py-2 rounded-xl transition-all flex items-center justify-center space-x-2 ${
              activeTab === "IN_PROGRESS"
                ? "bg-white text-purple-600 shadow-xs"
                : "text-[#86868B] hover:text-[#1D1D1F]"
            }`}
          >
            <Clock className="w-4 h-4 text-amber-500" />
            <span>Being Built / Roadmap ({inProgressApis.length})</span>
          </button>
        </div>

        {/* API Endpoint Cards List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {currentList.map((api, idx) => (
            <div
              key={idx}
              className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2 hover:border-[#0071E3] transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 font-mono text-xs">
                  <span
                    className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                      api.method === "GET"
                        ? "bg-emerald-100 text-emerald-800"
                        : api.method === "POST"
                        ? "bg-blue-100 text-[#0071E3]"
                        : "bg-purple-100 text-purple-800"
                    }`}
                  >
                    {api.method}
                  </span>
                  <span className="font-bold text-[#1D1D1F]">{api.path}</span>
                  <button
                    onClick={() => handleCopy(api.path)}
                    className="p-1 text-[#86868B] hover:text-[#0071E3] transition-colors"
                  >
                    {copiedPath === api.path ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-white border border-[#E5E5EA] text-[#86868B]">
                  {api.tag}
                </span>
              </div>

              <p className="text-xs font-bold text-[#1D1D1F]">{api.name}</p>
              <p className="text-xs text-[#86868B] leading-relaxed">{api.description}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-[#E5E5EA] flex items-center justify-between shrink-0 text-xs text-[#86868B]">
          <span className="flex items-center space-x-1.5">
            <Server className="w-3.5 h-3.5 text-[#0071E3]" />
            <span>Base URL: <strong className="text-[#1D1D1F]">https://demo-app.qubere.ai</strong></span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold rounded-xl text-xs transition-all shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
