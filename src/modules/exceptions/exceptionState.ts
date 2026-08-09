/**
 * Exception status vocabulary.
 *
 * Rows are created with "Open" (the schema default) while updates were writing
 * whatever casing the client sent, so the column has been holding two
 * vocabularies at once. Reads normalize; writes store the canonical form.
 */

export const EXCEPTION_STATES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_IMPORTER",
  "WAITING_FOR_DOCUMENT",
  "READY_FOR_REVIEW",
  "RESOLVED",
  "WAIVED",
  "CANCELLED",
] as const;

export type ExceptionState = (typeof EXCEPTION_STATES)[number];

/** States that close an exception, so nothing further is expected of a human. */
export const TERMINAL_EXCEPTION_STATES: readonly ExceptionState[] = [
  "RESOLVED",
  "WAIVED",
  "CANCELLED",
];

/**
 * Closing an exception is a compliance assertion, so it has to carry a stated
 * reason. Cancelling does not: it records that the exception should never have
 * been raised, not that the underlying problem was dealt with.
 */
export const REASONED_EXCEPTION_STATES: readonly ExceptionState[] = ["RESOLVED", "WAIVED"];

/** Separators are dropped so "IN_PROGRESS", "InProgress" and "in progress" all match. */
function collapse(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const BY_COLLAPSED = new Map(EXCEPTION_STATES.map((state) => [collapse(state), state]));

export function normalizeExceptionStatus(raw: string | null | undefined): ExceptionState | null {
  if (typeof raw !== "string") return null;
  return BY_COLLAPSED.get(collapse(raw)) ?? null;
}

export function isTerminalExceptionState(status: ExceptionState): boolean {
  return TERMINAL_EXCEPTION_STATES.includes(status);
}

export function requiresResolutionReason(status: ExceptionState): boolean {
  return REASONED_EXCEPTION_STATES.includes(status);
}

export const RISK_ACCEPTANCE_PERMISSION = "exceptions.waive";

/** Waiving closes the exception without the problem being fixed. */
export function isRiskAcceptance(status: ExceptionState): boolean {
  return status === "WAIVED";
}

/**
 * Every casing the column is known to hold for one state, so a filter can run
 * in the database rather than in memory.
 */
export function statusVariants(state: ExceptionState): string[] {
  const pascal = state
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join("");
  return pascal === state ? [state] : [state, pascal];
}

/** Statuses still awaiting a human, in every casing the column is known to hold. */
export function openStatusVariants(): string[] {
  const variants = new Set<string>();
  for (const state of EXCEPTION_STATES) {
    if (isTerminalExceptionState(state)) continue;
    for (const variant of statusVariants(state)) variants.add(variant);
  }
  return [...variants];
}

/** Shows the stored value verbatim when it is not one this build recognises. */
export function exceptionStatusLabel(raw: string | null | undefined): string {
  const state = normalizeExceptionStatus(raw);
  if (!state) return typeof raw === "string" && raw.trim() ? raw.trim() : "Unknown";
  return state
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}
