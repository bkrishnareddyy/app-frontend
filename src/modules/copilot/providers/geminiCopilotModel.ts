/**
 * Gemini adapter.
 *
 * The only file in the Copilot that imports `@google/genai`. It reads the same
 * `GEMINI_API_KEY` the Product Intelligence and HTS Classification agents read,
 * so the platform has one model credential rather than two.
 *
 * Two provider details are handled here and nowhere else. Function declarations
 * are built from the registry's `parameters` schemas, and the composition call
 * asks for `application/json` against a response schema — which Gemini will not
 * accept in the same request as tools, and which is one of the reasons the
 * orchestration is split into a retrieval phase and an answering phase.
 */

import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type Part,
} from "@google/genai";
import { readGeminiUsage } from "@/lib/ai/geminiUsage";
import type { CopilotModelConfig } from "../copilotConfig";
import {
  CopilotModelError,
  type CopilotComposeRequest,
  type CopilotComposeResult,
  type CopilotModelClient,
  type CopilotModelContent,
  type CopilotModelToolCall,
  type CopilotPlanRequest,
  type CopilotPlanResult,
  type CopilotTokenUsage,
} from "../copilotModel";
import type { AnyCopilotTool } from "../copilotToolTypes";

function declarations(tools: readonly AnyCopilotTool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/**
 * Tool results are sent back as function responses where an id is available and
 * as a labelled user part otherwise. The fallback matters: a provider that
 * omits call ids must not silently drop the retrieved data, because an answer
 * composed without it would be an answer composed without evidence.
 */
function toContents(contents: CopilotModelContent[]): Content[] {
  const mapped: Content[] = [];

  for (const entry of contents) {
    switch (entry.role) {
      case "user":
        mapped.push({ role: "user", parts: [{ text: entry.text }] });
        break;
      case "assistant":
        mapped.push({ role: "model", parts: [{ text: entry.text }] });
        break;
      case "toolCalls": {
        // The thought signature goes back on the same part it arrived on, in the
        // same order. See readToolCalls for why omitting it is a hard failure.
        const parts: Part[] = entry.calls.map((call) => ({
          functionCall: { name: call.name, args: call.args, ...(call.id ? { id: call.id } : {}) },
          ...(call.providerSignature ? { thoughtSignature: call.providerSignature } : {}),
        }));
        if (parts.length > 0) mapped.push({ role: "model", parts });
        break;
      }
      case "toolResults": {
        const parts: Part[] = entry.results.map((result) => ({
          functionResponse: {
            name: result.name,
            response: result.payload,
            ...(result.id ? { id: result.id } : {}),
          },
        }));
        if (parts.length > 0) mapped.push({ role: "user", parts });
        break;
      }
    }
  }

  return mapped;
}

/**
 * Usage comes from the shared reader in `@/lib/ai/geminiUsage`, which the agents
 * meter with too. `CopilotTokenUsage` and `GeminiTokenUsage` are the same shape
 * on purpose — the Copilot keeps its own contract type, and this is the one place
 * the vendor's field names are translated into it.
 */
function readUsage(metadata: unknown): CopilotTokenUsage | null {
  return readGeminiUsage(metadata);
}

/**
 * Tool calls are read from the candidate parts rather than from the convenience
 * accessor `response.functionCalls`, because that accessor returns only
 * name/args/id and drops the `thoughtSignature` sitting beside the call on the
 * same part. Gemini's thinking models require it back on the next request:
 *
 *   400 INVALID_ARGUMENT — Function call is missing a thought_signature in
 *   functionCall parts.
 *
 * So the retrieval loop dies on its second round if the signature is lost, with
 * the tool result already in hand. Reading parts directly keeps the signature
 * paired with the call it belongs to, which matters because when the model emits
 * parallel calls only the first part carries one.
 */
function readToolCalls(parts: unknown): CopilotModelToolCall[] {
  if (!Array.isArray(parts)) return [];
  const result: CopilotModelToolCall[] = [];

  for (const part of parts) {
    const container = part as { functionCall?: unknown; thoughtSignature?: unknown };
    const call = container.functionCall as
      | { name?: unknown; args?: unknown; id?: unknown }
      | undefined;
    if (!call || typeof call.name !== "string" || call.name === "") continue;
    result.push({
      id: typeof call.id === "string" ? call.id : null,
      name: call.name,
      // An absent or non-object argument bag becomes an empty one, which the
      // tool's zod schema then rejects or accepts on its own terms.
      args:
        call.args && typeof call.args === "object" && !Array.isArray(call.args)
          ? (call.args as Record<string, unknown>)
          : {},
      providerSignature:
        typeof container.thoughtSignature === "string" ? container.thoughtSignature : null,
    });
  }

  return result;
}

export function createGeminiCopilotModel(config: CopilotModelConfig): CopilotModelClient {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

  return {
    provider: config.provider,
    model: config.model,

    async plan(request: CopilotPlanRequest): Promise<CopilotPlanResult> {
      try {
        const response = await client.models.generateContent({
          model: config.model,
          contents: toContents(request.contents),
          config: {
            systemInstruction: request.systemPrompt,
            temperature: config.temperature,
            maxOutputTokens: config.maxOutputTokens,
            abortSignal: request.signal,
            tools: [{ functionDeclarations: declarations(request.tools) }],
            toolConfig: {
              // AUTO, not ANY: a question that needs no lookup — "what can you
              // do?" — must be answerable without inventing a tool call.
              functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
            },
          },
        });

        return {
          toolCalls: readToolCalls(response.candidates?.[0]?.content?.parts),
          text: response.text ?? "",
          usage: readUsage(response.usageMetadata),
        };
      } catch (error) {
        throw new CopilotModelError("The Copilot model could not be reached.", error);
      }
    },

    async compose(request: CopilotComposeRequest): Promise<CopilotComposeResult> {
      try {
        const response = await client.models.generateContent({
          model: config.model,
          contents: toContents(request.contents),
          config: {
            systemInstruction: request.systemPrompt,
            temperature: config.temperature,
            maxOutputTokens: config.maxOutputTokens,
            abortSignal: request.signal,
            responseMimeType: "application/json",
            responseSchema: request.responseSchema,
          },
        });

        const text = response.text ?? "";
        if (text.trim() === "") {
          throw new CopilotModelError("The Copilot model returned an empty answer.");
        }
        return { text, usage: readUsage(response.usageMetadata) };
      } catch (error) {
        if (error instanceof CopilotModelError) throw error;
        throw new CopilotModelError("The Copilot model could not compose an answer.", error);
      }
    },
  };
}
