import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import {
  Package,
  FileText,
  AlertTriangle,
  Clock,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Search,
  Sparkles,
  ArrowUpRight,
  ChevronRight,
  ShieldCheck,
  Building2,
  Send,
  Info,
} from "lucide-react";

export default async function CommandCenterPage() {
  const context = await getAccountContext();
  if (!context) return null;

  const shipments = await db.shipment.findMany({
    where: { accountId: context.accountId, deletedAt: null },
    include: { agentDecisions: true, customsFilings: true },
    orderBy: { createdAt: "desc" },
  });

  const regUpdates = await db.regulatoryUpdate.findMany({
    take: 3,
    orderBy: { effectiveDate: "desc" },
  });

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">Command Center</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Live Operations
            </span>
          </div>
          <p className="text-xs text-[#86868B] mt-1">
            Real-time visibility and control across all customs filing operations for{" "}
            <strong className="text-[#1D1D1F]">{context.accountName}</strong>
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search shipments, agents, documents... (⌘K)"
              className="pl-9 pr-4 py-2 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] w-72 focus:outline-hidden focus:border-[#0071E3]"
            />
          </div>

          <Link
            href="/app/shipments/new"
            className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1.5"
          >
            <span>+ Add Shipment</span>
          </Link>
        </div>
      </div>

      {/* Top 6 KPI Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {/* 1. Overall Readiness Gauge */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>Overall Readiness</span>
            <ShieldCheck className="w-4 h-4 text-[#0071E3]" />
          </div>
          <div className="flex items-center space-x-3">
            <div className="relative w-14 h-14 flex items-center justify-center">
              <svg className="w-14 h-14 transform -rotate-90">
                <circle cx="28" cy="28" r="22" stroke="#E5E5EA" strokeWidth="4" fill="transparent" />
                <circle
                  cx="28"
                  cy="28"
                  r="22"
                  stroke="#0071E3"
                  strokeWidth="4"
                  strokeDasharray={138}
                  strokeDashoffset={138 - (138 * 87) / 100}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <span className="absolute text-sm font-extrabold text-[#1D1D1F]">87%</span>
            </div>
            <div>
              <p className="text-xs font-bold text-[#1D1D1F]">Not ready to file</p>
              <p className="text-[10px] text-[#86868B]">28 shipments</p>
              <p className="text-[10px] text-amber-600 font-semibold mt-0.5">2 blocking • 3 warnings</p>
            </div>
          </div>
        </div>

        {/* 2. Shipments in Progress */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>Shipments in Progress</span>
            <FileText className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">64</p>
          <div className="h-8 w-full mt-2 bg-gradient-to-r from-blue-50 to-blue-100/50 rounded-lg border border-blue-100 flex items-center justify-center text-[10px] text-blue-600 font-semibold">
            <span>📈 +12% active volume</span>
          </div>
        </div>

        {/* 3. Ready to File */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>Ready to File</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline space-x-2">
            <p className="text-2xl font-extrabold text-[#1D1D1F]">23</p>
            <span className="text-xs font-bold text-emerald-600 flex items-center">↑ 8%</span>
          </div>
          <p className="text-[10px] text-[#86868B] mt-2">vs yesterday</p>
        </div>

        {/* 4. At Risk Shipments */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>At Risk Shipments</span>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <div className="flex items-baseline space-x-2">
            <p className="text-2xl font-extrabold text-red-600">7</p>
            <span className="text-xs font-bold text-red-600 flex items-center">↑ 75%</span>
          </div>
          <p className="text-[10px] text-[#86868B] mt-2">vs yesterday</p>
        </div>

        {/* 5. Avg. Cycle Time */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>Avg. Cycle Time</span>
            <Clock className="w-4 h-4 text-purple-500" />
          </div>
          <div className="flex items-baseline space-x-2">
            <p className="text-2xl font-extrabold text-[#1D1D1F]">18.6 <span className="text-xs font-normal">hrs</span></p>
            <span className="text-xs font-bold text-emerald-600 flex items-center">↓ 5%</span>
          </div>
          <p className="text-[10px] text-[#86868B] mt-2">vs yesterday</p>
        </div>

        {/* 6. Straight Through Rate */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>Straight Through Rate</span>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline space-x-2">
            <p className="text-2xl font-extrabold text-[#1D1D1F]">72%</p>
            <span className="text-xs font-bold text-emerald-600 flex items-center">↑ 6%</span>
          </div>
          <p className="text-[10px] text-[#86868B] mt-2">vs last 7 days</p>
        </div>
      </div>

      {/* AI Agent Orchestration Pipeline Stepper (Steps 1–10) */}
      <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#0071E3]" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">AI Agent Orchestration</h2>
          </div>
          <Link href="/app/ai-agents" className="text-xs text-[#0071E3] font-semibold hover:underline flex items-center space-x-1">
            <span>View All Agents</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* 10-Step Pipeline Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-3">
          {[
            { step: 1, name: "Document Intake Agent", status: "Completed", time: "10:18 AM", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 2, name: "Document Intelligence Agent", status: "Completed", time: "10:19 AM", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 3, name: "Product Intelligence Agent", status: "Completed", time: "10:20 AM", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 4, name: "Classification Agent", status: "Review Required", note: "2 items", time: "10:21 AM", badgeBg: "bg-amber-50 text-amber-700 border-amber-200" },
            { step: 5, name: "Origin Agent", status: "Completed", time: "10:21 AM", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 6, name: "Valuation Agent", status: "Completed", time: "10:21 AM", badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { step: 7, name: "Compliance Agent", status: "Attention", note: "1 issue", time: "10:21 AM", badgeBg: "bg-amber-50 text-amber-700 border-amber-200" },
            { step: 8, name: "Filing Readiness Agent", status: "In Progress", note: "87%", time: "Active", badgeBg: "bg-blue-50 text-blue-700 border-blue-200" },
            { step: 9, name: "Customs Filing Agent", status: "Pending", time: "Waiting", badgeBg: "bg-slate-50 text-slate-600 border-slate-200" },
            { step: 10, name: "Response Management Agent", status: "Waiting", time: "Waiting", badgeBg: "bg-slate-50 text-slate-600 border-slate-200" },
          ].map((agent) => (
            <div key={agent.step} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-center space-y-1.5 hover:border-[#0071E3] transition-colors">
              <div className="flex items-center justify-center space-x-1">
                <span className="w-5 h-5 rounded-full bg-white border border-[#E5E5EA] text-[10px] font-bold text-[#1D1D1F] flex items-center justify-center">
                  {agent.step}
                </span>
              </div>
              <p className="text-[11px] font-bold text-[#1D1D1F] line-clamp-1">{agent.name}</p>
              <span className={`inline-block text-[9px] font-semibold px-2 py-0.5 rounded-full border ${agent.badgeBg}`}>
                {agent.status}
              </span>
              {agent.note && <p className="text-[9px] font-semibold text-amber-600">{agent.note}</p>}
              <p className="text-[9px] text-[#86868B]">{agent.time}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Middle Grid Section: 4 Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Panel 1: Exceptions Requiring Attention */}
        <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Exceptions Requiring Attention</h3>
            <Link href="/app/exceptions" className="text-xs text-[#0071E3] font-semibold hover:underline">View All</Link>
          </div>

          <div className="space-y-3">
            {[
              { type: "Classification Review", desc: "HTS classification confidence below threshold", count: 2, icon: AlertCircle, color: "text-red-500" },
              { type: "Missing Documents", desc: "Required documents not received", count: 1, icon: AlertCircle, color: "text-red-500" },
              { type: "Compliance Alerts", desc: "Compliance or regulatory requirements", count: 2, icon: AlertTriangle, color: "text-amber-500" },
              { type: "Data Conflicts", desc: "Mismatched data across documents", count: 3, icon: Info, color: "text-blue-500" },
              { type: "Warnings", desc: "Non-blocking warnings", count: 3, icon: AlertTriangle, color: "text-amber-500" },
            ].map((exc, idx) => (
              <div key={idx} className="flex items-start justify-between p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA]">
                <div className="flex items-start space-x-2.5">
                  <exc.icon className={`w-4 h-4 ${exc.color} mt-0.5 shrink-0`} />
                  <div>
                    <p className="text-xs font-bold text-[#1D1D1F]">{exc.type}</p>
                    <p className="text-[10px] text-[#86868B]">{exc.desc}</p>
                  </div>
                </div>
                <span className="w-5 h-5 rounded-full bg-white border border-[#E5E5EA] text-[10px] font-bold text-[#1D1D1F] flex items-center justify-center">
                  {exc.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 2: Shipments by Status Donut */}
        <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Shipments by Status</h3>
            <Link href="/app/shipments" className="text-xs text-[#0071E3] font-semibold hover:underline">View Console</Link>
          </div>

          <div className="flex flex-col items-center justify-center my-2">
            <div className="relative w-32 h-32 flex items-center justify-center">
              <svg className="w-32 h-32 transform -rotate-90">
                <circle cx="64" cy="64" r="48" stroke="#E5E5EA" strokeWidth="12" fill="transparent" />
                <circle cx="64" cy="64" r="48" stroke="#0071E3" strokeWidth="12" strokeDasharray={301} strokeDashoffset={120} fill="transparent" />
                <circle cx="64" cy="64" r="48" stroke="#10B981" strokeWidth="12" strokeDasharray={301} strokeDashoffset={240} fill="transparent" />
              </svg>
              <div className="absolute text-center">
                <p className="text-2xl font-extrabold text-[#1D1D1F]">64</p>
                <p className="text-[10px] text-[#86868B]">Total</p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#0071E3]" /><span>In Progress</span></span><span className="font-semibold text-[#1D1D1F]">64 (40%)</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span>Ready to File</span></span><span className="font-semibold text-[#1D1D1F]">23 (14%)</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span>On Hold</span></span><span className="font-semibold text-[#1D1D1F]">11 (7%)</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-purple-500" /><span>Submitted</span></span><span className="font-semibold text-[#1D1D1F]">19 (12%)</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" /><span>Completed</span></span><span className="font-semibold text-[#1D1D1F]">43 (27%)</span></div>
          </div>
        </div>

        {/* Panel 3: Top at Risk Shipments */}
        <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Top at Risk Shipments</h3>
            <Link href="/app/shipments" className="text-xs text-[#0071E3] font-semibold hover:underline">View All</Link>
          </div>

          <div className="space-y-2">
            {[
              { id: "SHP-2026-004872", score: 92, issues: 3, owner: "Stephen" },
              { id: "SHP-2026-004871", score: 85, issues: 2, owner: "Priya Nair" },
              { id: "SHP-2026-004869", score: 72, issues: 2, owner: "Rohan Mehta" },
              { id: "SHP-2026-004866", score: 68, issues: 1, owner: "Sneha Iyer" },
              { id: "SHP-2026-004863", score: 65, issues: 1, owner: "Vikram Patel" },
            ].map((shp) => (
              <Link
                key={shp.id}
                href={`/app/shipments/${shp.id}`}
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[#F5F5F7] border border-transparent hover:border-[#E5E5EA] transition-all"
              >
                <div>
                  <p className="text-xs font-bold text-[#0071E3]">{shp.id}</p>
                  <p className="text-[10px] text-[#86868B]">Owner: {shp.owner}</p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-50 text-red-600 border border-red-200">
                    {shp.score}
                  </span>
                  <span className="text-[10px] font-semibold text-[#86868B]">{shp.issues} issues</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Panel 4: Qubere AI Copilot */}
        <div className="bg-gradient-to-br from-[#0071E3]/5 to-purple-50 p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-3">
              <Sparkles className="w-4 h-4 text-[#0071E3]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">AI Copilot</h3>
            </div>

            <div className="space-y-2">
              {[
                "Why is HTS review required?",
                "Explain valuation calculation",
                "What are the compliance risks?",
                "Summarize this shipment",
                "Any regulatory changes?",
              ].map((q, idx) => (
                <button
                  key={idx}
                  className="w-full text-left text-xs p-2 rounded-xl bg-white border border-[#E5E5EA] hover:border-[#0071E3] hover:text-[#0071E3] text-[#1D1D1F] transition-all line-clamp-1"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="relative mt-3">
            <input
              type="text"
              placeholder="Ask your question..."
              className="w-full pl-3 pr-8 py-2 bg-white border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
            />
            <button className="absolute right-2 top-2 text-[#0071E3] hover:text-[#0077ED]">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section: Regulatory Intelligence Alerts & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Regulatory Intelligence Alerts */}
        <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Regulatory Intelligence Alerts</h3>
            <Link href="/app/regulatory" className="text-xs text-[#0071E3] font-semibold hover:underline">View All</Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {regUpdates.map((reg) => (
              <div key={reg.id} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[#1D1D1F]">{reg.jurisdiction}</span>
                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                    {reg.impactLevel} Impact
                  </span>
                </div>
                <p className="text-xs font-bold text-[#1D1D1F] line-clamp-1">{reg.title}</p>
                <p className="text-[10px] text-[#86868B] line-clamp-2">{reg.description}</p>
                <p className="text-[9px] text-[#86868B]">{reg.publishedText}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity Log */}
        <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Recent Activity</h3>
            <Link href="/app/admin/settings" className="text-xs text-[#0071E3] font-semibold hover:underline">View Audit Log</Link>
          </div>

          <div className="space-y-3 text-xs">
            {[
              { type: "check", text: "Document Intelligence Agent completed for SHP-2026-004872", time: "10:20 AM" },
              { type: "warn", text: "Classification Agent requires review for SHP-2026-004872", time: "10:19 AM" },
              { type: "warn", text: "Compliance alert raised for SHP-2026-004871", time: "10:15 AM" },
              { type: "check", text: "Shipment SHP-2026-004868 marked as Ready to File", time: "10:10 AM" },
              { type: "info", text: "Document Sourcing completed for SHP-2026-004873", time: "10:05 AM" },
            ].map((act, idx) => (
              <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA]">
                <div className="flex items-center space-x-2.5">
                  {act.type === "check" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : act.type === "warn" ? (
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  ) : (
                    <Info className="w-4 h-4 text-blue-500 shrink-0" />
                  )}
                  <span className="text-[#1D1D1F] font-medium">{act.text}</span>
                </div>
                <span className="text-[10px] text-[#86868B] shrink-0">{act.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
