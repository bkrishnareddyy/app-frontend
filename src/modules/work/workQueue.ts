import {
  isTerminalExceptionState,
  normalizeExceptionStatus,
  openStatusVariants,
} from "@/modules/exceptions/exceptionState";
import {
  actionableStatusVariants,
  triageDecision,
} from "@/modules/decisions/decisionState";

export type WorkItemKind = "decision" | "finding" | "filing" | "document" | "exception";
export type WorkPriority = "critical" | "high" | "normal";

/** The most-urgent open deadline on the shipment this item belongs to. */
export interface UrgencyContext {
  deadlineType: string;
  dueAt: Date;
  msRemaining: number;
  breached: boolean;
  /** True when dueAt was computed from ETA/ETD rather than a confirmed date. */
  estimated: boolean;
  /** USD penalty exposure from the rule, or null when not quantifiable. */
  exposureUsd: number | null;
}

export interface WorkItem {
  id: string;
  kind: WorkItemKind;
  title: string;
  reason: string;
  href: string;
  priority: WorkPriority;
  /** Numeric sort key — higher is more urgent. Never rendered in the UI. */
  score: number;
  createdAt: Date;
  shipmentNumber: string | null;
  assignedToMe: boolean;
  filingDeadline: Date | null;
  /** Set when the item's shipment has an open ComplianceDeadline. */
  urgency: UrgencyContext | null;
}

export interface DecisionRow {
  id: string;
  agentName: string;
  decisionSummary: string;
  status: string;
  proposedDescription?: string | null;
  confidence?: number | null;
  createdAt: Date;
  shipmentId: string;
  shipmentNumber: string | null;
  filingDeadline?: Date | null;
}

export interface FindingRow {
  id: string;
  rule: string;
  severity: string;
  status: string;
  createdAt: Date;
  filingId: string;
  assignedToUserId: string | null;
}

export interface FilingRow {
  id: string;
  entryNumber: string;
  filingStatus: string;
  createdAt: Date;
  shipmentNumber: string | null;
  shipmentId?: string | null;
}

export interface DocumentRow {
  id: string;
  fileName: string;
  status: string;
  createdAt: Date;
  /** Null once the document is detached from its shipment. */
  shipmentId: string | null;
  shipmentNumber: string | null;
}

export interface ExceptionRow {
  id: string;
  type: string;
  description: string;
  severity: string;
  status: string;
  createdAt: Date;
  shipmentId: string | null;
  shipmentNumber: string | null;
  assignedToUserId: string | null;
  filingDeadline?: Date | null;
}

/** One open ComplianceDeadline row, for attaching urgency context to items. */
export interface DeadlineRow {
  shipmentId: string;
  type: string;
  dueAt: Date;
  estimated: boolean;
  penaltyEstimate: number | null; // USD
}

export interface WorkQueueInput {
  userId: string;
  decisions: DecisionRow[];
  findings: FindingRow[];
  filings: FilingRow[];
  documents: DocumentRow[];
  exceptions?: ExceptionRow[];
  /** Open ComplianceDeadline rows for the account. Used to attach urgency context. */
  deadlines?: DeadlineRow[];
}

// Decisions use the normalizer in decisionState.ts — no hardcoded status list here.

const FINDING_ACTIONABLE = new Set(["Open", "Investigating"]);

const FINDING_SEVERITY: Record<string, WorkPriority> = {
  Critical: "critical",
  High: "high",
  Warning: "normal",
  Info: "normal",
};

const FILING_ACTIONABLE: Record<string, WorkPriority> = {
  ValidationFailed: "critical",
  Rejected: "critical",
  CustomsHold: "critical",
  DocumentsRequested: "high",
  ReadyForBrokerReview: "high",
  Draft: "normal",
};

const DOCUMENT_ACTIONABLE: Record<string, WorkPriority> = {
  "Review Required": "high",
  Missing: "high",
};

const EXCEPTION_SEVERITY: Record<string, WorkPriority> = {
  Critical: "critical",
  High: "high",
  Medium: "normal",
  Low: "normal",
};

const PRIORITY_RANK: Record<WorkPriority, number> = { critical: 0, high: 1, normal: 2 };

function raise(priority: WorkPriority): WorkPriority {
  if (priority === "normal") return "high";
  return "critical";
}

// ── Scoring ────────────────────────────────────────────────────────────────
// Score determines sort order. Higher = more urgent.
// The score is never shown in the UI — the clock and dollar figure explain.

const W_TIME = 0.60;    // time pressure (breached deadline scores 2*0.60 = 1.20)
const W_MONEY = 0.15;   // normalized penalty exposure
const W_PRIORITY = 0.20; // base priority contribution for items without urgency
const BLOCKING_BOOST = 0.05; // items that block downstream agents
const ASSIGNED_BOOST = 0.05; // items assigned to the current user

