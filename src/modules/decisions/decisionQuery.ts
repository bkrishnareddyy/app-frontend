/**
 * Server-side query state for the decision review queue.
 *
 * The queue used to load every decision in the account, with each decision's
 * shipment, documents and line items, and then filter the result in the
 * browser. Filtering below the fold is filtering the operator cannot trust:
 * the count in the header described the page, not the queue.
 */

import { Prisma } from "@prisma/client";
import {
  buildOrderBy,
  parseTableQuery,
  tableSkip,
  type OrderBy,
  type SortSpec,
  type TableQuery,
} from "@/modules/tables/tableQuery";

export const DECISION_PAGE_SIZE_DEFAULT = 25;
export const DECISION_PAGE_SIZE_MAX = 100;

export const DECISION_SORT_COLUMNS = [
  "createdAt",
  "updatedAt",
  "agentName",
  "status",
  "confidence",
  "shipment.shipmentNumber",
] as const;

export type DecisionSortColumn = (typeof DECISION_SORT_COLUMNS)[number];

const DECISION_SORT_SPEC: SortSpec<DecisionSortColumn> = {
  columns: DECISION_SORT_COLUMNS,
  fallback: "createdAt",
  fallbackDirection: "desc",
};

/**
 * Confidence is the model's own score, not a legal certainty, and it is
 * nullable. "Unscored" is its own band so a decision the model never scored is
 * never quietly filed under low confidence.
 */
export const CONFIDENCE_BANDS = ["high", "medium", "low", "unscored"] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export const CONFIDENCE_BAND_LABEL: Record<ConfidenceBand, string> = {
  high: "Model confidence 85% and above",
  medium: "Model confidence 60-84%",
  low: "Model confidence below 60%",
  unscored: "No model confidence recorded",
};

export const AGE_BANDS = ["today", "week", "older"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const AGE_BAND_LABEL: Record<AgeBand, string> = {
  today: "Raised in the last 24 hours",
  week: "Raised in the last 7 days",
  older: "Waiting more than 7 days",
};

export interface DecisionQuery extends TableQuery<DecisionSortColumn> {
  status: string | null;
  agentName: string | null;
  shipmentId: string | null;
  reviewerId: string | null;
  confidence: ConfidenceBand | null;
  age: AgeBand | null;
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  if (raw === null) return null;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

function trimmed(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

export function parseDecisionQuery(params: URLSearchParams): DecisionQuery {
  const base = parseTableQuery(params, DECISION_SORT_SPEC, {
    pageSizeDefault: DECISION_PAGE_SIZE_DEFAULT,
    pageSizeMax: DECISION_PAGE_SIZE_MAX,
  });

  return {
    ...base,
    status: trimmed(params.get("status")),
    agentName: trimmed(params.get("agent")),
    shipmentId: trimmed(params.get("shipmentId")),
    reviewerId: trimmed(params.get("reviewer")),
    confidence: oneOf(params.get("confidence"), CONFIDENCE_BANDS),
    age: oneOf(params.get("age"), AGE_BANDS),
  };
}

export interface DecisionWhere {
  accountId: string;
  status?: string;
  agentName?: string;
  shipmentId?: string;
  reviewedByUserId?: string;
  confidence?: { gte?: number; lte?: number } | null;
  createdAt?: { gte?: Date; lt?: Date };
  OR?: Array<Record<string, unknown>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildDecisionWhere(
  query: DecisionQuery,
  accountId: string,
  now: Date = new Date()
): Prisma.AgentDecisionWhereInput {
  const where: DecisionWhere = { accountId };

  if (query.status) where.status = query.status;
  if (query.agentName) where.agentName = query.agentName;
  if (query.shipmentId) where.shipmentId = query.shipmentId;
  if (query.reviewerId) where.reviewedByUserId = query.reviewerId;

  if (query.confidence === "high") where.confidence = { gte: 85 };
  else if (query.confidence === "medium") where.confidence = { gte: 60, lte: 84 };
  else if (query.confidence === "low") where.confidence = { lte: 59 };
  else if (query.confidence === "unscored") where.confidence = null;

  if (query.age === "today") where.createdAt = { gte: new Date(now.getTime() - DAY_MS) };
  else if (query.age === "week") where.createdAt = { gte: new Date(now.getTime() - 7 * DAY_MS) };
  else if (query.age === "older") where.createdAt = { lt: new Date(now.getTime() - 7 * DAY_MS) };

  if (query.search) {
    const contains = { contains: query.search, mode: "insensitive" as const };
    where.OR = [
      { agentName: contains },
      { decisionSummary: contains },
      { proposedHtsCode: contains },
      { currentHtsCode: contains },
      { shipment: { shipmentNumber: contains } },
    ];
  }

  return where;
}

export function buildDecisionOrderBy(query: DecisionQuery): OrderBy {
  return buildOrderBy(query);
}

export function decisionSkip(query: DecisionQuery): number {
  return tableSkip(query);
}
