/**
 * Platform-admin reporting over the AI metering and Copilot audit data.
 *
 * Nothing here is a new source of truth. `AiUsageWindow` (see `aiQuota.ts`) is
 * the only place request/token counts are ever recorded, and the Copilot audit
 * trail (see `modules/copilot/copilotAudit.ts`) is the only place per-question
 * status, duration and tool outcomes are ever recorded. This module only reads
 * and reduces what those two already write — it adds no new persistence and no
 * estimated/fabricated figures (there is no per-call cost or $ rate configured
 * anywhere in this codebase, so none is invented here).
 *
 * Two honesty caveats worth keeping in mind wherever this is displayed:
 *   - `AiUsageWindow` rows are pruned after ~35 days by `pruneAiUsageWindows`,
 *     so a lookback longer than that will silently see less data, not zero.
 *   - The Copilot audit read below is a bounded, most-recent-first sample
 *     (`AUDIT_SAMPLE_LIMIT` rows), not a full aggregate — `AuditLog` has no
 *     index on `entity`/`action`, so scanning the whole table for every
 *     dashboard load is not a trade worth making. `sampled: true` on the
 *     result says when the limit was hit.
 */

import { db } from "@/lib/db";
import { AI_SURFACES, ACCOUNT_WIDE, aiQuotaLimits, type AiSurface } from "@/lib/ai/aiQuota";
import { aiModel } from "@/lib/ai/aiModel";

const AUDIT_SAMPLE_LIMIT = 5000;

export interface AiSurfaceUsage {
  surface: string;
  label: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  userRequestsPerMinute: number | null;
  accountRequestsPerMinute: number | null;
}

export interface AiDailyUsage {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiAccountUsage {
  accountId: string;
  accountName: string;
  requests: number;
  totalTokens: number;
  topSurface: string | null;
}

export interface CopilotToolStat {
  tool: string;
  calls: number;
  successRate: number;
  avgDurationMs: number;
}

export interface CopilotQueryHealth {
  totalQueries: number;
  statusCounts: Record<string, number>;
  avgDurationMs: number;
  avgToolCallsPerQuery: number;
  toolStats: CopilotToolStat[];
  sampleSize: number;
  sampled: boolean;
}

export interface AiUsageAnalytics {
  rangeDays: number;
  sinceIso: string;
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    accountsActive: number;
    surfacesActive: number;
  };
  bySurface: AiSurfaceUsage[];
  daily: AiDailyUsage[];
  topAccounts: AiAccountUsage[];
  copilot: CopilotQueryHealth;
}

