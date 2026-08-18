import { inngest } from "../client";
import { db, runWithAccountId } from "@/lib/db";
import { computeAnalyticsMetrics } from "@/lib/analytics/metricComputer";

export async function executeDailyWorkMetricSnapshot() {
  const accounts = await db.account.findMany({ select: { id: true } });
  const today = new Date();
  let createdCount = 0;

  for (const account of accounts) {
    await runWithAccountId(account.id, async () => {
      const metrics = await computeAnalyticsMetrics(account.id);

      await db.workMetricSnapshot.create({
        data: {
          accountId: account.id,
          date: today,
          period: "DAILY",
          cyclTimeMedianHours: metrics.cyclTimeMedianHours,
          firstPassRate: metrics.firstPassRate,
          exceptionAgeAvgHours: metrics.exceptionAgeAvgHours,
          touchRate: metrics.touchRate,
          dutyPerEntry: metrics.dutyPerEntry,
          openExceptions: metrics.openExceptions,
          filedEntries: metrics.filedEntries,
          pscCount: metrics.pscCount,
        },
      });
      createdCount++;
    });
  }

  return { createdCount };
}

export const dailyWorkMetricSnapshotJob = (inngest.createFunction as any)(
  { id: "daily-work-metric-snapshot", triggers: [{ cron: "0 1 * * *" }] },
  async ({ step }: { step: any }) => {
    const result = await step.run("write-work-metric-snapshots", async () => {
      return await executeDailyWorkMetricSnapshot();
    });
    return result;
  }
);
