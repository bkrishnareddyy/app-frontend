import { describe, it, expect, vi } from "vitest";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { headers } from "next/headers";

vi.mock("@/lib/db", () => ({
  db: {
    auditLog: {
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: "audit-123",
        ...data,
        createdAt: new Date(),
      })),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

describe("Chat audit source resolution", () => {
  it("uses explicit params.source CHAT when provided", async () => {
    const result = await createAuditLog({
      accountId: "acc-1",
      userId: "usr-1",
      action: "decision.approved",
      entity: "AgentDecision",
      entityId: "dec-1",
      source: "CHAT",
    });

    expect(result).not.toBeNull();
    expect(result?.source).toBe("CHAT");
  });

  it("auto-detects x-qubere-source header CHAT when params.source is UI or omitted", async () => {
    const headersMap = new Map([["x-qubere-source", "CHAT"]]);
    vi.mocked(headers).mockResolvedValue(headersMap as any);

    const result = await createAuditLog({
      accountId: "acc-1",
      userId: "usr-1",
      action: "decision.approved",
      entity: "AgentDecision",
      entityId: "dec-1",
      source: "UI",
    });

    expect(result).not.toBeNull();
    expect(result?.source).toBe("CHAT");
  });

  it("defaults to UI when no header or explicit CHAT source is present", async () => {
    vi.mocked(headers).mockResolvedValue(new Map() as any);

    const result = await createAuditLog({
      accountId: "acc-1",
      userId: "usr-1",
      action: "decision.approved",
      entity: "AgentDecision",
      entityId: "dec-1",
    });

    expect(result).not.toBeNull();
    expect(result?.source).toBe("UI");
  });
});
