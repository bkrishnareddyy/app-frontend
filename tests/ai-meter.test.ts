import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Metering an agent's model call.
 *
 * The whole point of this module is that it is inert: it reads what a call already
 * returned and writes a number down. These tests hold the promise that an agent
 * behaves identically whether or not metering is in place — it cannot refuse,
 * cannot throw, and cannot alter the response.
 */

const recordAiTokens = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ai/aiQuota", () => ({ recordAiTokens }));

const { meterGeminiCall } = await import("@/lib/ai/aiMeter");
const { readGeminiUsage } = await import("@/lib/ai/geminiUsage");

const ACCOUNT = "acct_alpha";

beforeEach(() => {
  recordAiTokens.mockClear();
  recordAiTokens.mockResolvedValue(undefined);
});

describe("readGeminiUsage", () => {
  it("bills thinking tokens as output", () => {
    // thoughtsTokenCount is billed as output where the model produces it.
    // Dropping it would under-report the cost, which is worse than a number that
    // needs explaining.
    expect(
      readGeminiUsage({
        promptTokenCount: 1200,
        candidatesTokenCount: 300,
        thoughtsTokenCount: 90,
        totalTokenCount: 1590,
      })
    ).toEqual({ inputTokens: 1200, outputTokens: 390, totalTokens: 1590 });
  });

  it("reports nothing rather than zero when the provider is silent", () => {
    // "Not reported" and "cost nothing" are different facts and stay
    // distinguishable all the way into telemetry.
    expect(readGeminiUsage(undefined)).toBeNull();
    expect(readGeminiUsage(null)).toBeNull();
    expect(readGeminiUsage({})).toBeNull();
    expect(readGeminiUsage("1200 tokens")).toBeNull();
    expect(readGeminiUsage({ promptTokenCount: "1200" })).toBeNull();
  });

  it("keeps a partial report partial", () => {
    expect(readGeminiUsage({ promptTokenCount: 500 })).toEqual({
      inputTokens: 500,
      outputTokens: null,
      totalTokens: null,
    });
  });

  it("ignores a non-finite count", () => {
    expect(readGeminiUsage({ promptTokenCount: Number.NaN, candidatesTokenCount: 7 })).toEqual({
      inputTokens: null,
      outputTokens: 7,
      totalTokens: null,
    });
  });
});

describe("meterGeminiCall", () => {
  it("records the usage attached to the response", async () => {
    await meterGeminiCall(
      "hts-classification",
      { accountId: ACCOUNT, userId: "user_1" },
      { text: "{}", usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 120 } }
    );

    expect(recordAiTokens).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      userId: "user_1",
      surface: "hts-classification",
      inputTokens: 800,
      outputTokens: 120,
    });
  });

  it("attributes a run with no user to the system", async () => {
    // A cron-triggered classification has no user. Inventing one would put spend
    // on a person who was asleep.
    await meterGeminiCall(
      "document-intelligence",
      { accountId: ACCOUNT, userId: null },
      { usageMetadata: { promptTokenCount: 10 } }
    );

    expect(recordAiTokens.mock.calls[0][0].userId).toBe("system");
  });

  it("does not meter a call with no account", async () => {
    // A platform-level run belongs to no tenant. Not metering it is correct;
    // attributing it to an arbitrary account would not be.
    await meterGeminiCall("normalization", { accountId: null }, { usageMetadata: {} });
    await meterGeminiCall("normalization", { accountId: undefined }, { usageMetadata: {} });
    await meterGeminiCall("normalization", { accountId: "" }, { usageMetadata: {} });

    expect(recordAiTokens).not.toHaveBeenCalled();
  });

  it("records a call the provider reported no usage for", async () => {
    await meterGeminiCall("compliance-audit", { accountId: ACCOUNT, userId: "user_1" }, { text: "{}" });

    expect(recordAiTokens).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: null, outputTokens: null })
    );
  });

  it("never rejects, even if the recorder does", async () => {
    // The guarantee the agents rely on, held locally rather than borrowed from
    // recordAiTokens. An agent must classify identically whether or not the usage
    // table exists.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recordAiTokens.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      meterGeminiCall(
        "hts-classification",
        { accountId: ACCOUNT, userId: "user_1" },
        { usageMetadata: { promptTokenCount: 1 } }
      )
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("survives a response of a shape it did not expect", async () => {
    // The agents hold the provider's own objects and this must not constrain
    // them. Anything unreadable is a call with unknown cost, not a failure.
    for (const response of [null, undefined, "text", 42, []]) {
      await expect(
        meterGeminiCall("product-intelligence", { accountId: ACCOUNT, userId: "u" }, response)
      ).resolves.toBeUndefined();
    }
    expect(recordAiTokens).toHaveBeenCalledTimes(5);
  });
});