function surfaceLabel(surface: string): string {
  return surface
    .split("-")
    .map((w) => (w.toUpperCase() === "HTS" ? "HTS" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function bigNum(v: bigint | number | null | undefined): number {
  return typeof v === "bigint" ? Number(v) : v ?? 0;
}

async function getCopilotQueryHealth(since: Date): Promise<CopilotQueryHealth> {
  const rows = await db.auditLog.findMany({
    where: {
      entity: "Copilot",
      action: { in: ["COPILOT_QUERY", "COPILOT_TOOL_EXECUTED"] },
      createdAt: { gte: since },
    },
    select: { action: true, metadata: true },
    orderBy: { createdAt: "desc" },
    take: AUDIT_SAMPLE_LIMIT,
  });

  const statusCounts: Record<string, number> = {};
  let totalDurationMs = 0;
  let totalToolCalls = 0;
  let queryCount = 0;

  const toolMap = new Map<string, { calls: number; success: number; totalDurationMs: number }>();

  for (const row of rows) {
    const meta = (row.metadata ?? null) as Record<string, unknown> | null;
    if (row.action === "COPILOT_QUERY") {
      queryCount += 1;
      const status = typeof meta?.status === "string" ? meta.status : "UNKNOWN";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      if (typeof meta?.durationMs === "number") totalDurationMs += meta.durationMs;
      if (typeof meta?.toolCallsMade === "number") totalToolCalls += meta.toolCallsMade;
    } else if (row.action === "COPILOT_TOOL_EXECUTED") {
      const tool = typeof meta?.tool === "string" ? meta.tool : "unknown";
      const ok = meta?.ok === true;
      const durationMs = typeof meta?.durationMs === "number" ? meta.durationMs : 0;
      const entry = toolMap.get(tool) ?? { calls: 0, success: 0, totalDurationMs: 0 };
      entry.calls += 1;
      if (ok) entry.success += 1;
      entry.totalDurationMs += durationMs;
      toolMap.set(tool, entry);
    }
  }

  const toolStats = Array.from(toolMap.entries())
    .map(([tool, s]) => ({
      tool,
      calls: s.calls,
      successRate: s.calls > 0 ? s.success / s.calls : 0,
      avgDurationMs: s.calls > 0 ? Math.round(s.totalDurationMs / s.calls) : 0,
    }))
    .sort((a, b) => b.calls - a.calls);

  return {
    totalQueries: queryCount,
    statusCounts,
    avgDurationMs: queryCount > 0 ? Math.round(totalDurationMs / queryCount) : 0,
    avgToolCallsPerQuery: queryCount > 0 ? Number((totalToolCalls / queryCount).toFixed(2)) : 0,
    toolStats,
    sampleSize: rows.length,
    sampled: rows.length >= AUDIT_SAMPLE_LIMIT,
  };
}

/** Everything the platform-admin "Agents" analytics tab renders, pre-aggregated and serializable. */
export async function getAiUsageAnalytics(rangeDays = 30): Promise<AiUsageAnalytics> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (rangeDays - 1));

  const [bySurfaceRows, dailyRows, accountSurfaceRows, accounts, copilot] = await Promise.all([
    db.aiUsageWindow.groupBy({
      by: ["surface"],
      where: { windowKind: "day", userId: ACCOUNT_WIDE, windowStart: { gte: since } },
      _sum: { requests: true, inputTokens: true, outputTokens: true },
    }),
    db.aiUsageWindow.groupBy({
      by: ["windowStart"],
      where: { windowKind: "day", userId: ACCOUNT_WIDE, windowStart: { gte: since } },
      _sum: { requests: true, inputTokens: true, outputTokens: true },
      orderBy: { windowStart: "asc" },
    }),
    db.aiUsageWindow.groupBy({
      by: ["accountId", "surface"],
      where: { windowKind: "day", userId: ACCOUNT_WIDE, windowStart: { gte: since } },
      _sum: { requests: true, inputTokens: true, outputTokens: true },
    }),
    db.account.findMany({ select: { id: true, name: true } }),
    getCopilotQueryHealth(since),
  ]);

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  // Known surfaces first (stable order, present even at zero), then any
  // stale/unrecognized surface string found in the data so nothing is dropped.
  const surfacesSeen = new Set<string>(bySurfaceRows.map((r) => r.surface));
  const surfaceOrder = [...AI_SURFACES, ...Array.from(surfacesSeen).filter((s) => !(AI_SURFACES as readonly string[]).includes(s))];

  const bySurfaceMap = new Map(bySurfaceRows.map((r) => [r.surface, r]));
  const bySurface: AiSurfaceUsage[] = surfaceOrder.map((surface) => {
    const row = bySurfaceMap.get(surface);
    const limits = aiQuotaLimits(surface as AiSurface);
    const inputTokens = bigNum(row?._sum.inputTokens);
    const outputTokens = bigNum(row?._sum.outputTokens);
    return {
      surface,
      label: surfaceLabel(surface),
      model: aiModel(surface as AiSurface),
      requests: bigNum(row?._sum.requests),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      userRequestsPerMinute: limits.userRequestsPerMinute,
      accountRequestsPerMinute: limits.accountRequestsPerMinute,
    };
  });

  const dailyByKey = new Map(
    dailyRows.map((r) => [
      toDateKey(r.windowStart),
      {
        requests: bigNum(r._sum.requests),
        inputTokens: bigNum(r._sum.inputTokens),
        outputTokens: bigNum(r._sum.outputTokens),
      },
    ])
  );
  const daily: AiDailyUsage[] = [];
  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = toDateKey(d);
    const entry = dailyByKey.get(key);
    const inputTokens = entry?.inputTokens ?? 0;
    const outputTokens = entry?.outputTokens ?? 0;
    daily.push({
      date: key,
      requests: entry?.requests ?? 0,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });
  }

  const accountAgg = new Map<string, { requests: number; totalTokens: number; bySurface: Map<string, number> }>();
  for (const row of accountSurfaceRows) {
    const entry = accountAgg.get(row.accountId) ?? { requests: 0, totalTokens: 0, bySurface: new Map<string, number>() };
    const tokens = bigNum(row._sum.inputTokens) + bigNum(row._sum.outputTokens);
    entry.requests += bigNum(row._sum.requests);
    entry.totalTokens += tokens;
    entry.bySurface.set(row.surface, (entry.bySurface.get(row.surface) ?? 0) + tokens);
    accountAgg.set(row.accountId, entry);
  }

  const topAccounts: AiAccountUsage[] = Array.from(accountAgg.entries())
    .map(([accountId, entry]) => {
      let topSurface: string | null = null;
      let topTokens = -1;
      for (const [surface, tokens] of entry.bySurface) {
        if (tokens > topTokens) {
          topSurface = surface;
          topTokens = tokens;
        }
      }
      return {
        accountId,
        accountName: accountNameById.get(accountId) ?? accountId,
        requests: entry.requests,
        totalTokens: entry.totalTokens,
        topSurface,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 10);

  const totals = bySurface.reduce(
    (acc, s) => {
      acc.requests += s.requests;
      acc.inputTokens += s.inputTokens;
      acc.outputTokens += s.outputTokens;
      acc.totalTokens += s.totalTokens;
      return acc;
    },
    { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  );

  return {
    rangeDays,
    sinceIso: since.toISOString(),
    totals: {
      ...totals,
      accountsActive: accountAgg.size,
      surfacesActive: bySurface.filter((s) => s.requests > 0).length,
    },
    bySurface,
    daily,
    topAccounts,
    copilot,
  };
}
