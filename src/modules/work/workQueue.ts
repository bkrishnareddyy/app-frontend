import {
  isTerminalExceptionState,
  normalizeExceptionStatus,
  openStatusVariants,
} from "@/modules/exceptions/exceptionState";

export type WorkItemKind = "decision" | "finding" | "filing" | "document" | "exception";
export type WorkPriority = "critical" | "high" | "normal";

export interface WorkItem {
  id: string;
  kind: WorkItemKind;
  title: string;
  reason: string;
  href: string;
  priority: WorkPriority;
  createdAt: Date;
  shipmentNumber: string | null;
  assignedToMe: boolean;
}

export interface DecisionRow {
  id: string;
  agentName: string;
  decisionSummary: string;
  status: string;
  createdAt: Date;
  shipmentId: string;
  shipmentNumber: string | null;
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
}

export interface DocumentRow {
  id: string;
  fileName: string;
  status: string;
  createdAt: Date;
  shipmentId: string;
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
}

export interface WorkQueueInput {
  userId: string;
  decisions: DecisionRow[];
  findings: FindingRow[];
  filings: FilingRow[];
  documents: DocumentRow[];
  exceptions?: ExceptionRow[];
}

const DECISION_ACTIONABLE: Record<string, WorkPriority> = {
  "Review Required": "high",
  Attention: "critical",
  Pending: "normal",
};

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

/**
 * Builds the queue from rows the caller has already scoped to its account.
 * Only statuses that genuinely await a human are included; nothing is inferred
 * for records whose status is unrecognised.
 */
export function buildWorkQueue(input: WorkQueueInput): WorkItem[] {
  const items: WorkItem[] = [];

  for (const decision of input.decisions) {
    const priority = DECISION_ACTIONABLE[decision.status];
    if (!priority) continue;
    items.push({
      id: `decision:${decision.id}`,
      kind: "decision",
      title: decision.agentName,
      reason: decision.decisionSummary,
      href: `/app/decisions?decisionId=${encodeURIComponent(decision.id)}`,
      priority,
      createdAt: decision.createdAt,
      shipmentNumber: decision.shipmentNumber,
      assignedToMe: false,
    });
  }

  for (const finding of input.findings) {
    if (!FINDING_ACTIONABLE.has(finding.status)) continue;
    const assignedToMe = finding.assignedToUserId === input.userId;
    const base = FINDING_SEVERITY[finding.severity] ?? "normal";
    items.push({
      id: `finding:${finding.id}`,
      kind: "finding",
      title: finding.rule,
      reason: `${finding.severity} compliance finding is ${finding.status.toLowerCase()}`,
      href: `/app/filing/${finding.filingId}`,
      priority: assignedToMe ? raise(base) : base,
      createdAt: finding.createdAt,
      shipmentNumber: null,
      assignedToMe,
    });
  }

  for (const filing of input.filings) {
    const priority = FILING_ACTIONABLE[filing.filingStatus];
    if (!priority) continue;
    items.push({
      id: `filing:${filing.id}`,
      kind: "filing",
      title: `Entry ${filing.entryNumber}`,
      reason: `Filing status is ${filing.filingStatus}`,
      href: `/app/filing/${filing.id}`,
      priority,
      createdAt: filing.createdAt,
      shipmentNumber: filing.shipmentNumber,
      assignedToMe: false,
    });
  }

  for (const document of input.documents) {
    const priority = DOCUMENT_ACTIONABLE[document.status];
    if (!priority) continue;
    items.push({
      id: `document:${document.id}`,
      kind: "document",
      title: document.fileName,
      reason: `Document status is ${document.status}`,
      href: `/app/shipments/${document.shipmentId}`,
      priority,
      createdAt: document.createdAt,
      shipmentNumber: document.shipmentNumber,
      assignedToMe: false,
    });
  }

  for (const exception of input.exceptions ?? []) {
    const state = normalizeExceptionStatus(exception.status);
    if (!state || isTerminalExceptionState(state)) continue;
    const assignedToMe = exception.assignedToUserId === input.userId;
    const base = EXCEPTION_SEVERITY[exception.severity] ?? "normal";
    items.push({
      id: `exception:${exception.id}`,
      kind: "exception",
      title: exception.type.replace(/_/g, " "),
      reason: exception.description,
      href: `/app/exceptions?exceptionId=${encodeURIComponent(exception.id)}`,
      priority: assignedToMe ? raise(base) : base,
      createdAt: exception.createdAt,
      shipmentNumber: exception.shipmentNumber,
      assignedToMe,
    });
  }

  return items.sort((a, b) => {
    if (a.assignedToMe !== b.assignedToMe) return a.assignedToMe ? -1 : 1;
    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rank !== 0) return rank;
    // Oldest first: the item that has been waiting longest is the most overdue.
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
 */
export const DECISION_ACTIONABLE_STATUSES = Object.keys(DECISION_ACTIONABLE);
export const FINDING_ACTIONABLE_STATUSES = [...FINDING_ACTIONABLE];
export const FILING_ACTIONABLE_STATUSES = Object.keys(FILING_ACTIONABLE);
export const DOCUMENT_ACTIONABLE_STATUSES = Object.keys(DOCUMENT_ACTIONABLE);
export const EXCEPTION_ACTIONABLE_STATUSES = openStatusVariants();

export const WORK_KINDS: readonly WorkItemKind[] = [
  "decision",
  "finding",
  "filing",
  "document",
  "exception",
];
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
