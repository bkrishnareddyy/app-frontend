import { createHash } from "crypto";

/**
 * A stable, short fingerprint of the exact prompt text sent to the model.
 *
 * Prompt templates are edited in place inside each agent's source file over
 * time. Without recording this hash alongside the resulting AgentDecision,
 * a decision made months ago has no durable link to the wording that
 * actually produced it once the surrounding code has since changed --
 * only today's prompt is ever visible in the repo.
 *
 * Hashed rather than stored verbatim: the full prompt can run to several KB
 * per call and usually embeds request-specific data (line item text,
 * extracted fields), so storing it raw would bloat AgentDecision rows and
 * still not diff cleanly between two runs of the "same" template. The hash
 * lets two decisions be compared for "same prompt wording" without that cost.
 */
export function hashPromptVersion(promptText: string): string {
  return createHash("sha256").update(promptText).digest("hex").slice(0, 16);
}