const MAX_EXPOSURE_USD = 50_000;

/** Priority → base score so items without a deadline still rank by priority. */
const PRIORITY_BASE: Record<WorkPriority, number> = {
  critical: 1.0, // will be multiplied by W_PRIORITY
  high: 0.5,
  normal: 0.0,
};

/**
 * Non-linear time pressure: 2.00 when breached, decays logarithmically.
 * Numerical behaviour: 1.00@0h · 0.77@1h · 0.42@24h · 0.35@3d · 0.26@30d
 *
 * A deadline-bearing item always outscores any priority-only item because
 * urgency >= 0 at 30+ days contributes ~0.26 * 0.60 = 0.16, which exceeds
 * the max pure-priority contribution (critical = 1.0 * 0.20 = 0.20) only at
 * ~24h — precisely when deadline urgency should take precedence.
 */
function timePressure(msRemaining: number): number {
  if (msRemaining <= 0) return 2; // breached outranks everything
  const hours = msRemaining / 3_600_000;
  return 1 / (1 + Math.log10(1 + hours));
}

function computeScore(params: {
  urgency: UrgencyContext | null;
  priority: WorkPriority;
  blocking: boolean;
  assignedToMe: boolean;
}): number {
  const { urgency, priority, blocking, assignedToMe } = params;

  const tp = urgency ? timePressure(urgency.msRemaining) : 0;
  const exposure = urgency?.exposureUsd ?? null;
  const normalizedExposure = exposure != null ? Math.min(exposure / MAX_EXPOSURE_USD, 1) : 0;
  const basePriority = urgency ? 0 : PRIORITY_BASE[priority]; // priority base only when no urgency

  return (
    tp * W_TIME +
    normalizedExposure * W_MONEY +
    basePriority * W_PRIORITY +
    (blocking ? BLOCKING_BOOST : 0) +
    (assignedToMe ? ASSIGNED_BOOST : 0)
  );
}

/** Priority derived from urgency — for shipment-level rollup. */
function urgencyToPriority(urgency: UrgencyContext): WorkPriority {
  if (urgency.breached || urgency.msRemaining <= 24 * 3_600_000) return "critical";
  if (urgency.msRemaining <= 3 * 24 * 3_600_000) return "high";
  return "normal";
}

/** Apply urgency as a priority floor — never demotes an already-higher priority. */
function applyUrgencyFloor(base: WorkPriority, urgency: UrgencyContext | null): WorkPriority {
  if (!urgency) return base;
  const floor = urgencyToPriority(urgency);
  return PRIORITY_RANK[floor] < PRIORITY_RANK[base] ? floor : base;
}

// ── Shipment → deadline index ──────────────────────────────────────────────

function buildDeadlineIndex(
  deadlines: DeadlineRow[],
  now: Date
): Map<string, UrgencyContext> {
  // For each shipment, keep only the most-urgent open deadline.
  const best = new Map<string, UrgencyContext>();

  for (const d of deadlines) {
    const msRemaining = d.dueAt.getTime() - now.getTime();
    const ctx: UrgencyContext = {
      deadlineType: d.type,
      dueAt: d.dueAt,
      msRemaining,
      breached: msRemaining <= 0,
      estimated: d.estimated,
      exposureUsd: d.penaltyEstimate,
    };

    const existing = best.get(d.shipmentId);
    if (!existing || timePressure(msRemaining) > timePressure(existing.msRemaining)) {
      best.set(d.shipmentId, ctx);
    }
  }

  return best;
}

// ── Legacy deadline urgency (for rows that don't have a shipmentId) ────────

const DEADLINE_CRITICAL_MS = 24 * 60 * 60 * 1000;
const DEADLINE_HIGH_MS = 3 * 24 * 60 * 60 * 1000;

function applyDeadlineUrgency(priority: WorkPriority, deadline: Date | null | undefined, now: Date): WorkPriority {
  if (!deadline) return priority;
  const remaining = deadline.getTime() - now.getTime();
  if (remaining <= 0 || remaining <= DEADLINE_CRITICAL_MS) return "critical";
  if (remaining <= DEADLINE_HIGH_MS) return raise(priority);
  return priority;
}

/**
 * Builds the queue from rows the caller has already scoped to its account.
 * Only statuses that genuinely await a human are included; nothing is inferred
 * for records whose status is unrecognised.
 */
