import { db } from "@/lib/db";

type Operator = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in";

interface Condition {
  field: string;
  operator: Operator;
  value: unknown;
}

function resolveField(event: Record<string, unknown>, field: string): unknown {
  const parts = field.split(".");
  let current: unknown = event;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function applyOperator(actual: unknown, op: Operator, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
  }
}

export type ConditionResult =
  | { matched: true }
  | { matched: false }
  | { fieldMissing: true; field: string };

/**
 * Evaluates a rate rule's conditions JSON against a flattened usage event view.
 * Returns fieldMissing when the condition references a field not present on the
 * event — callers must treat this as a BillingException, not a silent skip.
 */
export function evaluateRateRuleCondition(
  conditions: unknown,
  eventView: Record<string, unknown>
): ConditionResult {
  if (conditions == null) return { matched: true };

  const list: Condition[] = Array.isArray(conditions)
    ? (conditions as Condition[])
    : [conditions as Condition];

  for (const cond of list) {
    const actual = resolveField(eventView, cond.field);
    if (actual === undefined) {
      return { fieldMissing: true, field: cond.field };
    }
    if (!applyOperator(actual, cond.operator, cond.value)) {
      return { matched: false };
    }
  }
  return { matched: true };
}

/**
 * Builds the flat event view used by condition evaluation from a usage event row.
 * Top-level fields are available as-is; metadata sub-fields are addressable as
 * "metadata.<key>" (e.g. "metadata.confidence").
 */
export async function buildConditionEventView(usageEventId: string): Promise<Record<string, unknown> | null> {
  const event = await db.usageEvent.findUnique({ where: { id: usageEventId } });
  if (!event) return null;
  const metadata = (event.metadata as Record<string, unknown>) ?? {};
  return {
    eventCode: event.eventCode,
    quantity: Number(event.quantity),
    success: event.success,
    automated: event.automated,
    processingDuration: event.processingDuration,
    clientId: event.clientId,
    importerId: event.importerId,
    shipmentId: event.shipmentId,
    metadata,
  };
}
