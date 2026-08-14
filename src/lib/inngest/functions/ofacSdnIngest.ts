import { inngest } from "../client";
import { db } from "@/lib/db";
import { OfacSdnIngestionService, type OfacListIngestResult } from "@/modules/screening/ofacSdnIngestionService";

export const OFAC_SDN_DATASET_ID = "ofac-sdn";
const DATASET_NAME = "OFAC SDN + Consolidated Non-SDN";

function summarize(sdn: OfacListIngestResult, consolidated: OfacListIngestResult): string {
  return (
    `SDN: ${sdn.parsedCount}/${sdn.reportedTotal} entries, ${sdn.supersededCount} superseded. ` +
    `Consolidated Non-SDN: ${consolidated.parsedCount}/${consolidated.reportedTotal} entries, ${consolidated.supersededCount} superseded.`
  );
}

export const ofacSdnIngestJob = (inngest.createFunction as any)(
  { id: "ofac-sdn-ingest", triggers: [{ cron: "0 5 * * *" }, { event: "ofac-sdn/refresh.requested" }] },
  async ({ step, event }: { step: any; event: any }) => {
    const triggeredBy = event?.name === "ofac-sdn/refresh.requested" ? "MANUAL" : "CRON";

    // Its own step so a mid-run crash/retry replays from here without
    // creating a second RUNNING row (Inngest memoizes completed steps).
    const logId: string = await step.run("create-run-log", async () => {
      const alreadyRunning = await db.datasetRefreshLog.findFirst({
        where: { datasetId: OFAC_SDN_DATASET_ID, status: "RUNNING" },
      });
      if (alreadyRunning) {
        throw new Error(
          `OFAC SDN ingestion already has a run in progress (started ${alreadyRunning.startedAt.toISOString()}).`
        );
      }
      const log = await db.datasetRefreshLog.create({
        data: {
          datasetId: OFAC_SDN_DATASET_ID,
          datasetName: DATASET_NAME,
          triggeredBy,
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
      return log.id;
    });

    try {
      // Separate steps per list: a crash after SDN succeeds resumes with
      // only the Consolidated list re-fetched, not both from scratch.
      const sdn: OfacListIngestResult = await step.run("ingest-sdn-list", () =>
        OfacSdnIngestionService.fetchAndIngestList("SDN")
      );
      const consolidated: OfacListIngestResult = await step.run("ingest-consolidated-list", () =>
        OfacSdnIngestionService.fetchAndIngestList("CONSOLIDATED_NON_SDN")
      );

      await step.run("finalize-run-log-success", async () => {
        await db.datasetRefreshLog.update({
          where: { id: logId },
          data: {
            status: "SUCCESS",
            summary: summarize(sdn, consolidated),
            itemsIngested: sdn.parsedCount + consolidated.parsedCount,
            sourceReportedTotal: sdn.reportedTotal + consolidated.reportedTotal,
            sourcePublishDate: sdn.publishDate ?? consolidated.publishDate ?? undefined,
            completedAt: new Date(),
          },
        });
      });

      return { sdn, consolidated };
    } catch (err: any) {
      await step.run("finalize-run-log-failure", async () => {
        await db.datasetRefreshLog.update({
          where: { id: logId },
          data: {
            status: "FAILED",
            errorMessage: err?.message || "OFAC SDN ingestion failed",
            completedAt: new Date(),
          },
        });
      });
      throw err;
    }
  }
);