export function buildWorkQueue(input: WorkQueueInput): WorkItem[] {
  const items: WorkItem[] = [];
  const now = new Date();

  // Build shipmentId → most-urgent-deadline index for rollup (4.1.4).
  const deadlineIndex = buildDeadlineIndex(input.deadlines ?? [], now);

  for (const decision of input.decisions) {
    const triage = triageDecision(decision);
    if (triage === "verified") continue;

    const urgency = decision.shipmentId ? (deadlineIndex.get(decision.shipmentId) ?? null) : null;
    const isBlocking = triage === "blocked";
    const base: WorkPriority = isBlocking ? "critical" : "high";
    // Shipment rollup: urgency can raise priority but never lower it.
    const priority = applyUrgencyFloor(
      applyDeadlineUrgency(base, decision.filingDeadline, now),
      urgency
    );
    const score = computeScore({ urgency, priority, blocking: isBlocking, assignedToMe: false });

    items.push({
      id: `decision:${decision.id}`,
      kind: "decision",
      title: decision.agentName,
      reason: decision.decisionSummary,
      href: `/app/actions?decisionId=${encodeURIComponent(decision.id)}`,
      priority,
      score,
      createdAt: decision.createdAt,
      shipmentNumber: decision.shipmentNumber,
      assignedToMe: false,
      filingDeadline: decision.filingDeadline ?? null,
      urgency,
    });
  }

  for (const finding of input.findings) {
    if (!FINDING_ACTIONABLE.has(finding.status)) continue;
    const assignedToMe = finding.assignedToUserId === input.userId;
    const base = FINDING_SEVERITY[finding.severity] ?? "normal";
    const priority = assignedToMe ? raise(base) : base;
    const score = computeScore({ urgency: null, priority, blocking: false, assignedToMe });

    items.push({
      id: `finding:${finding.id}`,
      kind: "finding",
      title: finding.rule,
      reason: `${finding.severity} compliance finding is ${finding.status.toLowerCase()}`,
      href: `/app/filing?filingId=${encodeURIComponent(finding.filingId)}`,
      priority,
      score,
      createdAt: finding.createdAt,
      shipmentNumber: null,
      assignedToMe,
      filingDeadline: null,
      urgency: null,
    });
  }

  for (const filing of input.filings) {
    const basePriority = FILING_ACTIONABLE[filing.filingStatus];
    if (!basePriority) continue;
    const urgency = filing.shipmentId ? (deadlineIndex.get(filing.shipmentId) ?? null) : null;
    const priority = applyUrgencyFloor(basePriority, urgency);
    const score = computeScore({ urgency, priority, blocking: false, assignedToMe: false });

    items.push({
      id: `filing:${filing.id}`,
      kind: "filing",
      title: `Entry ${filing.entryNumber}`,
      reason: `Filing status is ${filing.filingStatus}`,
      href: `/app/filing?filingId=${encodeURIComponent(filing.id)}`,
      priority,
      score,
      createdAt: filing.createdAt,
      shipmentNumber: filing.shipmentNumber,
      assignedToMe: false,
      filingDeadline: null,
      urgency,
    });
  }

  for (const document of input.documents) {
    const basePriority = DOCUMENT_ACTIONABLE[document.status];
    if (!basePriority) continue;
    const urgency = document.shipmentId ? (deadlineIndex.get(document.shipmentId) ?? null) : null;
    const priority = applyUrgencyFloor(basePriority, urgency);
    const score = computeScore({ urgency, priority, blocking: false, assignedToMe: false });

    items.push({
      id: `document:${document.id}`,
      kind: "document",
      title: document.fileName,
      reason: `Document status is ${document.status}`,
      href: document.shipmentId
        ? `/app/shipments/${document.shipmentId}`
        : "/app/documents",
      priority,
      score,
      createdAt: document.createdAt,
      shipmentNumber: document.shipmentNumber,
      assignedToMe: false,
      filingDeadline: null,
      urgency,
    });
  }

  for (const exception of input.exceptions ?? []) {
    const state = normalizeExceptionStatus(exception.status);
    if (!state || isTerminalExceptionState(state)) continue;
    const assignedToMe = exception.assignedToUserId === input.userId;
    const urgency = exception.shipmentId ? (deadlineIndex.get(exception.shipmentId) ?? null) : null;
    const base = applyUrgencyFloor(
      applyDeadlineUrgency(EXCEPTION_SEVERITY[exception.severity] ?? "normal", exception.filingDeadline, now),
      urgency
    );
    const priority = assignedToMe ? raise(base) : base;
    const score = computeScore({ urgency, priority, blocking: false, assignedToMe });

    items.push({
      id: `exception:${exception.id}`,
      kind: "exception",
      title: exception.type.replace(/_/g, " "),
      reason: exception.description,
      href: `/app/actions?exceptionId=${encodeURIComponent(exception.id)}`,
      priority,
      score,
      createdAt: exception.createdAt,
      shipmentNumber: exception.shipmentNumber,
      assignedToMe,
      filingDeadline: exception.filingDeadline ?? null,
      urgency,
    });
  }

  // Sort by score descending (higher = more urgent), with assigned-to-me as the
  // tiebreaker at the very top, then oldest-first within the same score.
  return items.sort((a, b) => {
    if (a.assignedToMe !== b.assignedToMe) return a.assignedToMe ? -1 : 1;
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    // Same effective score: surface the oldest waiting item first.
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function countByPriority(items: WorkItem[]): Record<WorkPriority, number> {
  const counts: Record<WorkPriority, number> = { critical: 0, high: 0, normal: 0 };
  for (const item of items) {
    counts[item.priority] += 1;
  }
  return counts;
}

export function countByKind(items: WorkItem[]): Record<WorkItemKind, number> {
  const counts: Record<WorkItemKind, number> = {
    decision: 0,
    finding: 0,
    filing: 0,
    document: 0,
    exception: 0,
  };
  for (const item of items) {
    counts[item.kind] += 1;
  }
  return counts;
}

/**
 * The statuses each source is filtered on. Loading every row and discarding the
 * inactionable ones in memory meant the row cap was spent on records the queue
 * was never going to show.
 *
 * DECISION_ACTIONABLE_STATUSES now covers every legacy status string that maps
 * to NEEDS_REVIEW or BLOCKED — the full set any agent has ever written.
 */
export const DECISION_ACTIONABLE_STATUSES = actionableStatusVariants();
export const FINDING_ACTIONABLE_STATUSES = [...FINDING_ACTIONABLE];
export const FILING_ACTIONABLE_STATUSES = Object.keys(FILING_ACTIONABLE);
export const DOCUMENT_ACTIONABLE_STATUSES = Object.keys(DOCUMENT_ACTIONABLE);
export const EXCEPTION_ACTIONABLE_STATUSES = openStatusVariants();

export function decisionPriority(status: string, proposedDescription?: string | null): WorkPriority | null {
  const triage = triageDecision({ status, proposedDescription });
  if (triage === "verified") return null;
  return triage === "blocked" ? "critical" : "high";
}

export function exceptionPriority(severity: string): WorkPriority {
  return EXCEPTION_SEVERITY[severity] ?? "normal";
}

export const WORK_KINDS: readonly WorkItemKind[] = [
  "decision",
  "finding",
  "filing",
  "document",
  "exception",
];

export { timePressure };
export const WORK_PRIORITIES: readonly WorkPriority[] = ["critical", "high", "normal"];

export interface WorkFilter {
  kind: WorkItemKind | null;
  priority: WorkPriority | null;
  assignedToMe: boolean;
  page: number;
  pageSize: number;
}

export const WORK_PAGE_SIZE = 25;
const WORK_PAGE_SIZE_MAX = 100;

function pageNumber(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function parseWorkFilter(params: URLSearchParams): WorkFilter {
  const kind = params.get("kind");
  const priority = params.get("priority");

  return {
    kind: WORK_KINDS.find((k) => k === kind) ?? null,
    priority: WORK_PRIORITIES.find((p) => p === priority) ?? null,
    assignedToMe: params.get("mine") === "1",
    page: pageNumber(params.get("page"), 1, Number.MAX_SAFE_INTEGER),
    pageSize: pageNumber(params.get("pageSize"), WORK_PAGE_SIZE, WORK_PAGE_SIZE_MAX),
  };
}

export function filterWorkQueue(items: WorkItem[], filter: WorkFilter): WorkItem[] {
  return items.filter((item) => {
    if (filter.kind && item.kind !== filter.kind) return false;
    if (filter.priority && item.priority !== filter.priority) return false;
    if (filter.assignedToMe && !item.assignedToMe) return false;
    return true;
  });
}

export function paginateWorkQueue(items: WorkItem[], filter: WorkFilter): WorkItem[] {
  const start = (filter.page - 1) * filter.pageSize;
  return items.slice(start, start + filter.pageSize);
}

export interface SourceLoad {
  loaded: number;
  matching: number;
}

/**
 * Names the sources whose row cap was reached. Without this the queue would
 * report a total it derived from a truncated read as if it were the account's.
 */
export function truncatedSources(loads: Partial<Record<WorkItemKind, SourceLoad>>): WorkItemKind[] {
  return WORK_KINDS.filter((kind) => {
    const load = loads[kind];
    return load !== undefined && load.matching > load.loaded;
  });
}
