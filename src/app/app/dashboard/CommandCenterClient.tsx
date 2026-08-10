"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Send,
  ChevronRight,
  Bot,
  TrendingUp,
  Users,
  Plus,
  DollarSign,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  averageOfKnown,
  displayCurrency,
  displayPercent,
  displayText,
  NOT_CALCULATED,
} from "@/lib/honest";

const NOT_CLASSIFIED = "Not classified";

function statusBadgeClass(status: string | null): string {
  switch (status) {
    case "Completed":
    case "Released":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "On Hold":
    case "At Risk":
      return "bg-red-50 text-red-700 border-red-200";
    case "Ready to File":
    case "Submitted":
      return "bg-blue-50 text-blue-700 border-blue-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

function decisionToneClass(status: string): string {
  switch (status) {
    case "Attention":
      return "bg-red-50/60 border-red-100";
    case "Review Required":
      return "bg-amber-50/60 border-amber-100";
    case "Completed":
    case "Approved":
      return "bg-emerald-50/60 border-emerald-100";
    default:
      return "bg-blue-50/60 border-blue-100";
  }
}

export interface DashboardShipment {
  id: string;
  shipmentNumber: string | null;
  referenceNumber: string | null;
  importerName: string | null;
  countryOfExport: string | null;
  primaryHtsCode: string | null;
  totalValue: number | null;
  readinessScore: number | null;
  status: string | null;
  healthStatus: string | null;
  riskScore: number | null;
  clientId: string | null;
  client: { id: string; name: string } | null;
  assignedBrokerId: string | null;
}

export interface DashboardDecision {
  id: string;
  agentName: string;
  status: string;
  confidence: number | null;
  decisionSummary: string;
  shipmentId: string;
  assignedBrokerId: string | null;
}

interface CommandCenterClientProps {
  accountName: string;
  initialShipments: DashboardShipment[];
  initialDecisions: DashboardDecision[];
  teamMembers: Array<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }>;
  clients: Array<{ id: string; name: string }>;
  context: {
    userId: string;
    roleNames: string[];
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
  teamMembers,
  clients,
  context,
}: CommandCenterClientProps) {
  const { t } = useLanguage();

  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

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
  const [selectedClientId, setSelectedClientId] = useState("ALL");

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Filter shipments dynamically based on checked team members and selected client
  const filteredShipments = useMemo(() => {
    return initialShipments.filter((shp) => {
      if (isEnterpriseAdmin) {
        if (selectedUserIds.length > 0) {
          if (!shp.assignedBrokerId || !selectedUserIds.includes(shp.assignedBrokerId)) {
            return false;
          }
        }
      }
      if (selectedClientId !== "ALL") {
        if (selectedClientId === "UNASSIGNED") {
          if (shp.clientId) return false;
        } else if (shp.clientId !== selectedClientId) {
          return false;
        }
      }
      return true;
    });
  }, [initialShipments, selectedUserIds, selectedClientId, isEnterpriseAdmin]);

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

  // null when nothing has been scored yet, so the UI can say "Not calculated"
  // instead of showing a 0% that looks like a real reading.
  const avgReadiness = averageOfKnown(filteredShipments.map((s) => s.readinessScore));

  // Value tied up in shipments that are not ready to file yet. Unscored
  // shipments are excluded rather than assumed at risk.
  const notReadyShipments = filteredShipments.filter(
    (s) => s.readinessScore !== null && s.readinessScore < 85
  );
  const clearedShipments = filteredShipments.filter(
    (s) => s.readinessScore !== null && s.readinessScore >= 85
  );
  const valueAtRisk = notReadyShipments.reduce((sum, s) => sum + (s.totalValue ?? 0), 0);

  const reviewRequiredDecisions = filteredDecisions.filter(
    (d) => d.status === "Review Required" || d.status === "Needs Review"
  ).length;

  const recentDecisions = filteredDecisions.slice(0, 3);

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
          <Link
            href="/app/shipments/new"
            className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{t.dashboard.newShipment}</span>
          </Link>
        </div>
      </div>

      {/* Task Scope & Assignment -- assignee controls for enterprise admins, client scope for everyone */}
      {(isEnterpriseAdmin || clients.length > 0) && (
        <div className="bg-white p-4 rounded-2xl border border-[#E5E5EA] shadow-2xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-2.5">
            <Users className="w-4 h-4 text-[#0071E3]" />
            <span className="text-xs font-bold text-[#1D1D1F] uppercase tracking-wider">
              Task Scope &amp; Assignment
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isEnterpriseAdmin && (
              <>
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
              </>
            )}

            {clients.length > 0 && (
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-[#86868B] font-semibold">Client:</span>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="px-3.5 py-1.5 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] cursor-pointer font-semibold"
          >
            <option value="ALL">All Clients</option>
            <option value="UNASSIGNED">No Client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top KPI Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-7 gap-4">
        {/* 1. Overall Readiness Gauge */}
        <Link
          href="/app/shipments"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-red-400 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2 group-hover:text-[#0071E3]">
            <span className="font-semibold leading-tight">{t.dashboard.kpiAvgReadiness}</span>
            <ShieldCheck className="w-4 h-4 shrink-0 text-[#0071E3] group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
              <svg className="w-14 h-14 transform -rotate-90">
                <circle cx="28" cy="28" r="22" stroke="#E5E5EA" strokeWidth="4" fill="transparent" />
                {avgReadiness !== null && (
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
                )}
              </svg>
              <span className="absolute text-sm font-extrabold text-[#1D1D1F]">
                {avgReadiness === null ? "—" : `${avgReadiness}%`}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold leading-tight text-[#1D1D1F] group-hover:text-[#0071E3] transition-colors">
                {avgReadiness === null
                  ? NOT_CALCULATED
                  : avgReadiness >= 90
                  ? "Ready to file"
                  : "Verification in progress"}
              </p>
              <p className="text-[10px] leading-tight text-[#86868B] mt-0.5">
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
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2 group-hover:text-blue-600">
            <span className="font-semibold leading-tight">{t.dashboard.kpiTotal}</span>
            <FileText className="w-4 h-4 shrink-0 text-blue-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">{inProgressCount}</p>
          <div className="min-h-8 w-full mt-2 py-1 bg-gradient-to-r from-blue-50 to-blue-100/50 rounded-lg border border-blue-100 flex items-center justify-between gap-1 px-2 text-[11px] text-blue-600 font-semibold group-hover:bg-blue-600 group-hover:text-white transition-all">
            <span className="truncate">Active Agent Pipelines</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>

        {/* 3. Ready to File */}
        <Link
          href="/app/filing"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2 group-hover:text-emerald-600">
            <span className="font-semibold leading-tight">{t.dashboard.kpiReady}</span>
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-emerald-600">{readyToFileCount}</p>
          <div className="min-h-8 w-full mt-2 py-1 bg-emerald-50 rounded-lg border border-emerald-100 flex items-center justify-between gap-1 px-2 text-[11px] text-emerald-700 font-semibold group-hover:bg-emerald-600 group-hover:text-white transition-all">
            <span className="truncate">Verified for ACE</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>

        {/* 4. Requires Attention */}
        <Link
          href="/app/decisions?status=Needs+Review"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-amber-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2 group-hover:text-amber-600">
            <span className="font-semibold leading-tight">{t.dashboard.kpiAttention}</span>
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-amber-600">{onHoldCount}</p>
          <div className="min-h-8 w-full mt-2 py-1 bg-amber-50 rounded-lg border border-amber-100 flex items-center justify-between gap-1 px-2 text-[11px] text-amber-700 font-semibold group-hover:bg-amber-500 group-hover:text-white transition-all">
            <span className="truncate">{reviewRequiredDecisions} Broker Reviews</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>

        {/* 5. Submitted to ACE */}
        <Link
          href="/app/filing"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2 group-hover:text-indigo-600">
            <span className="font-semibold leading-tight">{t.dashboard.kpiSubmitted}</span>
            <Send className="w-4 h-4 shrink-0 text-indigo-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">{submittedCount}</p>
          <div className="min-h-8 w-full mt-2 py-1 bg-indigo-50 rounded-lg border border-indigo-100 flex items-center justify-between gap-1 px-2 text-[11px] text-indigo-700 font-semibold group-hover:bg-indigo-600 group-hover:text-white transition-all">
            <span className="truncate">1C Released</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>

        {/* 6. Completed Filings */}
        <Link
          href="/app/filing"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2 group-hover:text-emerald-600">
            <span className="font-semibold leading-tight">Completed Filings</span>
            <TrendingUp className="w-4 h-4 shrink-0 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">{completedCount}</p>
          <div className="min-h-8 w-full mt-2 py-1 bg-slate-50 rounded-lg border border-[#E5E5EA] flex items-center justify-between gap-1 px-2 text-[11px] text-[#86868B] font-semibold group-hover:bg-slate-800 group-hover:text-white transition-all">
            <span className="truncate">100% Audit Settled</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>

        {/* 7. Value at Risk */}
        <Link
          href="/app/shipments"
          className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs hover:border-red-400 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2 group-hover:text-red-600">
            <span className="font-semibold leading-tight">Value at Risk</span>
            <DollarSign className="w-4 h-4 shrink-0 text-red-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">
            {notReadyShipments.length === 0 && clearedShipments.length === 0
              ? NOT_CALCULATED
              : displayCurrency(valueAtRisk)}
          </p>
          <div className="flex items-center justify-between mt-2 gap-2">
            <span className="text-[10px] text-[#86868B]">
              {notReadyShipments.length} not ready to file
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
              {clearedShipments.length} cleared
            </span>
          </div>
        </Link>
      </div>

      {/* Main Content Layout Grid: Recent Shipments & Agent Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recent Shipments Table (2 Cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-6 rounded-3xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <div className="flex items-center justify-between gap-3 border-b border-[#E5E5EA] pb-4">
              <div className="min-w-0">
                <h3 className="text-base font-extrabold text-[#1D1D1F] tracking-tight">
                  {t.dashboard.recentFilings}
                </h3>
                <p className="text-xs text-[#86868B]">{t.dashboard.activeShipments}</p>
              </div>

              <Link
                href="/app/shipments"
                className="text-xs text-[#0071E3] font-semibold hover:underline flex items-center gap-1 cursor-pointer shrink-0"
              >
                <span>{t.dashboard.viewAll}</span>
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              </Link>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#1D1D1F]">
                <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4 whitespace-nowrap">{t.dashboard.colShipment}</th>
                    <th className="py-3 px-4 whitespace-nowrap">{t.dashboard.colImporter}</th>
                    <th className="py-3 px-4 whitespace-nowrap">{t.dashboard.colHts}</th>
                    <th className="py-3 px-4 whitespace-nowrap">{t.dashboard.colValue}</th>
                    <th className="py-3 px-4 whitespace-nowrap">{t.dashboard.colReadiness}</th>
                    <th className="py-3 px-4 whitespace-nowrap">{t.dashboard.colStatus}</th>
                    <th className="py-3 px-4 whitespace-nowrap">Client</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {filteredShipments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[#86868B]">
                        No active tasks found in this scope.
                      </td>
                    </tr>
                  ) : (
                    filteredShipments.slice(0, 6).map((shp) => (
                      <tr key={shp.id} className="hover:bg-[#F5F5F7]/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#0071E3]">
                          <Link href={`/app/shipments/${shp.id}`} className="hover:underline">
                            {shp.referenceNumber || shp.shipmentNumber || shp.id.slice(0, 10)}
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-[#86868B]">
                          {displayText(shp.importerName)}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-[#1D1D1F]">
                          {displayText(shp.primaryHtsCode, NOT_CLASSIFIED)}
                        </td>
                        <td className="py-3 px-4 font-semibold">
                          {displayCurrency(shp.totalValue)}
                        </td>
                        <td className="py-3 px-4 font-bold text-[#1D1D1F]">
                          {displayPercent(shp.readinessScore)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${statusBadgeClass(
                              shp.status
                            )}`}
                          >
                            {displayText(shp.status, "Unknown")}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {shp.client ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#0071E3]/10 text-[#0071E3]">
                              {shp.client.name}
                            </span>
                          ) : (
                            <span className="text-[11px] text-[#86868B]">—</span>
                          )}
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
            <div className="flex items-center justify-between gap-3 border-b border-[#E5E5EA] pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="w-5 h-5 shrink-0 text-[#0071E3]" />
                <h3 className="text-sm font-extrabold text-[#1D1D1F] truncate">
                  {t.dashboard.agentInsights}
                </h3>
              </div>
              <Link
                href="/agents"
                className="text-[11px] text-[#0071E3] font-semibold hover:underline cursor-pointer shrink-0 text-right"
              >
                {t.dashboard.allAgentsButton}
              </Link>
            </div>

            <div className="space-y-3 text-xs">
              {recentDecisions.length === 0 ? (
                <p className="text-[#86868B] text-sm p-3">
                  No agent decisions recorded yet. Insights appear here once an agent runs on a shipment.
                </p>
              ) : (
                recentDecisions.map((decision) => (
                  <div key={decision.id} className={`p-3 rounded-2xl border space-y-1 ${decisionToneClass(decision.status)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-[#1D1D1F]">{decision.agentName}</p>
                      <span className="text-sm text-[#86868B] shrink-0">
                        {displayPercent(decision.confidence, "Confidence not reported")}
                      </span>
                    </div>
                    <p className="text-[#86868B] text-sm">{decision.decisionSummary}</p>
                    <Link
                      href={`/app/shipments/${decision.shipmentId}`}
                      className="text-sm text-[#0071E3] font-semibold hover:underline inline-block"
                    >
                      View shipment
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
