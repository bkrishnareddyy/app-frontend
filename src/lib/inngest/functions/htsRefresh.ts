import { inngest } from "../client";
import { db } from "@/lib/db";
import { HtsUsitcFetcher } from "@/modules/hts/htsUsitcFetcher";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";

export const HTS_SCHEDULE_DATASET_ID = "hts-schedule";
const DATASET_NAME = "HTSUS Schedule (Full Tariff Schedule)";

export const htsRefreshJob = (inngest.createFunction as any)(
  { id: "hts-refresh-job", triggers: [{ cron: "0 2 * * *" }, { event: "hts/refresh.requested" }] },
  async ({ step, event }: { step: any; event: any }) => {
    const triggeredBy = event?.name === "hts/refresh.requested" ? "MANUAL" : "CRON";

    const logId: string = await step.run("create-run-log", async () => {
      const alreadyRunning = await db.datasetRefreshLog.findFirst({
        where: { datasetId: HTS_SCHEDULE_DATASET_ID, status: "RUNNING" },
      });
      if (alreadyRunning) {
        throw new Error(
          `HTS refresh already has a run in progress (started ${alreadyRunning.startedAt.toISOString()}).`
        );
      }
      const log = await db.datasetRefreshLog.create({
        data: {
          datasetId: HTS_SCHEDULE_DATASET_ID,
          datasetName: DATASET_NAME,
          triggeredBy,
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
      return log.id;
    });

    try {
      const fetchRes = await step.run("fetch-full-schedule", async () => {
        return HtsUsitcFetcher.fetchFullSchedule();
      });

      const completeness = HtsUsitcFetcher.validateCompleteness(fetchRes);
      if (!completeness.valid) {
        throw new Error(`Completeness validation failed: ${completeness.reason}`);
      }

      const items = fetchRes.items;
      const failedChapters = fetchRes.chapterResults.filter((c: any) => !c.ok);

      const now = new Date();
      const editionYear = now.getUTCFullYear();

      const stageResult = await step.run("stage-and-diff-release", async () => {
        const priorCount = await db.htsRelease.count({ where: { country: "US", editionYear } });
        const revisionNumber = priorCount + 1;
        const dateLabel = now.toISOString().slice(0, 10);

        const currentPublished = await db.htsRelease.findFirst({
          where: { publicationStatus: "PUBLISHED" },
        });

        const release = await HtsIngestionService.stageRelease({
          editionYear,
          revisionNumber,
          releaseName: `USITC HTS ${editionYear} Refresh ${dateLabel}`,
          sourceUrl: "https://hts.usitc.gov/reststop/exportList",
          sourceFormat: "JSON",
          rawContent: JSON.stringify(items),
          items,
        });

        let diffCount = 0;
        if (currentPublished) {
          diffCount = await HtsIngestionService.generateDiff(currentPublished.id, release.id);
        }

        return { releaseId: release.id, diffCount };
      });

      await step.run("finalize-run-log-success", async () => {
        await db.datasetRefreshLog.update({
          where: { id: logId },
          data: {
            status: "SUCCESS",
            summary: `Staged release ${stageResult.releaseId} with ${items.length} items and ${stageResult.diffCount} diffs across 99 chapters.`,
            itemsIngested: items.length,
            sourceReportedTotal: items.length,
            sourcePublishDate: new Date(),
            completedAt: new Date(),
          },
        });
      });

      return {
        status: "SUCCESS",
        releaseId: stageResult.releaseId,
        itemCount: items.length,
        diffCount: stageResult.diffCount,
        failedChapters: failedChapters.length ? failedChapters : undefined,
      };
    } catch (err: any) {
      await step.run("finalize-run-log-failure", async () => {
        await db.datasetRefreshLog.update({
          where: { id: logId },
          data: {
            status: "FAILED",
            errorMessage: err?.message || "HTS Schedule refresh failed",
            completedAt: new Date(),
          },
        });
      });
      throw err;
    }
  }
);
