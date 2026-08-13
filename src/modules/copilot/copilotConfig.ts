/**
 * Copilot limits and model configuration.
 *
 * All of it is data, read once here rather than scattered through the
 * orchestration, so the cost and blast radius of a single question can be read
 * off one screen: at most N tool calls, each returning at most M rows, over at
 * most K prior turns, within T milliseconds.
 *
 * The model credential is the one the existing agents already use
 * (GEMINI_API_KEY), and the model itself is resolved by the shared per-surface
 * selector in `@/lib/ai/aiModel`, so the Copilot does not introduce a second way
 * to configure the same thing.
 */

import { aiModel } from "@/lib/ai/aiModel";

export interface CopilotModelConfig {
  provider: string;
  model: string;
  /** Low, deliberately: these are operational customs questions, not prose. */
  temperature: number;
  maxOutputTokens: number;
}

export interface CopilotRateLimits {
  /** Questions one user may ask inside a window. */
  perUser: number;
  /** Questions one account may ask inside a window, across all its users. */
  perAccount: number;
  windowMs: number;
}

/**
 * Sized for people, not for loops. A broker working hard asks a handful of
 * questions a minute; a runaway client or a scripted caller does not stop, and
 * each question costs two model calls and up to eight database reads.
 */
export const COPILOT_RATE_LIMITS: CopilotRateLimits = {
  perUser: 15,
  perAccount: 60,
  windowMs: 60_000,
};

export interface CopilotLimits {
  /** Model round-trips per question. Each may carry several tool calls. */
  maxToolIterations: number;
  /** Tool executions per question, across all iterations. */
  maxToolCalls: number;
  /** Rows any single search tool may return. */
  maxSearchResults: number;
  /** Characters any single tool result may contribute to the prompt. */
  maxToolResultChars: number;
  /** Prior turns replayed to the model. Older turns are dropped, not summarised. */
  maxHistoryTurns: number;
  /** Characters kept from any one replayed turn. */
  maxHistoryTurnChars: number;
  /** Wall-clock budget for the whole question, model and tools together. */
  requestTimeoutMs: number;
}

export const COPILOT_LIMITS: CopilotLimits = {
  maxToolIterations: 4,
  maxToolCalls: 8,
  maxSearchResults: 10,
  maxToolResultChars: 6000,
  maxHistoryTurns: 8,
  maxHistoryTurnChars: 1200,
  requestTimeoutMs: 45_000,
};

export function copilotModelConfig(env: NodeJS.ProcessEnv = process.env): CopilotModelConfig {
  return {
    provider: "google-genai",
    // Resolved by the shared per-surface selector, so the Copilot is configured
    // the same way every agent is: COPILOT_MODEL for this surface alone, then
    // AI_DEFAULT_MODEL for the platform. See @/lib/ai/aiModel.
    model: aiModel("copilot", env),
    temperature: 0.1,
    maxOutputTokens: 2048,
  };
}

/**
 * Whether a model can be reached at all. Checked before a question is accepted
 * so the panel reports "unavailable" rather than producing an answer from no
 * data — there is no ungrounded fallback path in the Copilot by design.
 */
export function copilotModelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

/**
 * The Copilot's own switch, separate from the model credential on purpose.
 *
 * `GEMINI_API_KEY` is shared with the classification, document intelligence and
 * product intelligence agents, so unsetting it to turn the Copilot off would
 * take those down too. This flag turns off the Copilot and nothing else — the
 * launcher disappears and the route answers honestly if called directly.
 *
 * Absent means on: an environment that has never heard of this variable behaves
 * as it did before it existed, and only an explicit value switches it off.
 */
export function copilotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.COPILOT_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  return !DISABLED_VALUES.has(raw);
}
