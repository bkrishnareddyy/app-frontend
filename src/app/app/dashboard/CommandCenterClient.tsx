"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  FileText,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Plus,
  UserX,
  Clock,
  Users,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { displayCurrency } from "@/lib/honest";
import { commonExtractedCurrency } from "@/modules/documents/extractedCurrency";
import { CountdownChip } from "@/components/deadlines/CountdownChip";

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
   * declared none or disagreed. Null renders a bare number.
   */
  currency: string | null;
  readinessScore: number;
  status: string;
  healthStatus: string | null;
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
  /** Total active (non-resolved, non-waived) exceptions across all severities. */
  openExceptions: number;
  aiReview?: {
    blocked: number;
    needsReview: number;
    verified: number;
  };
  /** Named readiness factors (Document Completeness, Extraction Quality, etc.) behind readinessScore. */
  readinessDimensions?: { factor: string; status: "READY" | "PARTIAL" | "BLOCKED"; detail: string }[];
  /** Short "why isn't this ready" strings, one per factor below its max score. */
  readinessBlockers?: string[];
  /** Deterministic priority; null when nothing warrants surfacing this shipment. */
  priority?: "CRITICAL" | "HIGH" | "NORMAL" | null;
  attentionReasons?: string[];
}

interface AgentOperationsRow {
  agentName: string;
  processed: number;
  needsReview: number;
  blocked: number;
  verified: number;
}

interface ClassificationSignals {
  newOrInProgress: number;
  proposed: number;
  needsInformation: number;
  humanReviewRequired: number;
  approved: number;
  overridden: number;
}

interface ProductIntelligenceSignals {
  classificationRevalidationRequired: number;
  originRevalidationRequired: number;
  regulatoryRevalidationRequired: number;
  valuationReviewRequired: number;
  productsNeedingReview: number;
  significantChanges30d: number;
}

interface ReviewQueue {
  classification: number;
  productIntelligence: number;
  documentIntelligence: number;
  origin: number;
  valuation: number;
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

type UrgencyMap = Record<string, { deadlineType: string; dueAt: string; estimated: boolean; exposureUsd: number | null }>;

interface CommandCenterClientProps {
  accountName: string;
  initialShipments: CommandCenterShipment[];
  urgencyByShipment?: UrgencyMap;
  /**
   * Still supplied by the page; the new design derives all actionable counts
   * from per-shipment aiReview fields instead of the top-level decisions list.
   * Kept on props so the page keeps compiling.
   */
  initialDecisions: CommandCenterDecision[];
  /**
   * Still supplied by the page, but nothing on this screen renders it any more.
   * Kept on props so the page keeps compiling.
   */
  regUpdates: CommandCenterRegUpdate[];
  teamMembers: Array<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }>;
  clients: Array<{ id: string; name: string }>;
  agentOperations?: AgentOperationsRow[];
  /** True once the account's open shipments exceed the page's SHIPMENT_ROW_CAP. */
  shipmentsTruncated?: boolean;
  shipmentTotalCount?: number;
  /** True once the account's agent decisions exceed the page's SHIPMENT_ROW_CAP. */
  decisionsTruncated?: boolean;
  decisionTotalCount?: number;
  classificationSignals?: ClassificationSignals;
  productIntelligenceSignals?: ProductIntelligenceSignals;
  reviewQueue?: ReviewQueue;
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

const ACTIVE_STATUSES = new Set(["In Progress", "On Hold", "Ready to File", "Pending"]);

export function CommandCenterClient({
  initialShipments,
  initialDecisions,
  urgencyByShipment = {},
  teamMembers,
  clients,
  agentOperations = [],
  shipmentsTruncated = false,
  shipmentTotalCount,
  decisionsTruncated = false,
  decisionTotalCount,
  classificationSignals,
  productIntelligenceSignals,
  reviewQueue,
  context,
}: CommandCenterClientProps) {
  const { t } = useLanguage();
  const [liveMetrics, setLiveMetrics] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);

  const [selectedClientId, setSelectedClientId] = useState("ALL");
  const [isQualityTrendsExpanded, setIsQualityTrendsExpanded] = useState(false);

