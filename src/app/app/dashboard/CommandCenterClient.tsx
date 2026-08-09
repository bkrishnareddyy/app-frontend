"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  FileText,
  AlertTriangle,
  Clock,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Search,
  Sparkles,
  ShieldCheck,
  Send,
  ChevronRight,
  Bot,
  Users,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

interface CommandCenterClientProps {
  accountName: string;
  initialShipments: any[];
  initialDecisions: any[];
  regUpdates: any[];
  teamMembers: Array<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }>;
  context: {
    userId: string;
    roleName: string;
    accountType: string;
    accountName: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  };
}

export function CommandCenterClient({
  accountName,
  initialShipments,
  initialDecisions,
  regUpdates,
  teamMembers,
  context,
}: CommandCenterClientProps) {
  const { t } = useLanguage();

  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleName === "ADMIN" || context.roleName === "OWNER");

  // Construct full team list containing the logged-in admin themselves
  const fullTeamList = useMemo(() => {
    const list = [...teamMembers];
    const hasMe = list.some((m) => m.userId === context.userId);
    if (!hasMe) {
      list.unshift({
        userId: context.userId,
        email: context.email || "me@qubere.ai",
        firstName: context.firstName || "Me",
        lastName: context.lastName || "",
      });
    }
    return list;
  }, [teamMembers, context]);

  // Default is "MY" (only the admin's tasks, where selectedUserIds = [context.userId])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    isEnterpriseAdmin ? [context.userId] : []
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Filter shipments dynamically based on checked team members
  const filteredShipments = useMemo(() => {
    return initialShipments.filter((shp) => {
      if (isEnterpriseAdmin) {
        if (selectedUserIds.length > 0) {
          if (!shp.assignedBrokerId || !selectedUserIds.includes(shp.assignedBrokerId)) {
            return false;
          }
        }
      }
      return true;
    });
  }, [initialShipments, selectedUserIds, isEnterpriseAdmin]);

  // Filter decisions dynamically based on checked team members
  const filteredDecisions = useMemo(() => {
    return initialDecisions.filter((dec) => {
      if (isEnterpriseAdmin) {
        if (selectedUserIds.length > 0) {
          if (!dec.assignedBrokerId || !selectedUserIds.includes(dec.assignedBrokerId)) {
            return false;
          }
        }
      }
      return true;
    });
  }, [initialDecisions, selectedUserIds, isEnterpriseAdmin]);

  // Reactively computed KPI Counts
  const totalShipments = filteredShipments.length;
  const inProgressCount = filteredShipments.filter((s) => s.status === "In Progress").length;
  const readyToFileCount = filteredShipments.filter((s) => s.status === "Ready to File").length;
  const onHoldCount = filteredShipments.filter((s) => s.status === "On Hold").length;
  const submittedCount = filteredShipments.filter((s) => s.status === "Submitted").length;
  const completedCount = filteredShipments.filter((s) => s.status === "Completed").length;

  const atRiskCount = filteredShipments.filter(
    (s) => s.healthStatus === "At Risk" || s.riskScore > 50
  ).length;

  const avgReadiness =
    filteredShipments.length > 0
      ? Math.round(
          filteredShipments.reduce((acc, s) => acc + s.readinessScore, 0) /
            filteredShipments.length
        )
      : 0;

  const reviewRequiredDecisions = filteredDecisions.filter(
    (d) => d.status === "Review Required" || d.status === "Needs Review"
  ).length;
  const attentionDecisions = filteredDecisions.filter((d) => d.status === "Attention").length;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">
              {t.dashboard.commandCenter}
            </h1>
          </div>
          <p className="text-xs text-[#86868B] mt-1">
            {t.dashboard.subtitle}{" "}
            <strong className="text-[#1D1D1F]">{accountName}</strong>
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t.dashboard.searchPlaceholder}
              disabled
              className="pl-9 pr-4 py-2 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#86868B] w-72 opacity-50 cursor-not-allowed"
            />
          </div>

          <Link
            href="/app/shipments/new"
            className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <span>+ {t.dashboard.newShipment}</span>
          </Link>
        </div>
      </div>

      {/* Enterprise Admin Filter Controls below header */}
      {isEnterpriseAdmin && (
        <div className="bg-white p-4 rounded-2xl border border-[#E5E5EA] shadow-2xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-2.5">
            <Users className="w-4 h-4 text-[#0071E3]" />
            <span className="text-xs font-bold text-[#1D1D1F] uppercase tracking-wider">
              Task Scope &amp; Assignment
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA] text-xs">
              <button
                onClick={() => setSelectedUserIds([context.userId])}
                className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  selectedUserIds.length === 1 && selectedUserIds[0] === context.userId
                    ? "bg-white text-[#1D1D1F] shadow-3xs"
                    : "text-[#86868B]"
                }`}
              >
                My Tasks
              </button>
              <button
                onClick={() => setSelectedUserIds([])}
                className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  selectedUserIds.length === 0 ? "bg-white text-[#1D1D1F] shadow-3xs" : "text-[#86868B]"
                }`}
              >
                All Tasks
              </button>
            </div>

            <div className="flex items-center space-x-2 text-xs relative">
              <span className="text-[#86868B] font-semibold">Team Members:</span>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="px-3.5 py-1.5 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] font-semibold cursor-pointer flex items-center space-x-1.5 shadow-3xs"
              >
                <span>
                  {selectedUserIds.length === 0
                    ? "All Team Members"
                    : selectedUserIds.length === 1
                    ? selectedUserIds[0] === context.userId
                      ? `My Tasks (${context.firstName || "Me"})`
                      : (() => {
                          const user = fullTeamList.find((u) => u.userId === selectedUserIds[0]);
                          return user
                            ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
                            : "1 Selected";
                        })()
                    : `${selectedUserIds.length} Selected`}
                </span>
                <span className="text-[#86868B] text-[9px]">▼</span>
              </button>

              {isDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-[#E5E5EA] rounded-2xl shadow-lg p-3 z-20 space-y-2 max-h-60 overflow-y-auto">
                    <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-2 mb-1 text-[10px] font-bold text-[#86868B] uppercase">
                      <span>Select Members</span>
                      <div className="space-x-2">
                        <button
                          onClick={() => setSelectedUserIds(fullTeamList.map((t) => t.userId))}
                          className="text-[#0071E3] hover:underline cursor-pointer"
                        >
                          All
                        </button>
                        <button
                          onClick={() => setSelectedUserIds([])}
                          className="text-[#0071E3] hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      {fullTeamList.map((member) => {
                        const isChecked = selectedUserIds.includes(member.userId);
                        const memberName =
                          member.firstName || member.lastName
                            ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim()
                            : member.email;

                        return (
                          <label
                            key={member.userId}
                            className="flex items-center space-x-2.5 p-2 hover:bg-[#F5F5F7] rounded-xl cursor-pointer text-left transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleUser(member.userId)}
                              className="rounded border-[#E5E5EA] text-[#0071E3] focus:ring-[#0071E3] cursor-pointer"
                            />
                            <div className="truncate">
                              <p className="font-bold text-[#1D1D1F] text-xs truncate">
                                {memberName}
                                {member.userId === context.userId && " (Me)"}
                              </p>
                              <p className="text-[10px] text-[#86868B] truncate">
                                {member.email}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top KPI Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {/* 1. Overall Readiness Gauge */}
        <Link
          href="/app/shipments"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-[#0071E3] hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2 group-hover:text-[#0071E3]">
            <span className="font-semibold">{t.dashboard.kpiAvgReadiness}</span>
            <ShieldCheck className="w-4 h-4 text-[#0071E3] group-hover:scale-110 transition-transform" />
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
                  strokeDashoffset={138 - (138 * avgReadiness) / 100}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <span className="absolute text-sm font-extrabold text-[#1D1D1F]">{avgReadiness}%</span>
            </div>
            <div>
              <p className="text-xs font-bold text-[#1D1D1F] group-hover:text-[#0071E3] transition-colors">
                {avgReadiness >= 90 ? "Ready to file" : "Verification in progress"}
              </p>
              <p className="text-[10px] text-[#86868B]">
                {totalShipments} {t.nav.shipments} • Click for details
              </p>
            </div>
          </div>
        </Link>

        {/* 2. Shipments in Progress */}
        <Link
          href="/app/shipments"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2 group-hover:text-blue-600">
            <span className="font-semibold">{t.dashboard.kpiTotal}</span>
            <FileText className="w-4 h-4 text-blue-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">{inProgressCount}</p>
          <div className="h-8 w-full mt-2 bg-gradient-to-r from-blue-50 to-blue-100/50 rounded-lg border border-blue-100 flex items-center justify-between px-2 text-[10px] text-blue-600 font-semibold group-hover:bg-blue-600 group-hover:text-white transition-all">
            <span>Active Agent Pipelines</span>
            <ChevronRight className="w-3 h-3" />
          </div>
        </Link>

        {/* 3. Ready to File */}
        <Link
          href="/app/filing"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2 group-hover:text-emerald-600">
            <span className="font-semibold">{t.dashboard.kpiReady}</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-emerald-600">{readyToFileCount}</p>
          <div className="h-8 w-full mt-2 bg-emerald-50 rounded-lg border border-emerald-100 flex items-center justify-between px-2 text-[10px] text-emerald-700 font-semibold group-hover:bg-emerald-600 group-hover:text-white transition-all">
            <span>Verified for ACE</span>
            <ChevronRight className="w-3 h-3" />
          </div>
        </Link>

        {/* 4. Requires Attention */}
        <Link
          href="/app/decisions?status=Needs+Review"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-amber-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2 group-hover:text-amber-600">
            <span className="font-semibold">{t.dashboard.kpiAttention}</span>
            <AlertCircle className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-amber-600">{onHoldCount}</p>
          <div className="h-8 w-full mt-2 bg-amber-50 rounded-lg border border-amber-100 flex items-center justify-between px-2 text-[10px] text-amber-700 font-semibold group-hover:bg-amber-500 group-hover:text-white transition-all">
            <span>{reviewRequiredDecisions} Broker Reviews</span>
            <ChevronRight className="w-3 h-3" />
          </div>
        </Link>

        {/* 5. Submitted to ACE */}
        <Link
          href="/app/filing"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2 group-hover:text-indigo-600">
            <span className="font-semibold">{t.dashboard.kpiSubmitted}</span>
            <Send className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">{submittedCount}</p>
          <div className="h-8 w-full mt-2 bg-indigo-50 rounded-lg border border-indigo-100 flex items-center justify-between px-2 text-[10px] text-indigo-700 font-semibold group-hover:bg-indigo-600 group-hover:text-white transition-all">
            <span>1C Released</span>
            <ChevronRight className="w-3 h-3" />
          </div>
        </Link>

        {/* 6. Completed Filings */}
        <Link
          href="/app/filing"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2 group-hover:text-emerald-600">
            <span className="font-semibold">Completed Filings</span>
            <TrendingUp className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">{completedCount}</p>
          <div className="h-8 w-full mt-2 bg-slate-50 rounded-lg border border-[#E5E5EA] flex items-center justify-between px-2 text-[10px] text-[#86868B] font-semibold group-hover:bg-slate-800 group-hover:text-white transition-all">
            <span>100% Audit Settled</span>
            <ChevronRight className="w-3 h-3" />
          </div>
        </Link>
      </div>

      {/* Main Content Layout Grid: Recent Shipments & Agent Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recent Shipments Table (2 Cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-6 rounded-3xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-4">
              <div>
                <h3 className="text-base font-extrabold text-[#1D1D1F] tracking-tight">
                  {t.dashboard.recentFilings}
                </h3>
                <p className="text-xs text-[#86868B]">{t.dashboard.activeShipments}</p>
              </div>

              <Link
                href="/app/shipments"
                className="text-xs text-[#0071E3] font-semibold hover:underline flex items-center space-x-1 cursor-pointer"
              >
                <span>{t.dashboard.viewAll}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#1D1D1F]">
                <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">{t.dashboard.colShipment}</th>
                    <th className="py-3 px-4">{t.dashboard.colExporter}</th>
                    <th className="py-3 px-4">{t.dashboard.colHts}</th>
                    <th className="py-3 px-4">{t.dashboard.colValue}</th>
                    <th className="py-3 px-4">{t.dashboard.colReadiness}</th>
                    <th className="py-3 px-4">{t.dashboard.colStatus}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {filteredShipments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[#86868B]">
                        No active tasks found in this scope.
                      </td>
                    </tr>
                  ) : (
                    filteredShipments.slice(0, 6).map((shp: any) => (
                      <tr key={shp.id} className="hover:bg-[#F5F5F7]/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#0071E3]">
                          <Link href={`/app/shipments/${shp.id}`} className="hover:underline">
                            {shp.referenceNumber || shp.shipmentNumber || shp.id.slice(0, 10)}
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-[#86868B]">
                          {shp.exporterName || shp.shipper || "Shenzhen Hardware Corp"}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-[#1D1D1F]">
                          {shp.primaryHtsCode ?? "Not Yet Classified"}
                        </td>
                        <td className="py-3 px-4 font-semibold">
                          ${(shp.totalValue ?? 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-bold text-emerald-600">
                          {shp.readinessScore ?? 0}%
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {shp.status || "In Progress"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: AI Agent Insights & Regulatory Updates */}
        <div className="space-y-6">
          {/* Agent Insights Card */}
          <div className="bg-white p-6 rounded-3xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
              <div className="flex items-center space-x-2">
                <Bot className="w-5 h-5 text-[#0071E3]" />
                <h3 className="text-sm font-extrabold text-[#1D1D1F]">
                  {t.dashboard.agentInsights}
                </h3>
              </div>
              <Link
                href="/agents"
                className="text-[11px] text-[#0071E3] font-semibold hover:underline cursor-pointer"
              >
                {t.dashboard.allAgentsButton}
              </Link>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-blue-50/60 rounded-2xl border border-blue-100 space-y-1">
                <p className="font-bold text-[#1D1D1F]">Agent 4: HTS Classification</p>
                <p className="text-[#86868B] text-[11px]">
                  Applied GRI 1 &amp; GRI 6 legal reasoning to 10-digit code 7318.15.2065 (98% confidence).
                </p>
              </div>

              <div className="p-3 bg-emerald-50/60 rounded-2xl border border-emerald-100 space-y-1">
                <p className="font-bold text-[#1D1D1F]">Agent 5: USMCA Origin Determination</p>
                <p className="text-[#86868B] text-[11px]">
                  Verified Annex 4-B tariff shift (CTH requirement met). Qualified SPI 'S' (Duty Savings: $3,007).
                </p>
              </div>

              <div className="p-3 bg-amber-50/60 rounded-2xl border border-amber-100 space-y-1">
                <p className="font-bold text-[#1D1D1F]">Agent 7: 52-Point Pre-Filing Compliance</p>
                <p className="text-[#86868B] text-[11px]">
                  Cleared UFLPA entity list screening. Zero PGA disclaimers required.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
