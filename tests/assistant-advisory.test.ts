import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/auth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...mod,
    getAccountContext: vi.fn().mockResolvedValue({
      accountId: "acc-test-123",
      userId: "usr-test-123",
      roles: ["ADMIN"],
      roleNames: ["ADMIN"],
      permissions: ["ai.use"],
    }),
    hasPermission: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    regulatoryUpdate: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { POST } from "@/app/api/advisory/query/route";

describe("Advisory Query Route Unit Tests", () => {
  const origAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const origGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = origAnthropicKey;
    process.env.GEMINI_API_KEY = origGeminiKey;
  });

  it("returns 400 when query prompt is missing or empty", async () => {
    const req = new Request("http://localhost/api/advisory/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });

    const res = await POST(req, { params: Promise.resolve({}) } as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Query prompt is required");
  });

  it("returns unconfigured message when no AI provider keys are present without returning fake mock boilerplate", async () => {
    const req = new Request("http://localhost/api/advisory/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "What are Section 301 tariffs?" }),
    });

    const res = await POST(req, { params: Promise.resolve({}) } as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answer).toContain("No AI provider is configured for advisory queries");
    expect(data.citations).toEqual([]);
  });
});
