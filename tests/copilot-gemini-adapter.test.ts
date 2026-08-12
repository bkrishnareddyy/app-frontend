/**
 * Gemini adapter: the provider details that only exist here.
 *
 * The thought-signature tests exist because of a real failure. Gemini's thinking
 * models attach a `thoughtSignature` to each functionCall part and reject the next
 * request in the turn if it comes back without one:
 *
 *   400 INVALID_ARGUMENT — Function call is missing a thought_signature in
 *   functionCall parts.
 *
 * The first version of this adapter read tool calls from `response.functionCalls`,
 * which drops the signature. Round one worked, the tool ran, and round two died —
 * so every multi-round question failed while every single-round question passed.
 * These tests pin the shape rather than the symptom.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const generateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  FunctionCallingConfigMode: { AUTO: "AUTO", ANY: "ANY" },
}));

import { createGeminiCopilotModel } from "@/modules/copilot/providers/geminiCopilotModel";
import type { CopilotModelContent } from "@/modules/copilot/copilotModel";
import { CopilotModelError } from "@/modules/copilot/copilotModel";
import type { AnyCopilotTool } from "@/modules/copilot/copilotToolTypes";

const config = {
  provider: "google-genai",
  model: "gemini-3.6-flash",
  temperature: 0.1,
  maxOutputTokens: 2048,
};

const tool = {
  name: "searchProducts",
  description: "Search products.",
  parameters: { type: "OBJECT", properties: {} },
} as unknown as AnyCopilotTool;

/** A response shaped like the SDK's, with signatures where Gemini puts them. */
function planResponse(parts: unknown[]) {
  return {
    candidates: [{ content: { parts } }],
    text: "",
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  };
}

function lastRequest() {
  return generateContent.mock.calls.at(-1)![0] as {
    contents: { role: string; parts: Record<string, unknown>[] }[];
    config: Record<string, unknown>;
  };
}

beforeEach(() => {
  generateContent.mockReset();
});

describe("reading tool calls", () => {
  it("captures the thought signature that sits beside the call", async () => {
    generateContent.mockResolvedValue(
      planResponse([
        {
          functionCall: { id: "call_1", name: "searchProducts", args: { query: "brake" } },
          thoughtSignature: "OPAQUE_SIG",
        },
      ])
    );

    const result = await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [{ role: "user", text: "q" }],
      tools: [tool],
    });

    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        name: "searchProducts",
        args: { query: "brake" },
        providerSignature: "OPAQUE_SIG",
      },
    ]);
  });

  it("reads parts, not the functionCalls accessor that drops signatures", async () => {
    // A response where the accessor and the parts disagree: only a reader that
    // goes through parts can come back with the signature.
    generateContent.mockResolvedValue({
      ...planResponse([
        { functionCall: { name: "searchProducts", args: {} }, thoughtSignature: "FROM_PARTS" },
      ]),
      functionCalls: [{ name: "searchProducts", args: {} }],
    });

    const result = await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [],
      tools: [tool],
    });

    expect(result.toolCalls[0]?.providerSignature).toBe("FROM_PARTS");
  });

  it("keeps parallel calls in order with the signature on the call that had it", async () => {
    // Gemini attaches one signature to the first part when calls are parallel.
    generateContent.mockResolvedValue(
      planResponse([
        { functionCall: { name: "searchProducts", args: {} }, thoughtSignature: "SIG_A" },
        { functionCall: { name: "listExceptions", args: {} } },
      ])
    );

    const result = await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [],
      tools: [tool],
    });

    expect(result.toolCalls.map((c) => [c.name, c.providerSignature])).toEqual([
      ["searchProducts", "SIG_A"],
      ["listExceptions", null],
    ]);
  });

  it("ignores text parts and parts without a usable call name", async () => {
    generateContent.mockResolvedValue(
      planResponse([
        { text: "thinking out loud" },
        { functionCall: { name: "", args: {} } },
        { functionCall: { args: {} } },
        { functionCall: { name: "searchProducts", args: {} } },
      ])
    );

    const result = await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [],
      tools: [tool],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("searchProducts");
  });

  it("normalises a missing or non-object argument bag to an empty one", async () => {
    generateContent.mockResolvedValue(
      planResponse([
        { functionCall: { name: "searchProducts" } },
        { functionCall: { name: "listExceptions", args: ["not", "an", "object"] } },
      ])
    );

    const result = await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [],
      tools: [tool],
    });

    expect(result.toolCalls.map((c) => c.args)).toEqual([{}, {}]);
  });

  it("returns no calls when the response carries no candidate parts", async () => {
    generateContent.mockResolvedValue({ candidates: [], text: "no lookup needed" });

    const result = await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [],
      tools: [tool],
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.text).toBe("no lookup needed");
  });
});