  useEffect(() => {
    const query = selectedClientId !== "ALL" ? `?clientId=${selectedClientId}` : "";
    fetch(`/api/dashboard/metrics${query}`)
      .then((res) => res.json())
      .then((data) => {
        setLiveMetrics(data.live);
        setSnapshots(data.snapshots || []);
      })
      .catch(console.error);
  }, [selectedClientId]);

  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

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

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    isEnterpriseAdmin ? [context.userId] : []
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const filteredShipments = useMemo(() => {
    return initialShipments.filter((shp) => {
      if (isEnterpriseAdmin && selectedUserIds.length > 0) {
        if (!shp.assignedBrokerId || !selectedUserIds.includes(shp.assignedBrokerId)) return false;
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

  const now = new Date();

  // ─── KPI metrics ──────────────────────────────────────────────────────────

  const unassignedCount = filteredShipments.filter(
    (s) => !s.assignedBrokerId && ACTIVE_STATUSES.has(s.status)
  ).length;

  const overdueCount = filteredShipments.filter(
    (s) =>
      s.estimatedArrival &&
      new Date(s.estimatedArrival) < now &&
      !["Completed", "Submitted"].includes(s.status)
  ).length;

  const needsActionCount = filteredShipments.filter(
    (s) => (s.aiReview?.blocked ?? 0) > 0 || (s.aiReview?.needsReview ?? 0) > 0
  ).length;

  const needsActionItems = filteredShipments.reduce(
    (sum, s) => sum + (s.aiReview?.blocked ?? 0) + (s.aiReview?.needsReview ?? 0),
    0
  );

  const inProgressCount = filteredShipments.filter((s) => s.status === "In Progress").length;
  const readyToFileCount = filteredShipments.filter((s) => s.status === "Ready to File").length;
  const completedCount = filteredShipments.filter((s) => s.status === "Completed").length;

  const notReadyShipments = filteredShipments.filter((s) => s.readinessScore < 85);
  const clearedShipments = filteredShipments.filter((s) => s.readinessScore >= 85);
  const valueAtRisk = notReadyShipments.reduce((sum, s) => sum + (s.totalValue || 0), 0);
  const valueAtRiskCurrency = commonExtractedCurrency(notReadyShipments);

  // ─── AI Throughput ────────────────────────────────────────────────────────

  const AUTO_CERTIFIED_STATUSES = new Set(["AUTO_VERIFIED", "Auto-Approved", "Verified"]);
  const HUMAN_REVIEWED_STATUSES = new Set(["Approved", "APPROVED", "Rejected", "REJECTED"]);

  const autoCertified = initialDecisions.filter((d) => AUTO_CERTIFIED_STATUSES.has(d.status)).length;
  const humanReviewed = initialDecisions.filter((d) => HUMAN_REVIEWED_STATUSES.has(d.status)).length;
  const totalResolved = autoCertified + humanReviewed;
  const touchRate = liveMetrics?.touchRate != null ? liveMetrics.touchRate : (totalResolved > 0 ? Math.round((humanReviewed / totalResolved) * 100) : null);

  // ─── Team workload (manager only) ─────────────────────────────────────────

  const brokerWorkload = useMemo(() => {
    const map = new Map<
      string,
      { name: string; initials: string; active: number; blocked: number; ready: number }
    >();
    let unassigned = 0;

    for (const shp of filteredShipments) {
      if (["Completed", "Submitted"].includes(shp.status)) continue;
      if (!shp.assignedBrokerId || !shp.assignedBroker) {
        unassigned++;
        continue;
      }
      const key = shp.assignedBrokerId;
      if (!map.has(key)) {
        const fn = shp.assignedBroker.firstName ?? "";
        const ln = shp.assignedBroker.lastName ?? "";
        const name = `${fn} ${ln}`.trim() || "Broker";
        const initials = `${fn.slice(0, 1)}${ln.slice(0, 1)}`.toUpperCase() || "?";
        map.set(key, { name, initials, active: 0, blocked: 0, ready: 0 });
      }
      const entry = map.get(key)!;
      entry.active++;
      if ((shp.aiReview?.blocked ?? 0) > 0 || shp.openExceptions > 0) entry.blocked++;
      if (shp.status === "Ready to File") entry.ready++;
    }

    return {
      list: Array.from(map.values()).sort((a, b) => b.active - a.active),
      unassigned,
    };
  }, [filteredShipments]);

  // ─── Requires Attention (top 5, deterministic priority) ───────────────────

  const attentionShipments = useMemo(() => {
    const PRIORITY_RANK: Record<string, number> = { CRITICAL: 2, HIGH: 1 };
    return filteredShipments
      .filter((s) => s.priority === "CRITICAL" || s.priority === "HIGH")
      .sort((a, b) => (PRIORITY_RANK[b.priority!] ?? 0) - (PRIORITY_RANK[a.priority!] ?? 0))
      .slice(0, 5);
  }, [filteredShipments]);

  // ─── Sub-views ────────────────────────────────────────────────────────────

  const tableColCount = isEnterpriseAdmin ? 8 : 7;

  const shipmentTable = (
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

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-ink">
          <thead className="bg-surface-muted border-b border-border text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
            <tr>
              <th className="py-3 px-4">Shipment</th>
              <th className="py-3 px-4">Client</th>
              {isEnterpriseAdmin && <th className="py-3 px-4">Broker</th>}
              <th className="py-3 px-4">Exceptions</th>
              <th className="py-3 px-4">AI Status</th>
              <th className="py-3 px-4">Readiness</th>
              <th className="py-3 px-4">ETA</th>
              <th className="py-3 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredShipments.length === 0 ? (
              <tr>
                <td colSpan={tableColCount} className="py-8 text-center text-ink-muted">
                  No active tasks found in this scope.
                </td>
              </tr>
            ) : (
              filteredShipments.slice(0, 10).map((shp) => {
                const brokerFn = shp.assignedBroker?.firstName ?? "";
                const brokerLn = shp.assignedBroker?.lastName ?? "";
                const brokerName = shp.assignedBroker
                  ? `${brokerFn} ${brokerLn}`.trim() || "—"
                  : null;
                const brokerInitials = shp.assignedBroker
                  ? `${brokerFn.slice(0, 1)}${brokerLn.slice(0, 1)}`.toUpperCase()
                  : "";
                const eta = shp.estimatedArrival
                  ? new Date(shp.estimatedArrival).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : null;
                const isOverdue =
                  shp.estimatedArrival &&
                  new Date(shp.estimatedArrival) < now &&
                  !["Completed", "Submitted"].includes(shp.status);
                const readiness = shp.readinessScore ?? 0;
                const readinessColor =
                  readiness >= 85
                    ? "bg-emerald-500"
                    : readiness >= 50
                    ? "bg-amber-400"
                    : "bg-red-400";
                const statusColor =
                  shp.status === "Ready to File"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : shp.status === "On Hold"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : shp.status === "Submitted"
                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                    : shp.status === "Completed"
                    ? "bg-slate-100 text-slate-600 border-slate-200"
                    : "bg-blue-50 text-blue-700 border-blue-200";

                return (
                  <tr key={shp.id} className="hover:bg-surface-muted/50 transition-colors">
                    {/* Shipment + importer */}
                    <td className="py-3 px-4">
                      <Link
                        href={`/app/shipments/${shp.id}`}
                        className="font-mono font-bold text-brand hover:underline block"
                      >
                        {shp.shipmentNumber || shp.id.slice(0, 10)}
                      </Link>
                      {shp.exporterName && (
                        <span
                          className="text-[10px] text-ink-muted block truncate max-w-[160px]"
                          title={shp.exporterName}
                        >
                          {shp.exporterName}
                        </span>
                      )}
                      {shp.shipmentNumber && urgencyByShipment[shp.shipmentNumber] && (() => {
                        const u = urgencyByShipment[shp.shipmentNumber];
                        const LABELS: Record<string, string> = { ISF_10_2: "ISF", ENTRY_FILING: "Entry Filing", ENTRY_SUMMARY: "Entry Summary", DUTY_PAYMENT: "Duty Payment", LAST_FREE_DAY: "Last Free Day" };
                        return <div className="mt-1.5"><CountdownChip label={LABELS[u.deadlineType] ?? u.deadlineType.replace(/_/g, " ")} dueAt={new Date(u.dueAt)} estimated={u.estimated} exposureUsd={u.exposureUsd} warnDays={u.deadlineType === "ENTRY_FILING" ? 5 : 3} /></div>;
                      })()}
                    </td>

                    {/* Client */}
                    <td className="py-3 px-4">
                      {shp.client ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-brand/10 text-brand">
                          {shp.client.name}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-muted">—</span>
                      )}
                    </td>

                    {/* Broker — manager only */}
                    {isEnterpriseAdmin && (
                      <td className="py-3 px-4">
                        {brokerName ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand/15 text-brand text-[10px] font-bold shrink-0">
                              {brokerInitials}
                            </span>
                            <span className="font-semibold text-ink truncate max-w-[100px]">
                              {brokerName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-red-500 font-semibold">Unassigned</span>
                        )}
                      </td>
                    )}

                    {/* Exceptions */}
                    <td className="py-3 px-4">
                      {shp.openExceptions > 0 ? (
                        <Link
                          href={`/app/actions?shipmentId=${shp.id}`}
                          className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold hover:opacity-80 transition-opacity"
                        >
                          {shp.openExceptions}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-ink-muted">—</span>
                      )}
                    </td>

                    {/* AI Status */}
                    <td className="py-3 px-4">
                      <Link
                        href={`/app/actions?shipmentId=${shp.id}`}
                        className="flex flex-wrap items-center gap-1.5 font-semibold text-[11px] whitespace-nowrap hover:opacity-80 transition-opacity cursor-pointer"
                      >
                        {(shp.aiReview?.blocked ?? 0) > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 font-bold">
                            {shp.aiReview!.blocked} blocked
                          </span>
                        )}
                        {(shp.aiReview?.needsReview ?? 0) > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                            {shp.aiReview!.needsReview} review
                          </span>
                        )}
                        {(shp.aiReview?.blocked ?? 0) === 0 &&
                          (shp.aiReview?.needsReview ?? 0) === 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {shp.aiReview?.verified ?? 0} verified
                            </span>
                          )}
                      </Link>
                    </td>

                    {/* Readiness bar */}
                    <td className="py-3 px-4">
                      <div
                        className="flex items-center gap-2"
                        title={
                          shp.readinessBlockers && shp.readinessBlockers.length > 0
                            ? shp.readinessBlockers.join("\n")
                            : "All readiness factors at full score"
                        }
                      >
                        <div className="w-16 h-1.5 bg-surface-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${readinessColor}`}
                            style={{ width: `${readiness}%` }}
                          />
                        </div>
                        <span className="font-semibold text-ink tabular-nums">{readiness}%</span>
                      </div>
                    </td>

                    {/* ETA */}
                    <td className="py-3 px-4">
                      {eta ? (
                        <span
                          className={`text-[11px] font-semibold ${
                            isOverdue ? "text-orange-600" : "text-ink-muted"
                          }`}
                        >
                          {eta}
                          {isOverdue && " ⚠"}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-muted">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${statusColor}`}
                      >
                        {shp.status || "In Progress"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const workloadPanel = (
    <div className="space-y-4">
      {/* Team Workload */}
      <div className="bg-white p-5 rounded-2xl border border-border shadow-2xs">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-ink-muted" />
          <h3 className="text-sm font-extrabold text-ink">Team Workload</h3>
        </div>

        <div className="space-y-1">
          <div className="grid grid-cols-5 text-[10px] font-bold text-ink-muted uppercase tracking-wider pb-2 border-b border-border">
            <span className="col-span-2">Broker</span>
            <span className="text-center">Active</span>
            <span className="text-center">Blocked</span>
            <span className="text-center">Ready</span>
          </div>

          {brokerWorkload.list.length === 0 && brokerWorkload.unassigned === 0 ? (
            <p className="text-xs text-ink-muted py-4 text-center">No active shipments</p>
          ) : (
            <>
              {brokerWorkload.list.map((b, i) => (
                <div
                  key={i}
                  className="grid grid-cols-5 items-center py-2 border-b border-border/50 last:border-0"
                >
                  <div className="col-span-2 flex items-center gap-2 min-w-0">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand/15 text-brand text-[10px] font-bold shrink-0">
                      {b.initials}
                    </span>
                    <span className="text-xs font-semibold text-ink truncate">{b.name}</span>
                  </div>
                  <span className="text-center text-xs font-bold text-ink">{b.active}</span>
                  <span className="text-center">
                    {b.blocked > 0 ? (
                      <span className="inline-block px-1.5 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
                        {b.blocked}
                      </span>
                    ) : (
                      <span className="text-[11px] text-emerald-600 font-bold">✓</span>
                    )}
                  </span>
                  <span className="text-center">
                    {b.ready > 0 ? (
                      <span className="inline-block px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                        {b.ready}
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink-muted">—</span>
                    )}
                  </span>
                </div>
              ))}

              {brokerWorkload.unassigned > 0 && (
                <div className="grid grid-cols-5 items-center py-2">
                  <div className="col-span-2 flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 text-[10px] font-bold shrink-0">
                      !
                    </span>
                    <span className="text-xs font-semibold text-red-600">Unassigned</span>
                  </div>
                  <span className="text-center text-xs font-bold text-red-600">
                    {brokerWorkload.unassigned}
                  </span>
                  <span className="text-center text-[11px] text-ink-muted">—</span>
                  <span className="text-center text-[11px] text-ink-muted">—</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Value at Risk (manager right panel) */}
      <Link
        href="/app/shipments"
        className="bg-white p-5 rounded-2xl border border-border shadow-2xs hover:border-red-400 hover:shadow-md transition-all cursor-pointer group block"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-extrabold text-ink">Value at Risk</h3>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-muted group-hover:text-red-500 transition-colors" />
        </div>
        <p className="text-2xl font-extrabold text-ink mb-2">
          {valueAtRiskCurrency
            ? displayCurrency(Math.round(valueAtRisk), valueAtRiskCurrency)
            : valueAtRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-ink-muted">{notReadyShipments.length} not ready to file</span>
          <span className="px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            {clearedShipments.length} cleared
          </span>
        </div>
      </Link>
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Scope bar */}
      <div className="bg-white p-3 rounded-2xl border border-border shadow-2xs flex flex-wrap items-center justify-between gap-4">
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
                  My Team
                </button>
                <button
                  onClick={() => setSelectedUserIds([])}
                  className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                    selectedUserIds.length === 0 ? "bg-white text-ink shadow-3xs" : "text-ink-muted"
                  }`}
                >
                  All Brokers
                </button>
              </div>

              <div className="flex items-center space-x-2 text-xs relative">
                <span className="text-ink-muted font-semibold">Broker:</span>
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="px-3.5 py-1.5 rounded-xl border border-border bg-white text-xs text-ink focus:outline-none focus:border-brand font-semibold cursor-pointer flex items-center space-x-1.5 shadow-3xs"
                >
                  <span>
                    {selectedUserIds.length === 0
                      ? "All Brokers"
                      : selectedUserIds.length === 1
                      ? selectedUserIds[0] === context.userId
                        ? `${context.firstName || "Me"} (Me)`
                        : (() => {
                            const user = fullTeamList.find(
                              (u) => u.userId === selectedUserIds[0]
                            );
                            return user
                              ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
                                  user.email
                              : "1 Selected";
                          })()
                      : `${selectedUserIds.length} Selected`}
                  </span>
                  <span className="text-ink-muted text-[9px]">▼</span>
                </button>

                {isDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setIsDropdownOpen(false)}
                    />
                    <div className="absolute left-0 top-full mt-2 w-64 bg-white border border-border rounded-2xl shadow-lg p-3 z-20 space-y-2 max-h-60 overflow-y-auto">
                      <div className="flex items-center justify-between border-b border-border pb-2 mb-1 text-[10px] font-bold text-ink-muted uppercase">
                        <span>Select Broker</span>
                        <div className="space-x-2">
                          <button
                            onClick={() =>
                              setSelectedUserIds(fullTeamList.map((t) => t.userId))
                            }
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

        <Link
          href="/app/shipments/new"
          className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1.5 shrink-0 whitespace-nowrap cursor-pointer ml-auto"
        >
          <Plus className="w-4 h-4" />
          <span>{t.dashboard.newShipment}</span>
        </Link>
      </div>

      {/* ─── Section 1: Queue at a Glance (Merged with KPI Tiles in one line) ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">Queue at a Glance</h3>
          </div>
          <span className="text-xs font-medium text-slate-500">Live operational backlog & pipeline overview</span>
        </div>

        {/* Unified 1-line grid of operational KPI tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
          {/* Tile 1: Open Exceptions (Clickable -> /app/actions) */}
          <Link
            href="/app/actions"
            className="bg-white p-4 rounded-xl border border-border shadow-2xs hover:border-red-400 hover:shadow-md transition-all cursor-pointer group block"
          >
            <div className="flex items-start justify-between gap-1.5 text-xs text-ink-muted mb-1.5 group-hover:text-red-600">
              <span className="font-semibold min-w-0 leading-tight">Open Exceptions</span>
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 group-hover:scale-110 transition-transform" />
            </div>
            <p className={`text-2xl font-extrabold ${(liveMetrics?.openExceptions ?? filteredShipments.reduce((s, sh) => s + (sh.openExceptions ?? 0), 0)) > 0 ? "text-red-600" : "text-ink"}`}>
              {liveMetrics?.openExceptions ?? filteredShipments.reduce((s, sh) => s + (sh.openExceptions ?? 0), 0)}
            </p>
            <div className="min-h-7 w-full mt-2 bg-red-50 rounded-lg border border-red-100 flex items-center justify-between gap-1 px-2 py-0.5 text-[10px] text-red-700 font-semibold group-hover:bg-red-600 group-hover:text-white transition-all">
              <span className="min-w-0 leading-tight truncate">Items requiring action</span>
              <ChevronRight className="w-3 h-3 shrink-0" />
            </div>
          </Link>

          {/* Tile 2: Unassigned / Value at Risk */}
          {isEnterpriseAdmin ? (
            <Link
              href="/app/shipments"
              className="bg-white p-4 rounded-xl border border-border shadow-2xs hover:border-red-400 hover:shadow-md transition-all cursor-pointer group block"
            >
              <div className="flex items-start justify-between gap-1.5 text-xs text-ink-muted mb-1.5 group-hover:text-red-600">
                <span className="font-semibold min-w-0 leading-tight">Unassigned</span>
                <UserX className="w-4 h-4 shrink-0 text-red-500 group-hover:scale-110 transition-transform" />
              </div>
              <p className={`text-2xl font-extrabold ${unassignedCount > 0 ? "text-red-600" : "text-ink"}`}>
                {unassignedCount}
              </p>
              <div className="min-h-7 w-full mt-2 bg-red-50 rounded-lg border border-red-100 flex items-center justify-between gap-1 px-2 py-0.5 text-[10px] text-red-700 font-semibold group-hover:bg-red-600 group-hover:text-white transition-all">
                <span className="min-w-0 leading-tight truncate">No broker assigned</span>
                <ChevronRight className="w-3 h-3 shrink-0" />
              </div>
            </Link>
          ) : (
            <Link
              href="/app/shipments"
              className="bg-white p-4 rounded-xl border border-border shadow-2xs hover:border-red-400 hover:shadow-md transition-all cursor-pointer group block"
            >
              <div className="flex items-start justify-between gap-1.5 text-xs text-ink-muted mb-1.5 group-hover:text-red-600">
                <span className="font-semibold min-w-0 leading-tight">Value at Risk</span>
                <ShieldAlert className="w-4 h-4 shrink-0 text-red-500 group-hover:scale-110 transition-transform" />
              </div>
              <p className="text-2xl font-extrabold text-ink truncate">
                {valueAtRiskCurrency
                  ? displayCurrency(Math.round(valueAtRisk), valueAtRiskCurrency)
                  : valueAtRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <div className="flex items-center justify-between mt-2 text-[10px] text-ink-muted">
                <span className="truncate">{notReadyShipments.length} not ready</span>
                <span className="font-semibold text-emerald-700">{clearedShipments.length} cleared</span>
              </div>
            </Link>
          )}

          {/* Tile 3: Overdue */}
          <Link
            href="/app/shipments"
            className="bg-white p-4 rounded-xl border border-border shadow-2xs hover:border-orange-400 hover:shadow-md transition-all cursor-pointer group block"
          >
            <div className="flex items-start justify-between gap-1.5 text-xs text-ink-muted mb-1.5 group-hover:text-orange-600">
              <span className="font-semibold min-w-0 leading-tight">Overdue</span>
              <Clock className="w-4 h-4 shrink-0 text-orange-500 group-hover:scale-110 transition-transform" />
            </div>
            <p className={`text-2xl font-extrabold ${overdueCount > 0 ? "text-orange-600" : "text-ink"}`}>
              {overdueCount}
            </p>
            <div className="min-h-7 w-full mt-2 bg-orange-50 rounded-lg border border-orange-100 flex items-center justify-between gap-1 px-2 py-0.5 text-[10px] text-orange-700 font-semibold group-hover:bg-orange-500 group-hover:text-white transition-all">
              <span className="min-w-0 leading-tight truncate">Past ETA, not filed</span>
              <ChevronRight className="w-3 h-3 shrink-0" />
            </div>
          </Link>

          {/* Tile 4: Needs Action */}
          <Link
            href="/app/actions"
            className="bg-white p-4 rounded-xl border border-border shadow-2xs hover:border-amber-500 hover:shadow-md transition-all cursor-pointer group block"
          >
            <div className="flex items-start justify-between gap-1.5 text-xs text-ink-muted mb-1.5 group-hover:text-amber-600">
              <span className="font-semibold min-w-0 leading-tight">Needs Action</span>
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-500 group-hover:scale-110 transition-transform" />
            </div>
            <p className={`text-2xl font-extrabold ${needsActionCount > 0 ? "text-amber-600" : "text-ink"}`}>
              {needsActionCount}
            </p>
            <div className="min-h-7 w-full mt-2 bg-amber-50 rounded-lg border border-amber-100 flex items-center justify-between gap-1 px-2 py-0.5 text-[10px] text-amber-700 font-semibold group-hover:bg-amber-500 group-hover:text-white transition-all">
              <span className="min-w-0 leading-tight truncate">
                {needsActionItems} {isEnterpriseAdmin ? "broker reviews" : "my reviews"}
              </span>
              <ChevronRight className="w-3 h-3 shrink-0" />
            </div>
          </Link>

          {/* Tile 5: Total Active Filings */}
          <Link
            href="/app/shipments"
            className="bg-white p-4 rounded-xl border border-border shadow-2xs hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group block"
          >
            <div className="flex items-start justify-between gap-1.5 text-xs text-ink-muted mb-1.5 group-hover:text-blue-600">
              <span className="font-semibold min-w-0 leading-tight">{t.dashboard.kpiTotal}</span>
              <FileText className="w-4 h-4 shrink-0 text-blue-500 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-2xl font-extrabold text-ink">{inProgressCount}</p>
            <div className="min-h-7 w-full mt-2 bg-blue-50 rounded-lg border border-blue-100 flex items-center justify-between gap-1 px-2 py-0.5 text-[10px] text-blue-600 font-semibold group-hover:bg-blue-600 group-hover:text-white transition-all">
              <span className="min-w-0 leading-tight truncate">Active pipelines</span>
              <ChevronRight className="w-3 h-3 shrink-0" />
            </div>
          </Link>

          {/* Tile 6: Ready to File (CBP) */}
          <Link
            href="/app/filing"
            className="bg-white p-4 rounded-xl border border-border shadow-2xs hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group block"
          >
            <div className="flex items-start justify-between gap-1.5 text-xs text-ink-muted mb-1.5 group-hover:text-emerald-600">
              <span className="font-semibold min-w-0 leading-tight">{t.dashboard.kpiReady}</span>
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-2xl font-extrabold text-emerald-600">{readyToFileCount}</p>
            <div className="min-h-7 w-full mt-2 bg-emerald-50 rounded-lg border border-emerald-100 flex items-center justify-between gap-1 px-2 py-0.5 text-[10px] text-emerald-700 font-semibold group-hover:bg-emerald-600 group-hover:text-white transition-all">
              <span className="min-w-0 leading-tight truncate">Verified for ACE</span>
              <ChevronRight className="w-3 h-3 shrink-0" />
            </div>
          </Link>

          {/* Tile 7: Completed */}
          <Link
            href="/app/filing"
            className="bg-white p-4 rounded-xl border border-border shadow-2xs hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group block"
          >
            <div className="flex items-start justify-between gap-1.5 text-xs text-ink-muted mb-1.5 group-hover:text-emerald-600">
              <span className="font-semibold min-w-0 leading-tight">Completed</span>
              <TrendingUp className="w-4 h-4 shrink-0 text-emerald-500 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-2xl font-extrabold text-ink">{completedCount}</p>
            <div className="min-h-7 w-full mt-2 bg-slate-50 rounded-lg border border-border flex items-center justify-between gap-1 px-2 py-0.5 text-[10px] text-ink-muted font-semibold group-hover:bg-slate-800 group-hover:text-white transition-all">
              <span className="min-w-0 leading-tight truncate">Audit settled</span>
              <ChevronRight className="w-3 h-3 shrink-0" />
            </div>
          </Link>
        </div>

        {/* Secondary exception metrics */}
        <div className="pt-3 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-slate-100">
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Avg Exception Age</span>
              <span className="text-xl font-extrabold text-amber-700">
                {liveMetrics?.exceptionAgeAvgHours != null ? `${liveMetrics.exceptionAgeAvgHours} hrs` : "—"}
              </span>
            </div>
            <span className="text-xs text-slate-500 font-medium">time in queue</span>
          </div>
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Human Touch Rate</span>
              <span className="text-xl font-extrabold text-indigo-700">
                {liveMetrics?.touchRate != null ? `${liveMetrics.touchRate}%` : "—"}
              </span>
            </div>
            <span className="text-xs text-slate-500 font-medium">manual intervention</span>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Exception Age Distribution</span>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "0-24h", value: liveMetrics?.exceptionAgeBuckets?.under24h ?? 0, color: "bg-emerald-500" },
                { label: "1-7d", value: liveMetrics?.exceptionAgeBuckets?.days1to7 ?? 0, color: "bg-amber-500" },
                { label: "7-30d", value: liveMetrics?.exceptionAgeBuckets?.days7to30 ?? 0, color: "bg-orange-500" },
                { label: "30+d", value: liveMetrics?.exceptionAgeBuckets?.over30d ?? 0, color: "bg-red-500" },
              ].map((bucket, _, arr) => {
                const maxVal = Math.max(1, ...arr.map((b) => b.value));
                return (
                  <div key={bucket.label} className="flex flex-col justify-between">
                    <div className="flex items-center justify-between text-[10px] mb-1">
                      <span className="font-semibold text-slate-600">{bucket.label}</span>
                      <span className="font-extrabold text-slate-900">{bucket.value}</span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${bucket.color} transition-all`}
                        style={{ width: `${Math.min(100, (bucket.value / maxVal) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Section 2: Filing Pipeline (D-2, D-3) ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">Filing Pipeline</h3>
          </div>
          <span className="text-xs font-medium text-slate-500">Customs transmission & duty metrics</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Cycle Time Median</span>
            <span className="text-xl font-extrabold text-slate-800">
              {liveMetrics?.cyclTimeMedianHours != null ? `${liveMetrics.cyclTimeMedianHours} hrs` : "—"}
            </span>
          </div>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">First-Pass Acceptance</span>
            <span className="text-xl font-extrabold text-emerald-700">
              {liveMetrics?.firstPassRate != null ? `${liveMetrics.firstPassRate}%` : "—"}
            </span>
          </div>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Filed Entries</span>
            <span className="text-xl font-extrabold text-slate-800">{liveMetrics?.filedEntries ?? 0}</span>
          </div>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Duty / Entry</span>
            <span className="text-xl font-extrabold text-slate-800">
              {liveMetrics?.dutyPerEntry != null ? `$${liveMetrics.dutyPerEntry.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
            </span>
          </div>
        </div>

        {/* Filing Cycle-Time Timeline Chart (D-3) */}
        <div className="pt-2">
          <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-2">Filing Cycle-Time Timeline (30-Day Rolling Median)</span>
          {snapshots.length > 0 ? (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-end gap-3 h-24 pt-2">
                {snapshots.map((s, idx) => {
                  const maxHours = Math.max(...snapshots.map((snap) => snap.cyclTimeMedianHours || 1), 24);
                  const pct = Math.round(((s.cyclTimeMedianHours || 0) / maxHours) * 100);
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group relative">
                      <span className="text-[10px] font-bold text-slate-700">{s.cyclTimeMedianHours != null ? `${s.cyclTimeMedianHours}h` : "—"}</span>
                      <div className="w-full bg-indigo-200 hover:bg-indigo-400 rounded-t-md transition-all" style={{ height: `${Math.max(15, pct)}%` }} />
                      <span className="text-[9px] text-slate-500 font-mono">{s.date}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center text-xs text-slate-500 py-6">
              Cycle time history loading...
            </div>
          )}
        </div>
      </div>

      {/* ─── Requires Attention (deterministic priority, top 5) ─── */}
      {attentionShipments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">Requires Attention</h3>
            </div>
            <span className="text-xs font-medium text-slate-500">Top {attentionShipments.length} by priority</span>
          </div>
          <div className="space-y-2">
            {attentionShipments.map((s) => (
              <Link
                key={s.id}
                href={`/app/shipments/${s.id}`}
                className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-surface-muted/50 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                      s.priority === "CRITICAL"
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {s.priority}
                  </span>
                  <span className="font-mono font-bold text-brand text-xs shrink-0">
                    {s.shipmentNumber || s.id.slice(0, 10)}
                  </span>
                  <span className="text-xs text-ink-muted truncate">
                    {(s.attentionReasons ?? []).join(" · ")}
                  </span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-ink-muted shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {(shipmentsTruncated || decisionsTruncated) && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold rounded-xl px-4 py-2.5">
          {shipmentsTruncated && (
            <>Showing the {filteredShipments.length} most recent of {shipmentTotalCount} open shipments. </>
          )}
          {decisionsTruncated && (
            <>Agent throughput reflects the {initialDecisions.length} most recent of {decisionTotalCount} decisions. </>
          )}
          KPI tiles above only cover the shipments/decisions shown.
        </div>
      )}

      {/* Main content — two-column for managers, full-width for solo brokers */}
      {isEnterpriseAdmin ? (
        <div className="flex gap-6 items-start">
          <div className="flex-1 min-w-0">{shipmentTable}</div>
          <div className="w-72 shrink-0">{workloadPanel}</div>
        </div>
      ) : (
        shipmentTable
      )}

      {/* ─── Expandable Quality Trends (at the bottom) ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <button
          type="button"
          onClick={() => setIsQualityTrendsExpanded(!isQualityTrendsExpanded)}
          className="w-full flex items-center justify-between text-left cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <h3 className="text-sm font-bold text-slate-900 tracking-tight group-hover:text-brand transition-colors">
              Quality Trends
            </h3>
            <span className="text-xs font-medium text-slate-500 ml-2">Historical accuracy & touch rate</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 group-hover:text-brand transition-colors">
            <span>{isQualityTrendsExpanded ? "Hide Quality Trends" : "Expand Quality Trends"}</span>
            {isQualityTrendsExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </button>

        {isQualityTrendsExpanded && (
          <div className="space-y-4 pt-2 border-t border-slate-100 transition-all">
            {totalResolved > 0 && (
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-brand/10 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-3 h-3 text-brand" />
                  </div>
                  <span className="text-[11px] font-bold text-ink uppercase tracking-wider">AI Throughput</span>
                </div>
                <div className="flex items-center gap-4 flex-wrap text-[11px]">
                  <span className="text-ink-muted">
                    Auto-certified:{" "}
                    <span className="font-bold text-emerald-700">{autoCertified}</span>
                  </span>
                  <span className="text-ink-muted">
                    Human reviewed:{" "}
                    <span className="font-bold text-ink">{humanReviewed}</span>
                  </span>
                  {touchRate !== null && (
                    <span className="text-ink-muted">
                      Touch rate:{" "}
                      <span className={`font-bold ${touchRate <= 20 ? "text-emerald-700" : touchRate <= 50 ? "text-amber-600" : "text-red-600"}`}>
                        {touchRate}%
                      </span>
                    </span>
                  )}
                </div>
                {touchRate !== null && (
                  <div className="flex-1 min-w-24 max-w-48 h-1.5 rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all"
                      style={{ width: `${100 - touchRate}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Agent Operations */}
            {agentOperations.length > 0 && (
              <div className="pt-2">
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-2">Agent Operations</span>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        <th className="py-1.5 pr-4">Agent</th>
                        <th className="py-1.5 pr-4">Processed</th>
                        <th className="py-1.5 pr-4">Review</th>
                        <th className="py-1.5 pr-4">Blocked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentOperations.map((row) => (
                        <tr key={row.agentName} className="border-t border-slate-100">
                          <td className="py-1.5 pr-4 font-semibold text-slate-800">{row.agentName}</td>
                          <td className="py-1.5 pr-4 text-slate-700">{row.processed}</td>
                          <td className="py-1.5 pr-4">
                            {row.needsReview > 0 ? (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold">{row.needsReview}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-4">
                            {row.blocked > 0 ? (
                              <span className="px-1.5 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 font-bold">{row.blocked}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Classification Signals / Product Intelligence / Review Queue */}
            {(classificationSignals || productIntelligenceSignals || reviewQueue) && (
              <div className="pt-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                {classificationSignals && (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-2">Classification Signals</span>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <Link href="/app/products?unclassified=true" className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-semibold hover:opacity-80">
                        {classificationSignals.newOrInProgress} in progress
                      </Link>
                      {classificationSignals.humanReviewRequired > 0 && (
                        <Link href="/app/products?reviewStatus=NEEDS_REVIEW" className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold hover:opacity-80">
                          {classificationSignals.humanReviewRequired} needs review
                        </Link>
                      )}
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                        {classificationSignals.approved} approved
                      </span>
                      {classificationSignals.overridden > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                          {classificationSignals.overridden} overridden
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {productIntelligenceSignals && (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-2">Product Intelligence</span>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {productIntelligenceSignals.classificationRevalidationRequired > 0 && (
                        <Link href="/app/products?needsRevalidation=true" className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold hover:opacity-80">
                          {productIntelligenceSignals.classificationRevalidationRequired} classification revalidation
                        </Link>
                      )}
                      {productIntelligenceSignals.originRevalidationRequired > 0 && (
                        <Link href="/app/products?needsRevalidation=true" className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold hover:opacity-80">
                          {productIntelligenceSignals.originRevalidationRequired} origin revalidation
                        </Link>
                      )}
                      {productIntelligenceSignals.regulatoryRevalidationRequired > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                          {productIntelligenceSignals.regulatoryRevalidationRequired} regulatory revalidation
                        </span>
                      )}
                      {productIntelligenceSignals.valuationReviewRequired > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                          {productIntelligenceSignals.valuationReviewRequired} valuation review
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                        {productIntelligenceSignals.significantChanges30d} significant changes (30d)
                      </span>
                    </div>
                  </div>
                )}

                {reviewQueue && (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-2">My Review Queue</span>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {reviewQueue.classification > 0 && (
                        <Link href="/app/products?reviewStatus=NEEDS_REVIEW" className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold hover:opacity-80">
                          {reviewQueue.classification} classification
                        </Link>
                      )}
                      {reviewQueue.productIntelligence > 0 && (
                        <Link href="/app/products?reviewStatus=NEEDS_REVIEW" className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold hover:opacity-80">
                          {reviewQueue.productIntelligence} product
                        </Link>
                      )}
                      {reviewQueue.documentIntelligence > 0 && (
                        <Link href="/app/actions" className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold hover:opacity-80">
                          {reviewQueue.documentIntelligence} document
                        </Link>
                      )}
                      {reviewQueue.origin > 0 && (
                        <Link href="/app/actions" className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold hover:opacity-80">
                          {reviewQueue.origin} origin
                        </Link>
                      )}
                      {reviewQueue.valuation > 0 && (
                        <Link href="/app/actions" className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold hover:opacity-80">
                          {reviewQueue.valuation} valuation
                        </Link>
                      )}
                      {reviewQueue.classification === 0 &&
                        reviewQueue.productIntelligence === 0 &&
                        reviewQueue.documentIntelligence === 0 &&
                        reviewQueue.origin === 0 &&
                        reviewQueue.valuation === 0 && (
                          <span className="text-slate-400">Queue is clear</span>
                        )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
