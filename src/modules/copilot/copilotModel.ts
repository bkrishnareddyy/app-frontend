/**
 * The provider boundary.
 *
 * Nothing above this file knows which model vendor is in use. The orchestrator
 * asks for a plan and then for a composition; a provider adapter decides how
 * those become HTTP calls. Swapping Gemini for another provider means writing
 * one adapter and changing one line in `createCopilotModel`.
 *
 * The two-phase split is deliberate and is not just a provider workaround.
 *
 *   - `plan` is the retrieval phase. The model may call tools; its prose in this
 *     phase is working-out, and the orchestrator discards it. Nothing from it is
 *     stored, streamed or shown, which is how "do not expose or store hidden
 *     reasoning" is satisfied structurally rather than by asking the model
 *     nicely.
 *   - `compose` is the answering phase. No tools are offered, so no data can be
 *     fetched at the moment of writing, and the output is constrained to the
 *     answer schema. The model is writing *about* retrieved facts, not
 *     retrieving.
 */

import type { Schema } from "@google/genai";
import type { AnyCopilotTool } from "./copilotToolTypes";
import type { CopilotModelConfig } from "./copilotConfig";
import { copilotModelConfig } from "./copilotConfig";
import { createGeminiCopilotModel } from "./providers/geminiCopilotModel";

/** A tool call the model asked for. Names and arguments are still untrusted. */
export interface CopilotModelToolCall {
  id: string | null;
  name: string;
  args: Record<string, unknown>;
  /**
   * An opaque provider continuation token that must be echoed back verbatim on
   * the next request in the same turn. Meaningless above this boundary: nothing
   * outside the adapter reads it, and no code branches on it.
   *
   * Gemini's thinking models return one alongside each function call and reject
   * the follow-up request if it is missing. It is an opaque blob, not reasoning
   * text, and it is not stored: it lives in the in-memory transcript for one
   * turn, is never persisted, audited, logged, or returned to the browser.
   */
  providerSignature?: string | null;
}

/** One entry in the transcript handed to the model, in provider-neutral form. */
export type CopilotModelContent =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "toolCalls"; calls: CopilotModelToolCall[] }
  | {
      role: "toolResults";
      results: { id: string | null; name: string; payload: Record<string, unknown> }[];
    };

export interface CopilotPlanRequest {
  systemPrompt: string;
  contents: CopilotModelContent[];
  tools: readonly AnyCopilotTool[];
  signal?: AbortSignal;
}

/**
 * What one model call cost, as the provider reported it.
 *
 * Every field is nullable because this is the provider's word, not ours: an
 * adapter that cannot report usage must say so rather than report zero, which
 * would read as "this call was free" in the telemetry.
 */
export interface CopilotTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface CopilotPlanResult {
  toolCalls: CopilotModelToolCall[];
  /** Working-out. Never surfaced, never persisted; kept only for the transcript. */
  text: string;
  usage: CopilotTokenUsage | null;
}

export interface CopilotComposeRequest {
  systemPrompt: string;
  contents: CopilotModelContent[];
  responseSchema: Schema;
  signal?: AbortSignal;
}

export interface CopilotComposeResult {
  /** Raw JSON text, still to be validated against the Qubere answer schema. */
  text: string;
  usage: CopilotTokenUsage | null;
}

export interface CopilotModelClient {
  readonly provider: string;
  readonly model: string;
  plan(request: CopilotPlanRequest): Promise<CopilotPlanResult>;
  compose(request: CopilotComposeRequest): Promise<CopilotComposeResult>;
}

/** Raised for provider failures, so the orchestrator can answer ERROR cleanly. */
export class CopilotModelError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "CopilotModelError";
  }
}

export function createCopilotModel(
  config: CopilotModelConfig = copilotModelConfig()
): CopilotModelClient {
  switch (config.provider) {
    case "google-genai":
      return createGeminiCopilotModel(config);
    default:
      throw new CopilotModelError(`No Copilot adapter for provider "${config.provider}".`);
  }
}
