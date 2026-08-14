import { db } from "@/lib/db";
import { DATASET_DEFINITIONS } from "./datasetRegistry";

export interface DatasetHealthAlert {
  datasetId: string;
  datasetName: string;
  alertType:
    | "FETCH_FAILURE"
    | "COUNT_MISMATCH"
    | "STALE_RELEASE"
    | "STAGED_BACKLOG"
    | "ZERO_ROW_SUCCESS"
    | "OUTDATED_RELEASE_CONSUMER";
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  message: string;
  detectedAt: string;
  metadata?: Record<string, any>;
}

export class DatasetAlertService {
  /**
   * Evaluates all 6 required alert conditions across live datasets:
   * 1. fetch failure
   * 2. count mismatch
   * 3. stale published release
   * 4. staged-but-unpublished backlog
   * 5. zero-row "success"
   * 6. consumer not using the current release
   */
  static async evaluateHealthAlerts(): Promise<DatasetHealthAlert[]> {
    const alerts: DatasetHealthAlert[] = [];
    const now = new Date();

    const liveDatasets = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "LIVE");

    for (const dataset of liveDatasets) {
      // Fetch latest logs for this dataset
      const latestLogs = await db.datasetRefreshLog.findMany({
        where: { datasetId: dataset.id },
        orderBy: { startedAt: "desc" },
        take: 5,
      });

      const latestLog = latestLogs[0];
      const latestSuccess = latestLogs.find((l) => l.status === "SUCCESS");

      // 1. Alert: FETCH_FAILURE
      if (latestLog && latestLog.status === "FAILED") {
        alerts.push({
          datasetId: dataset.id,
          datasetName: dataset.name,
          alertType: "FETCH_FAILURE",
          severity: "HIGH",
          message: `Last refresh for ${dataset.name} failed: ${latestLog.errorMessage || "Fetch/ingestion error"}.`,
          detectedAt: now.toISOString(),
          metadata: { logId: latestLog.id, errorMessage: latestLog.errorMessage },
        });
      }

      // 2. Alert: COUNT_MISMATCH
      if (
        latestSuccess &&
        latestSuccess.sourceReportedTotal != null &&
        latestSuccess.itemsIngested != null &&
        latestSuccess.sourceReportedTotal > 0 &&
        latestSuccess.itemsIngested !== latestSuccess.sourceReportedTotal
      ) {
        alerts.push({
          datasetId: dataset.id,
          datasetName: dataset.name,
          alertType: "COUNT_MISMATCH",
          severity: "CRITICAL",
          message: `Ingested count (${latestSuccess.itemsIngested}) does not match authoritative source total (${latestSuccess.sourceReportedTotal}) for ${dataset.name}.`,
          detectedAt: now.toISOString(),
          metadata: {
            itemsIngested: latestSuccess.itemsIngested,
            sourceReportedTotal: latestSuccess.sourceReportedTotal,
          },
        });
      }

      // 3. Alert: STALE_RELEASE
      const staleThresholdMs = dataset.staleThresholdHours * 60 * 60 * 1000;
      const lastSuccessTime = latestSuccess ? latestSuccess.startedAt.getTime() : 0;
      if (!latestSuccess || now.getTime() - lastSuccessTime > staleThresholdMs) {
        const hoursAgo = latestSuccess
          ? Math.round((now.getTime() - lastSuccessTime) / (1000 * 60 * 60))
          : "infinity";
        alerts.push({
          datasetId: dataset.id,
          datasetName: dataset.name,
          alertType: "STALE_RELEASE",
          severity: "HIGH",
          message: `Dataset ${dataset.name} is stale. Last successful refresh was ${hoursAgo} hours ago (threshold: ${dataset.staleThresholdHours}h).`,
          detectedAt: now.toISOString(),
          metadata: { staleThresholdHours: dataset.staleThresholdHours, hoursAgo },
        });
      }

      // 5. Alert: ZERO_ROW_SUCCESS
      if (latestSuccess && latestSuccess.itemsIngested === 0) {
        alerts.push({
          datasetId: dataset.id,
          datasetName: dataset.name,
          alertType: "ZERO_ROW_SUCCESS",
          severity: "HIGH",
          message: `Refresh for ${dataset.name} completed with status SUCCESS but ingested 0 rows.`,
          detectedAt: now.toISOString(),
          metadata: { logId: latestSuccess.id },
        });
      }
    }

    // 4. Alert: STAGED_BACKLOG
    // Check HtsRelease staged DRAFT releases older than 24h
    const oldStagedHts = await db.htsRelease.findMany({
      where: {
        publicationStatus: "DRAFT",
        retrievedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true, releaseName: true, retrievedAt: true },
    });

    const oldStagedScreening = await db.screeningEntity.count({
      where: {
        publicationStatus: "DRAFT",
        createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });

    const oldStagedRulings = await db.ruling.count({
      where: {
        publicationStatus: "DRAFT",
        lastVerifiedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });

    if (oldStagedHts.length > 0 || oldStagedScreening > 0 || oldStagedRulings > 0) {
      alerts.push({
        datasetId: "staged-backlog",
        datasetName: "Staged Release Backlog",
        alertType: "STAGED_BACKLOG",
        severity: "MEDIUM",
        message: `Staged-but-unpublished backlog detected: ${oldStagedHts.length} HTS release(s), ${oldStagedScreening} CSL entities, ${oldStagedRulings} rulings pending approval > 24h.`,
        detectedAt: now.toISOString(),
        metadata: {
          stagedHtsCount: oldStagedHts.length,
          stagedScreeningCount: oldStagedScreening,
          stagedRulingsCount: oldStagedRulings,
        },
      });
    }

    // 6. Alert: OUTDATED_RELEASE_CONSUMER
    // Check if active classification cases point to superseded HTS releases
    const activePublishedHts = await db.htsRelease.findFirst({
      where: { publicationStatus: "PUBLISHED" },
      select: { id: true, editionYear: true, revisionNumber: true },
    });

    if (activePublishedHts) {
      const outdatedCasesCount = await db.classificationCase.count({
        where: {
          htsReleaseId: { not: activePublishedHts.id },
          NOT: { htsReleaseId: null },
          status: { in: ["DRAFT", "QUEUED", "PROCESSING", "PROPOSED"] },
        },
      });

      if (outdatedCasesCount > 0) {
        alerts.push({
          datasetId: "hts-schedule",
          datasetName: "HTSUS Schedule",
          alertType: "OUTDATED_RELEASE_CONSUMER",
          severity: "CRITICAL",
          message: `${outdatedCasesCount} active classification case(s) are using an outdated/superseded HTS release instead of active release (${activePublishedHts.editionYear} Rev ${activePublishedHts.revisionNumber}).`,
          detectedAt: now.toISOString(),
          metadata: {
            outdatedCasesCount,
            activePublishedReleaseId: activePublishedHts.id,
          },
        });
      }
    }

    return alerts;
  }
}
