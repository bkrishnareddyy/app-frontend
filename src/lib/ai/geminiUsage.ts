/**
 * Reading token usage off a Gemini response.
 *
 * Shared by the Copilot adapter and by every agent that meters a call, because
 * the field names belong to the vendor and not to us. Two copies of this would
 * drift the first time a field is renamed, and the failure would be silent — a
 * bill that stops being counted looks exactly like a bill that stopped.
 */

/**
 * What a model call cost. Null means the provider reported nothing, which is not
 * the same as zero and is kept distinguishable all the way into telemetry.
 */
export interface GeminiTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Usage as Gemini reports it. `thoughtsTokenCount` is billed as output where the
 * model produces it, so it is added to the output count rather than dropped —
 * under-reporting cost is worse than reporting a number that needs explaining.
 *
 * Takes `unknown` deliberately: this is parsing a payload from outside the
 * process, and a response with no `usageMetadata` at all is a normal case rather
 * than an error.
 */
export function readGeminiUsage(metadata: unknown): GeminiTokenUsage | null {
  if (!metadata || typeof metadata !== "object") return null;
  const source = metadata as {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
    totalTokenCount?: unknown;
  };

  const input = count(source.promptTokenCount);
  const candidates = count(source.candidatesTokenCount);
  const thoughts = count(source.thoughtsTokenCount);
  const output =
    candidates === null && thoughts === null ? null : (candidates ?? 0) + (thoughts ?? 0);
  const total = count(source.totalTokenCount);

  if (input === null && output === null && total === null) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}
