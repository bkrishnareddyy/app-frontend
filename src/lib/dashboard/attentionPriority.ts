// Deterministic "Requires Attention" ranking for the Command Center. No LLM,
// no learned weighting — every reason maps to one real, already-computed
// signal, and the priority is the max severity across the reasons that fired.

export type AttentionPriority = "CRITICAL" | "HIGH" | "NORMAL";

export interface AttentionInput {
  hasCriticalException: boolean;
  blockedDecisions: number;
  needsReviewDecisions: number;
  isOverdue: boolean;
  missingDocCount: number;
  /** Hours until the shipment's most urgent open compliance deadline, or null if none. */
  hoursUntilDeadline: number | null;
}

export interface AttentionResult {
  priority: AttentionPriority | null;
  reasons: string[];
}

/**
 * Returns null priority (not "NORMAL") when nothing at all fired, so callers
 * can drop the shipment from the attention queue entirely rather than padding
 * it with an empty-reasons NORMAL row.
 */
export function computeAttentionPriority(input: AttentionInput): AttentionResult {
  const critical: string[] = [];
  const high: string[] = [];

  if (input.hasCriticalException) critical.push("Critical compliance exception open");
  if (input.blockedDecisions > 0) {
    critical.push(
      `${input.blockedDecisions} agent decision${input.blockedDecisions > 1 ? "s" : ""} blocked`
    );
  }
  if (input.hoursUntilDeadline !== null) {
    if (input.hoursUntilDeadline < 0) critical.push("Compliance deadline missed");
    else if (input.hoursUntilDeadline <= 24) critical.push("Compliance deadline due within 24h");
    else if (input.hoursUntilDeadline <= 24 * 3) high.push("Compliance deadline due within 3 days");
  }
  if (input.isOverdue) high.push("Past ETA, not filed");
  if (input.missingDocCount > 0) {
    high.push(`${input.missingDocCount} required document${input.missingDocCount > 1 ? "s" : ""} missing`);
  }
  if (input.needsReviewDecisions > 0) {
    high.push(
      `${input.needsReviewDecisions} agent decision${input.needsReviewDecisions > 1 ? "s" : ""} awaiting review`
    );
  }

  const reasons = [...critical, ...high];
  if (reasons.length === 0) return { priority: null, reasons };

  return { priority: critical.length > 0 ? "CRITICAL" : "HIGH", reasons };
}
