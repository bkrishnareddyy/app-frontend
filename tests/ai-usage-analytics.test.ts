import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The platform-admin "Agents" analytics screen reads two existing tables and
 * invents no new numbers. These tests hold the shape of that reduction:
 *
 *   - every known AI surface appears even with zero usage, so an operator sees
 *     what is metered, not just what happened to run;
 *   - the daily series has no gaps — a day with no calls is a zero, not a
 *     missing point that would make a chart lie by omission;
 *   - Copilot status/tool figures come only from what the audit trail actually
 *     recorded, and the "sampled" flag tells the truth about the query being a
 *     bounded slice, not a full aggregate.
 */

const dbMock = {
  aiUsageWindow: { groupBy: vi.fn() },
  account: { findMany: vi.fn() },
  auditLog: { findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { getAiUsageAnalytics } = await import("@/lib/ai/aiUsageAnalytics");
const { AI_SURFACES } = await import("@/lib/ai/aiQuota");

beforeEach(() => {
  vi.restoreAllMocks();
  dbMock.aiUsageWindow.groupBy.mockReset();
  dbMock.account.findMany.mockReset();
  dbMock.auditLog.findMany.mockReset();
  dbMock.aiUsageWindow.groupBy.mockResolvedValue([]);
  dbMock.account.findMany.mockResolvedValue([]);
  dbMock.auditLog.findMany.mockResolvedValue([]);
});

describe("getAiUsageAnalytics", () => {
  it("lists every known surface, including ones with no recorded usage", async () => {
    dbMock.aiUsageWindow.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
      if (by[0] === "surface") {
        return [{ surface: "copilot", _sum: { requests: 12, inputTokens: BigInt(400), outputTokens: BigInt(100) } }];
      }
      return [];
    });

    const result = await getAiUsageAnalytics(7);

    expect(result.bySurface).toHaveLength(AI_SURFACES.length);
    const copilot = result.bySurface.find((s) => s.surface === "copilot");
    expect(copilot).toMatchObject({ requests: 12, inputTokens: 400, outputTokens: 100, totalTokens: 500 });

    const untouched = result.bySurface.find((s) => s.surface === "normalization");
    expect(untouched).toMatchObject({ requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it("fills every day in the range with zero when a day has no usage row", async () => {
    dbMock.aiUsageWindow.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
      if (by[0] === "windowStart") {
        return [
          {
            windowStart: new Date(Date.UTC(2026, 7, 12)),
            _sum: { requests: 5, inputTokens: BigInt(1000), outputTokens: BigInt(200) },
          },
        ];
      }
      return [];
    });

    const result = await getAiUsageAnalytics(3);

    expect(result.daily).toHaveLength(3);
    expect(result.daily.every((d) => typeof d.requests === "number")).toBe(true);
    const withUsage = result.daily.find((d) => d.requests > 0);
    expect(withUsage).toMatchObject({ requests: 5, inputTokens: 1000, outputTokens: 200, totalTokens: 1200 });
    expect(result.daily.filter((d) => d.requests === 0)).toHaveLength(2);
  });

  it("ranks accounts by total tokens and picks each account's heaviest surface", async () => {
    dbMock.aiUsageWindow.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
      if (by.includes("accountId")) {
        return [
          { accountId: "acct_1", surface: "copilot", _sum: { requests: 3, inputTokens: BigInt(100), outputTokens: BigInt(50) } },
          { accountId: "acct_1", surface: "hts-classification", _sum: { requests: 1, inputTokens: BigInt(900), outputTokens: BigInt(100) } },
          { accountId: "acct_2", surface: "copilot", _sum: { requests: 10, inputTokens: BigInt(50), outputTokens: BigInt(10) } },
        ];
      }
      return [];
    });
    dbMock.account.findMany.mockResolvedValue([
      { id: "acct_1", name: "Acme Imports" },
      { id: "acct_2", name: "Globex Freight" },
    ]);

    const result = await getAiUsageAnalytics(7);

    expect(result.topAccounts[0]).toMatchObject({
      accountId: "acct_1",
      accountName: "Acme Imports",
      totalTokens: 1150,
      topSurface: "hts-classification",
    });
    expect(result.totals.accountsActive).toBe(2);
  });

  it("reduces the Copilot audit trail into status counts and per-tool stats", async () => {
    dbMock.auditLog.findMany.mockResolvedValue([
      { action: "COPILOT_QUERY", metadata: { status: "ANSWERED", durationMs: 1000, toolCallsMade: 2 } },
      { action: "COPILOT_QUERY", metadata: { status: "ANSWERED", durationMs: 2000, toolCallsMade: 0 } },
      { action: "COPILOT_QUERY", metadata: { status: "ERROR", durationMs: 500, toolCallsMade: 1 } },
      { action: "COPILOT_TOOL_EXECUTED", metadata: { tool: "list_shipments", ok: true, durationMs: 80 } },
      { action: "COPILOT_TOOL_EXECUTED", metadata: { tool: "list_shipments", ok: false, durationMs: 120 } },
    ]);

    const result = await getAiUsageAnalytics(30);

    expect(result.copilot.totalQueries).toBe(3);
    expect(result.copilot.statusCounts).toEqual({ ANSWERED: 2, ERROR: 1 });
    expect(result.copilot.avgDurationMs).toBe(Math.round((1000 + 2000 + 500) / 3));
    expect(result.copilot.toolStats).toEqual([
      { tool: "list_shipments", calls: 2, successRate: 0.5, avgDurationMs: 100 },
    ]);
    expect(result.copilot.sampled).toBe(false);
  });

  it("flags the Copilot sample as truncated once the read limit is hit", async () => {
    const rows = Array.from({ length: 5000 }, () => ({
      action: "COPILOT_QUERY" as const,
      metadata: { status: "ANSWERED", durationMs: 100, toolCallsMade: 0 },
    }));
    dbMock.auditLog.findMany.mockResolvedValue(rows);

    const result = await getAiUsageAnalytics(30);

    expect(result.copilot.sampled).toBe(true);
    expect(result.copilot.sampleSize).toBe(5000);
  });
});
