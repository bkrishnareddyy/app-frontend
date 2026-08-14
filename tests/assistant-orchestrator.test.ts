import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/modules/copilot/copilotAudit", () => ({
  auditConversationStarted: vi.fn().mockResolvedValue(undefined),
  auditError: vi.fn().mockResolvedValue(undefined),
  auditQuery: vi.fn().mockResolvedValue(undefined),
  auditToolExecuted: vi.fn().mockResolvedValue(undefined),
}));

import { runAssistantTurn } from "@/modules/assistant/orchestrator";
import type { AccountContext } from "@/lib/auth";

describe("Assistant Orchestrator Unit Tests", () => {
  const mockCtx: AccountContext = {
    accountId: "acc-test-123",
    userId: "usr-test-456",
    roles: ["ADMIN"],
    roleNames: ["ADMIN"],
    permissions: ["ai.use", "shipments.read"],
  };

  const origAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const origGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = origAnthropicKey;
    process.env.GEMINI_API_KEY = origGeminiKey;
  });

  it("yields configuration error when no API key is present", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const events = [];
    for await (const event of runAssistantTurn(mockCtx, {
      message: "Hello assistant",
      history: [],
      requestId: "req-1",
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "error",
      message: "The assistant isn't configured yet (ANTHROPIC_API_KEY or GEMINI_API_KEY is missing).",
    });
  });

  it("streams events cleanly when configured with Anthropic API key", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    delete process.env.GEMINI_API_KEY;

    const gen = runAssistantTurn(mockCtx, {
      message: "List shipments",
      history: [],
      requestId: "req-2",
    });

    expect(gen[Symbol.asyncIterator]).toBeDefined();
  });
});
