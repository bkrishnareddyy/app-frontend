"use client";

import { Fragment, useState, useMemo } from "react";
import Link from "next/link";
import {
  FileText,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Search,
  Send,
  ChevronRight,
  ChevronDown,
  Inbox,
  DollarSign,
  Plus,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { displayCurrency, displayDate } from "@/lib/honest";
import { commonExtractedCurrency } from "@/modules/documents/extractedCurrency";
import type { MultiDimensionalMetrics } from "@/modules/shipment/canonicalShipmentService";

type Urgency = "Critical" | "At Risk" | "Healthy";

const URGENCY_RANK: Record<Urgency, number> = { Critical: 0, "At Risk": 1, Healthy: 2 };

function urgencyOf(s: CommandCenterShipment): Urgency {
  if (s.healthStatus === "Critical") return "Critical";
  if (s.healthStatus === "At Risk") return "At Risk";
  if (s.healthStatus === "Healthy") return "Healthy";
  if (typeof s.riskScore === "number") {
    if (s.riskScore >= 75) return "Critical";
    if (s.riskScore >= 50) return "At Risk";
  }
  return "Healthy";
}

/**
 * A shipment's entered value, in the currency its documents actually declared.
 *
 * The figure itself is the sum of the shipment's persisted line-item totals; only
 * the symbol was wrong. Falls back to a bare number when no currency is known,
 * because a shipment whose documents never stated one is not thereby in dollars.
 */
function shipmentValue(shipment: CommandCenterShipment): string {
  const amount = shipment.totalValue ?? 0;
  return shipment.currency
    ? displayCurrency(amount, shipment.currency)
    : amount.toLocaleString();
}

const URGENCY_BADGE_CLASS: Record<Urgency, string> = {
  Critical: "bg-red-50 text-red-700 border-red-200",
  "At Risk": "bg-amber-50 text-amber-700 border-amber-200",
  Healthy: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function ScorePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-3 rounded-xl border border-[#E5E5EA]">
      <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider">{label}</p>
      <p className="text-sm font-extrabold text-[#1D1D1F] mt-0.5">{value}</p>
    </div>
  );
}

/** A shipment as the dashboard's server page serialises it for the KPI tiles. */
interface CommandCenterShipment {
  id: string;
  shipmentNumber: string;
  referenceNumber: string | null;
  exporterName: string;
  primaryHtsCode: string;
  totalValue: number;
  /**
   * ISO code the shipment's documents are denominated in, or null when they
   * declared none or disagreed. Null renders a bare number: this table printed
   * "$" over every entered value regardless, which misreports a EUR invoice.
   */
  currency: string | null;
  readinessScore: number;
  status: string;
  healthStatus: string | null;
  /** Null until a risk assessment has run; `null > 50` is false, as before. */
  riskScore: number | null;
  clientId: string | null;
  client: { id: string; name: string } | null;
  assignedBrokerId: string | null;
  assignedBroker: { id: string; firstName: string | null; lastName: string | null } | null;
  /** ISO string, or null when no ETA has been recorded. */
  estimatedArrival: string | null;
  requiredDocTypes: string[];
  missingDocTypes: string[];
  receivedDocCount: number;
  totalRequiredDocs: number;
}

/** An agent decision, reduced to what the dashboard counts. */
interface CommandCenterDecision {
  id: string;
  status: string;
  assignedBrokerId: string | null;
}

/** A regulatory update tile item. */
interface CommandCenterRegUpdate {
  id: string;
  title: string;
  summary: string | null;
  effectiveDate: string;
}

interface CommandCenterClientProps {
  accountName: string;
  initialShipments: CommandCenterShipment[];
  initialDecisions: CommandCenterDecision[];
  /**
   * Still supplied by the page, but nothing on this screen renders it any more --
   * the card that did was removed upstream. Kept on the props so the page keeps
   * compiling; see the note in the destructure below.
   */
  regUpdates: CommandCenterRegUpdate[];
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
  // accountName is still passed by the page but no longer rendered here; the
  // header that showed it moved into the shared app chrome.
  initialShipments,
  initialDecisions,
  // regUpdates is intentionally not destructured: it is still passed by the page
  // but no longer rendered here. The dashboard page still queries for it, which
  // is a wasted round trip worth removing separately.
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
  const [activeView, setActiveView] = useState<"overview" | "work">("overview");

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [rowMetrics, setRowMetrics] = useState<
    Record<string, { status: "loading" | "loaded" | "error"; metrics?: MultiDimensionalMetrics }>
  >({});

  const toggleExpandRow = (id: string) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
    if (!rowMetrics[id]) {
      setRowMetrics((prev) => ({ ...prev, [id]: { status: "loading" } }));
      fetch(`/api/shipments/${id}`)
        .then((res) => res.json())
        .then((data) => {
          setRowMetrics((prev) => ({ ...prev, [id]: { status: "loaded", metrics: data.metrics } }));
        })
        .catch(() => {
          setRowMetrics((prev) => ({ ...prev, [id]: { status: "error" } }));
        });
    }
  };

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

  // Shipments assigned to the logged-in user, sorted most-urgent and
  // soonest-arriving first -- this is what "My Work" shows, independent of
  // the Overview scope filters above.
  const myShipments = useMemo(() => {
    return initialShipments
      .filter((s) => s.assignedBrokerId === context.userId)
      .slice()
      .sort((a, b) => {
        const rankDiff = URGENCY_RANK[urgencyOf(a)] - URGENCY_RANK[urgencyOf(b)];
        if (rankDiff !== 0) return rankDiff;
        const aTime = a.estimatedArrival ? new Date(a.estimatedArrival).getTime() : Infinity;
        const bTime = b.estimatedArrival ? new Date(b.estimatedArrival).getTime() : Infinity;
        return aTime - bTime;
      });
  }, [initialShipments, context.userId]);

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
  const inProgressCount = filteredShipments.filter((s) => s.status === "In Progress").length;
  const readyToFileCount = filteredShipments.filter((s) => s.status === "Ready to File").length;
  const onHoldCount = filteredShipments.filter((s) => s.status === "On Hold").length;
  const submittedCount = filteredShipments.filter((s) => s.status === "Submitted").length;
  const completedCount = filteredShipments.filter((s) => s.status === "Completed").length;

  // Value at Risk: total $ value tied up in shipments that aren't ready to
  // file yet -- a dollar figure lands harder for a forwarder than an
  // abstract average readiness percentage, since it's what's actually on
  // the line (demurrage, detention, client trust) if something slips.
  const notReadyShipments = filteredShipments.filter((s) => s.readinessScore < 85);
  const clearedShipments = filteredShipments.filter((s) => s.readinessScore >= 85);
  const valueAtRisk = notReadyShipments.reduce((sum, s) => sum + (s.totalValue || 0), 0);
  // Only labelled with a currency when every contributing shipment shares one.
  // Adding EUR to USD produces a number that denominates nothing, so a mixed set
  // is shown unlabelled rather than stamped with whichever code came first.
  const valueAtRiskCurrency = commonExtractedCurrency(notReadyShipments);

  const reviewRequiredDecisions = filteredDecisions.filter(
    (d) => d.status === "Review Required" || d.status === "Needs Review"
  ).length;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-border shadow-2xs">
        <div className="flex bg-surface-muted p-1 rounded-xl border border-border text-xs">
          <button
            onClick={() => setActiveView("overview")}
            className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeView === "overview" ? "bg-white text-ink shadow-3xs" : "text-ink-muted"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveView("work")}
            className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeView === "work" ? "bg-white text-ink shadow-3xs" : "text-ink-muted"
            }`}
          >
            My Work
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative min-w-0 flex-1 max-w-72">
            <Search className="w-4 h-4 text-ink-muted absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t.dashboard.searchPlaceholder}
              disabled
              className="pl-9 pr-4 py-2 bg-surface-muted border border-border rounded-xl text-xs text-ink-muted w-full opacity-50 cursor-not-allowed"
            />
          </div>

          <Link
            href="/app/shipments/new"
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1.5 shrink-0 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t.dashboard.newShipment}</span>
          </Link>
        </div>
      </div>

      {/* Assignee/client scope controls -- Overview only; My Work is always scoped to the current user */}
      {activeView === "overview" && (isEnterpriseAdmin || clients.length > 0) && (
        <div className="bg-white p-3 rounded-2xl border border-border shadow-2xs flex flex-wrap items-center justify-end gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {isEnterpriseAdmin && (
              <>
                <div className="flex bg-surface-muted p-1 rounded-xl border border-border text-xs">
                  <button
                    onClick={() => setSelectedUserIds([context.userId])}
                    className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      selectedUserIds.length === 1 && selectedUserIds[0] === context.userId
                        ? "bg-white text-ink shadow-3xs"
                        : "text-ink-muted"
                    }`}
                  >
                    My Tasks
                  </button>
                  <button
                    onClick={() => setSelectedUserIds([])}
                    className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      selectedUserIds.length === 0 ? "bg-white text-ink shadow-3xs" : "text-ink-muted"
                    }`}
                  >
                    All Tasks
                  </button>
                </div>

                <div className="flex items-center space-x-2 text-xs relative">
                  <span className="text-ink-muted font-semibold">Team Members:</span>
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="px-3.5 py-1.5 rounded-xl border border-border bg-white text-xs text-ink focus:outline-none focus:border-brand font-semibold cursor-pointer flex items-center space-x-1.5 shadow-3xs"
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
                    <span className="text-ink-muted text-[9px]">▼</span>
                  </button>

                  {isDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
                      <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-border rounded-2xl shadow-lg p-3 z-20 space-y-2 max-h-60 overflow-y-auto">
                        <div className="flex items-center justify-between border-b border-border pb-2 mb-1 text-[10px] font-bold text-ink-muted uppercase">
                          <span>Select Members</span>
                          <div className="space-x-2">
                            <button
                              onClick={() => setSelectedUserIds(fullTeamList.map((t) => t.userId))}
                              className="text-brand hover:underline cursor-pointer"
                            >
                              All
                            </button>
                            <button
                              onClick={() => setSelectedUserIds([])}
                              className="text-brand hover:underline cursor-pointer"
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
                                className="flex items-center space-x-2.5 p-2 hover:bg-surface-muted rounded-xl cursor-pointer text-left transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleUser(member.userId)}
                                  className="rounded border-border text-brand focus:ring-brand cursor-pointer"
                                />
                                <div className="truncate">
                                  <p className="font-bold text-ink text-xs truncate">
                                    {memberName}
                                    {member.userId === context.userId && " (Me)"}
                                  </p>
                                  <p className="text-[10px] text-ink-muted truncate">
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
                <span className="text-ink-muted font-semibold">Client:</span>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="px-3.5 py-1.5 rounded-xl border border-border bg-white text-xs text-ink focus:outline-none focus:border-brand cursor-pointer font-semibold"
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

      {activeView === "overview" && (
      <>
      {/* Top KPI Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* 1. Value at Risk */}
        <Link
          href="/app/shipments"
          className="bg-white p-5 rounded-2xl border border-border shadow-2xs hover:border-red-400 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-start justify-between gap-2 text-xs text-ink-muted mb-2 group-hover:text-red-600">
            <span className="font-semibold min-w-0 leading-tight">Value at Risk</span>
            <DollarSign className="w-4 h-4 shrink-0 text-red-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-ink">
            {valueAtRiskCurrency
              ? displayCurrency(Math.round(valueAtRisk), valueAtRiskCurrency)
              : valueAtRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <div className="flex flex-wrap items-center justify-between mt-2 gap-x-2 gap-y-1">
            <span className="text-[10px] text-ink-muted truncate">
              {notReadyShipments.length} not ready to file
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap shrink-0">
              {clearedShipments.length} cleared
            </span>
          </div>
        </Link>

        {/* 2. Shipments in Progress */}
        <Link
          href="/app/shipments"
          className="bg-white p-5 rounded-2xl border border-border shadow-2xs hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-start justify-between gap-2 text-xs text-ink-muted mb-2 group-hover:text-blue-600">
            <span className="font-semibold min-w-0 leading-tight">{t.dashboard.kpiTotal}</span>
            <FileText className="w-4 h-4 shrink-0 text-blue-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-ink">{inProgressCount}</p>
          <div className="min-h-8 w-full mt-2 bg-gradient-to-r from-blue-50 to-blue-100/50 rounded-lg border border-blue-100 flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-blue-600 font-semibold group-hover:bg-blue-600 group-hover:text-white transition-all">
            <span className="min-w-0 leading-tight">Active Agent Pipelines</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>

        {/* 3. Ready to File */}
        <Link
          href="/app/filing"
          className="bg-white p-5 rounded-2xl border border-border shadow-2xs hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-start justify-between gap-2 text-xs text-ink-muted mb-2 group-hover:text-emerald-600">
            <span className="font-semibold min-w-0 leading-tight">{t.dashboard.kpiReady}</span>
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-emerald-600">{readyToFileCount}</p>
          <div className="min-h-8 w-full mt-2 bg-emerald-50 rounded-lg border border-emerald-100 flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-emerald-700 font-semibold group-hover:bg-emerald-600 group-hover:text-white transition-all">
            <span className="min-w-0 leading-tight">Verified for ACE</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>

        {/* 4. Requires Attention */}
        <Link
          href="/app/actions"
          className="bg-white p-5 rounded-2xl border border-border shadow-2xs hover:border-amber-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-start justify-between gap-2 text-xs text-ink-muted mb-2 group-hover:text-amber-600">
            <span className="font-semibold min-w-0 leading-tight">{t.dashboard.kpiAttention}</span>
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-amber-600">{onHoldCount}</p>
          <div className="min-h-8 w-full mt-2 bg-amber-50 rounded-lg border border-amber-100 flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-amber-700 font-semibold group-hover:bg-amber-500 group-hover:text-white transition-all">
            <span className="min-w-0 leading-tight">{reviewRequiredDecisions} Broker Reviews</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>

        {/* 5. Submitted to ACE */}
        <Link
          href="/app/filing"
          className="bg-white p-5 rounded-2xl border border-border shadow-2xs hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-start justify-between gap-2 text-xs text-ink-muted mb-2 group-hover:text-indigo-600">
            <span className="font-semibold min-w-0 leading-tight">{t.dashboard.kpiSubmitted}</span>
            <Send className="w-4 h-4 shrink-0 text-indigo-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-ink">{submittedCount}</p>
          <div className="min-h-8 w-full mt-2 bg-indigo-50 rounded-lg border border-indigo-100 flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-indigo-700 font-semibold group-hover:bg-indigo-600 group-hover:text-white transition-all">
            <span className="min-w-0 leading-tight">1C Released</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>

        {/* 6. Completed Filings */}
        <Link
          href="/app/filing"
          className="bg-white p-5 rounded-2xl border border-border shadow-2xs hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group block"
        >
          <div className="flex items-start justify-between gap-2 text-xs text-ink-muted mb-2 group-hover:text-emerald-600">
            <span className="font-semibold min-w-0 leading-tight">Completed Filings</span>
            <TrendingUp className="w-4 h-4 shrink-0 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-2xl font-extrabold text-ink">{completedCount}</p>
          <div className="min-h-8 w-full mt-2 bg-slate-50 rounded-lg border border-border flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-ink-muted font-semibold group-hover:bg-slate-800 group-hover:text-white transition-all">
            <span className="min-w-0 leading-tight">100% Audit Settled</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </div>
        </Link>
      </div>

      {/* Recent Shipments Table */}
      <div className="bg-white p-6 rounded-3xl border border-border shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h3 className="text-base font-extrabold text-ink tracking-tight">
              {t.dashboard.recentFilings}
            </h3>
            <p className="text-xs text-ink-muted">{t.dashboard.activeShipments}</p>
          </div>

          <Link
            href="/app/shipments"
            className="text-xs text-brand font-semibold hover:underline flex items-center space-x-1 cursor-pointer"
          >
            <span>{t.dashboard.viewAll}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-ink">
            <thead className="bg-surface-muted border-b border-border text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">{t.dashboard.colShipment}</th>
                <th className="py-3 px-4">{t.dashboard.colExporter}</th>
                <th className="py-3 px-4">{t.dashboard.colHts}</th>
                <th className="py-3 px-4">{t.dashboard.colValue}</th>
                <th className="py-3 px-4">{t.dashboard.colReadiness}</th>
                <th className="py-3 px-4">{t.dashboard.colStatus}</th>
                <th className="py-3 px-4">Client</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredShipments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-muted">
                    No active tasks found in this scope.
                  </td>
                </tr>
              ) : (
                filteredShipments.slice(0, 6).map((shp) => (
                  <tr key={shp.id} className="hover:bg-surface-muted/50 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-brand">
                      <Link href={`/app/shipments/${shp.id}`} className="hover:underline">
                        {shp.referenceNumber || shp.shipmentNumber || shp.id.slice(0, 10)}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-ink-muted">
                      {/* `shp.shipper` used to be consulted here, but the page has
                          never sent that field, so the term was always undefined. */}
                      {shp.exporterName || "Shenzhen Hardware Corp"}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-ink">
                      {shp.primaryHtsCode ?? "Not Yet Classified"}
                    </td>
                    <td className="py-3 px-4 font-semibold">
                      {shipmentValue(shp)}
                    </td>
                    <td className="py-3 px-4 font-bold text-emerald-600">
                      {shp.readinessScore ?? 0}%
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {shp.status || "In Progress"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {shp.client ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-brand/10 text-brand">
                          {shp.client.name}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {activeView === "work" && (
        <div className="bg-white p-6 rounded-3xl border border-[#E5E5EA] shadow-2xs space-y-4">
          <div className="border-b border-[#E5E5EA] pb-4">
            <h3 className="text-base font-extrabold text-[#1D1D1F] tracking-tight">My Work</h3>
            <p className="text-xs text-[#86868B]">
              {myShipments.length} shipment{myShipments.length === 1 ? "" : "s"} assigned to you
            </p>
          </div>

          {myShipments.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-2">
              <Inbox className="w-8 h-8 text-[#86868B]" />
              <p className="text-sm font-semibold text-[#1D1D1F]">No shipments assigned to you</p>
              <p className="text-xs text-[#86868B]">Shipments assigned to you will show up here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#1D1D1F]">
                <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Shipment</th>
                    <th className="py-3 px-4">Arrival</th>
                    <th className="py-3 px-4">Value</th>
                    <th className="py-3 px-4">Pending</th>
                    <th className="py-3 px-4">Urgency</th>
                    <th className="py-3 px-4 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {myShipments.map((shp) => {
                    const urgency = urgencyOf(shp);
                    const isExpanded = expandedRowId === shp.id;
                    const rowState = rowMetrics[shp.id];

                    return (
                      <Fragment key={shp.id}>
                        <tr
                          onClick={() => toggleExpandRow(shp.id)}
                          className="hover:bg-[#F5F5F7]/50 transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-4 font-mono font-bold text-[#0071E3]">
                            <Link
                              href={`/app/shipments/${shp.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:underline"
                            >
                              {shp.referenceNumber || shp.shipmentNumber || shp.id.slice(0, 10)}
                            </Link>
                          </td>
                          <td className="py-3 px-4 text-[#86868B]">
                            <span className="inline-flex items-center space-x-1.5">
                              <Clock className="w-3.5 h-3.5 text-[#86868B]" />
                              <span>{displayDate(shp.estimatedArrival)}</span>
                            </span>
                          </td>
                          <td className="py-3 px-4 font-semibold">
                            {shipmentValue(shp)}
                          </td>
                          <td className="py-3 px-4">
                            {shp.receivedDocCount}/{shp.totalRequiredDocs} docs
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${URGENCY_BADGE_CLASS[urgency]}`}
                            >
                              <AlertTriangle className="w-3 h-3" />
                              <span>{urgency}</span>
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <ChevronDown
                              className={`w-4 h-4 text-[#86868B] transition-transform inline-block ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${shp.id}-expanded`}>
                            <td colSpan={6} className="bg-[#F5F5F7]/60 px-4 py-4">
                              {(!rowState || rowState.status === "loading") && (
                                <p className="text-xs text-[#86868B]">Loading readiness…</p>
                              )}
                              {rowState?.status === "error" && (
                                <p className="text-xs text-red-600">Couldn&apos;t load readiness data.</p>
                              )}
                              {rowState?.status === "loaded" && rowState.metrics && (
                                <div className="space-y-3">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <ScorePill
                                      label="Filing Readiness"
                                      value={`${rowState.metrics.filingReadinessScore}%`}
                                    />
                                    <ScorePill
                                      label="Completeness"
                                      value={`${rowState.metrics.completenessScore}%`}
                                    />
                                    <ScorePill
                                      label="Compliance Risk"
                                      value={`${rowState.metrics.complianceRiskBand} (${rowState.metrics.complianceRiskScore})`}
                                    />
                                    <ScorePill
                                      label="HTS Confidence"
                                      value={
                                        rowState.metrics.classificationVerified
                                          ? `${rowState.metrics.classificationConfidenceScore}%`
                                          : "Unverified"
                                      }
                                    />
                                  </div>
                                  <p className="text-[11px] text-[#86868B]">
                                    {rowState.metrics.blockerCount} blocker
                                    {rowState.metrics.blockerCount === 1 ? "" : "s"} ·{" "}
                                    {rowState.metrics.warningCount} warning
                                    {rowState.metrics.warningCount === 1 ? "" : "s"}
                                  </p>
                                  {shp.missingDocTypes.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[11px] font-semibold text-[#86868B]">
                                        Missing:
                                      </span>
                                      {shp.missingDocTypes.map((docType: string) => (
                                        <span
                                          key={docType}
                                          className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200"
                                        >
                                          {docType}
                                        </span>
                                      ))}
                                      <Link
                                        href={`/app/shipments/${shp.id}?view=workspace`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-[11px] text-[#0071E3] font-semibold hover:underline"
                                      >
                                        Add Document →
                                      </Link>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