describe("sending tool calls back", () => {
  const callsContent = (providerSignature: string | null): CopilotModelContent => ({
    role: "toolCalls",
    calls: [{ id: "call_1", name: "searchProducts", args: { query: "brake" }, providerSignature }],
  });

  it("echoes the signature on the same part as the call", async () => {
    generateContent.mockResolvedValue(planResponse([]));

    await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [{ role: "user", text: "q" }, callsContent("OPAQUE_SIG")],
      tools: [tool],
    });

    const modelTurn = lastRequest().contents.find((c) => c.role === "model")!;
    expect(modelTurn.parts[0]).toEqual({
      functionCall: { name: "searchProducts", args: { query: "brake" }, id: "call_1" },
      thoughtSignature: "OPAQUE_SIG",
    });
  });

  it("omits the key entirely when there is no signature", async () => {
    generateContent.mockResolvedValue(planResponse([]));

    await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [callsContent(null)],
      tools: [tool],
    });

    const modelTurn = lastRequest().contents.find((c) => c.role === "model")!;
    // Not `thoughtSignature: null` — an explicit null is a value the provider
    // would have to interpret, and it has no reason to accept one.
    expect(Object.keys(modelTurn.parts[0])).toEqual(["functionCall"]);
  });

  it("preserves signature-to-call pairing across parallel calls", async () => {
    generateContent.mockResolvedValue(planResponse([]));

    await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [
        {
          role: "toolCalls",
          calls: [
            { id: "a", name: "searchProducts", args: {}, providerSignature: "SIG_A" },
            { id: "b", name: "listExceptions", args: {}, providerSignature: null },
          ],
        },
      ],
      tools: [tool],
    });

    const modelTurn = lastRequest().contents.find((c) => c.role === "model")!;
    expect(modelTurn.parts.map((p) => Object.keys(p))).toEqual([
      ["functionCall", "thoughtSignature"],
      ["functionCall"],
    ]);
  });

  it("survives a call object from before the field existed", async () => {
    generateContent.mockResolvedValue(planResponse([]));

    await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      // No providerSignature key at all, not even null.
      contents: [{ role: "toolCalls", calls: [{ id: "a", name: "searchProducts", args: {} }] }],
      tools: [tool],
    });

    const modelTurn = lastRequest().contents.find((c) => c.role === "model")!;
    expect(Object.keys(modelTurn.parts[0])).toEqual(["functionCall"]);
  });

  it("sends tool results as function responses, and as user text without an id", async () => {
    generateContent.mockResolvedValue(planResponse([]));

    await createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [
        {
          role: "toolResults",
          results: [
            { id: "call_1", name: "searchProducts", payload: { ok: true } },
            { id: null, name: "listExceptions", payload: { ok: false } },
          ],
        },
      ],
      tools: [tool],
    });

    const userTurn = lastRequest().contents.find((c) => c.role === "user")!;
    expect(userTurn.parts).toEqual([
      { functionResponse: { name: "searchProducts", response: { ok: true }, id: "call_1" } },
      { functionResponse: { name: "listExceptions", response: { ok: false } } },
    ]);
  });
});

describe("request shape", () => {
  it("offers tools in AUTO mode on the planning call", async () => {
    generateContent.mockResolvedValue(planResponse([]));

    await createGeminiCopilotModel(config).plan({
      systemPrompt: "system",
      contents: [],
      tools: [tool],
    });

    const { config: sent } = lastRequest();
    expect(sent.systemInstruction).toBe("system");
    expect(sent.temperature).toBe(0.1);
    expect(sent.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });
    expect(sent.responseSchema).toBeUndefined();
  });

  it("offers no tools on the composing call, and constrains the output to JSON", async () => {
    generateContent.mockResolvedValue({ text: '{"status":"ANSWERED"}', usageMetadata: {} });

    await createGeminiCopilotModel(config).compose({
      systemPrompt: "system",
      contents: [],
      responseSchema: { type: "OBJECT" } as never,
    });

    const { config: sent } = lastRequest();
    expect(sent.tools).toBeUndefined();
    expect(sent.toolConfig).toBeUndefined();
    expect(sent.responseMimeType).toBe("application/json");
    expect(sent.responseSchema).toEqual({ type: "OBJECT" });
  });
});

describe("failures", () => {
  it("wraps a provider rejection and keeps the cause for the server log", async () => {
    const apiError = Object.assign(new Error("missing a thought_signature"), {
      name: "ApiError",
      status: 400,
    });
    generateContent.mockRejectedValue(apiError);

    const promise = createGeminiCopilotModel(config).plan({
      systemPrompt: "s",
      contents: [],
      tools: [tool],
    });

    await expect(promise).rejects.toBeInstanceOf(CopilotModelError);
    await expect(promise).rejects.toMatchObject({ cause: apiError });
  });

  it("treats an empty composition as a failure rather than an empty answer", async () => {
    generateContent.mockResolvedValue({ text: "   ", usageMetadata: {} });

    await expect(
      createGeminiCopilotModel(config).compose({
        systemPrompt: "s",
        contents: [],
        responseSchema: { type: "OBJECT" } as never,
      })
    ).rejects.toBeInstanceOf(CopilotModelError);
  });
});
