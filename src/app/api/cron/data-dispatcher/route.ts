import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { DATASET_DEFINITIONS } from "@/lib/data/datasetRegistry";
import { DatasetAlertService } from "@/lib/data/datasetAlertService";

export const maxDuration = 300;

/**
 * Notification is a tenant-scoped model (accountId/userId are non-nullable,
 * FK-constrained) -- there is no "global platform" row to attach a
 * platform-level alert to. Deliver it as a real notification through each
 * platform admin's own real account membership instead of a fabricated
 * accountId/userId that violates the FK constraint on every insert.
 */
async function notifyPlatformAdmins(message: string, type: string) {
  const platformAdmins = await db.user.findMany({
    where: { platformRoles: { some: { platformRole: { name: "PLATFORM_ADMIN" } } }, deletedAt: null },
    include: {
      memberships: {
        where: { status: "ACTIVE", account: { deletedAt: null } },
        take: 1,
      },
    },
  });

  for (const admin of platformAdmins) {
    const membership = admin.memberships[0];
    if (!membership) continue; // platform admin has no active tenant membership to notify through
    await db.notification
      .create({
        data: { accountId: membership.accountId, userId: admin.id, message, type },
      })
      .catch((err) => {
        console.error(`[data-dispatcher] Failed to notify platform admin ${admin.id}:`, err);
      });
  }
}

/**
 * Single daily dispatcher cron — fits the Vercel Hobby plan's 2-cron ceiling.
 * Runs at 02:00 UTC and fans out to whichever LIVE datasets are due based on
 * scheduledFrequencyHours vs lastSuccessAt from DatasetRefreshLog.
 *
 * Also fires staleness alerts for any dataset that has exceeded its
 * staleThresholdHours without a successful refresh.
 *
 * Schedule: 0 2 * * * (daily, 02:00 UTC) — see vercel.json.
 */
async function handleDispatch(requestId: string) {
  // withCronRoute already required CRON_SECRET to be set and valid before
  // this handler runs, so it's safe to forward unconditionally here.
  const cronSecret = process.env.CRON_SECRET as string;
  const now = new Date();
  const dispatched: string[] = [];
  const skipped: string[] = [];
  const staleAlerts: string[] = [];

  // Load the most recent successful run per dataset in one query
  const latestSuccessLogs = await db.datasetRefreshLog.findMany({
    where: {
      status: "SUCCESS",
      datasetId: { in: DATASET_DEFINITIONS.map((d) => d.id) },
    },
    orderBy: { completedAt: "desc" },
    distinct: ["datasetId"],
  });
  const lastSuccessMap = new Map(
    latestSuccessLogs.map((l) => [l.datasetId, l.completedAt ?? l.startedAt])
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  for (const dataset of DATASET_DEFINITIONS) {
    // Only dispatch LIVE datasets — NOT_YET_IMPLEMENTED datasets are never called
    if (dataset.readinessStatus !== "LIVE" || !dataset.endpoint) {
      continue;
    }

    const lastSuccess = lastSuccessMap.get(dataset.id);
    const hoursSinceLast = lastSuccess
      ? (now.getTime() - lastSuccess.getTime()) / 3600000
      : Infinity;

    // ── Staleness alerting ─────────────────────────────────────────────────
    // Fire for ALL datasets (LIVE and NOT_YET_IMPLEMENTED) that exceed their threshold.
    if (hoursSinceLast > dataset.staleThresholdHours) {
      staleAlerts.push(dataset.id);
      await notifyPlatformAdmins(
        `Dataset staleness alert: "${dataset.name}" has not refreshed successfully in ${Math.round(hoursSinceLast)}h (threshold: ${dataset.staleThresholdHours}h). Ingestion may be misconfigured or source API unavailable.`,
        "dataset_staleness_alert"
      ).catch((err) => {
        console.error(`[data-dispatcher] Staleness notification error for ${dataset.id}:`, err);
      });
    }

    // ── Dispatch if due ────────────────────────────────────────────────────
    // Self-scheduled datasets (e.g. ofac-sdn) run on their own Inngest-native
    // cron trigger — dispatching them here too would double-run them daily.
    // Staleness alerting above still applies: if Inngest's own cron silently
    // stops firing, this dispatcher is what notices.
    if (dataset.selfScheduled) {
      skipped.push(dataset.id);
      continue;
    }

    if (hoursSinceLast < dataset.scheduledFrequencyHours) {
      skipped.push(dataset.id);
      continue;
    }

    // Refuse to start a second run while one is still RUNNING for this
    // dataset -- not a real distributed lock, but it closes the obvious
    // double-dispatch case (e.g. an overlapping manual trigger) cheaply,
    // using the log table that already exists.
    const alreadyRunning = await db.datasetRefreshLog.findFirst({
      where: { datasetId: dataset.id, status: "RUNNING" },
    });
    if (alreadyRunning) {
      skipped.push(dataset.id);
      continue;
    }

    // Create a RUNNING log row before calling the endpoint
    const log = await db.datasetRefreshLog.create({
      data: {
        datasetId: dataset.id,
        datasetName: dataset.name,
        triggeredBy: "CRON",
        status: "RUNNING",
        startedAt: now,
      },
    });

    try {
      const fullUrl = dataset.endpoint.startsWith("http")
        ? dataset.endpoint
        : `${baseUrl}${dataset.endpoint}`;

      const res = await fetch(fullUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${cronSecret}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errorMsg = errData.error || errData.reason || `HTTP ${res.status}`;
        await db.datasetRefreshLog.update({
          where: { id: log.id },
          data: { status: "FAILED", errorMessage: errorMsg, completedAt: new Date() },
        });
        console.error(`[data-dispatcher] ${dataset.id} FAILED: ${errorMsg}`);
      } else {
        const responseData = await res.json().catch(() => ({}));
        const summary = responseData.note || responseData.message || "Completed";
        await db.datasetRefreshLog.update({
          where: { id: log.id },
          data: { status: "SUCCESS", summary, completedAt: new Date() },
        });
        dispatched.push(dataset.id);
      }
    } catch (err: any) {
      const errorMsg = err.message || "Unexpected dispatch error";
      await db.datasetRefreshLog.update({
        where: { id: log.id },
        data: { status: "FAILED", errorMessage: errorMsg, completedAt: new Date() },
      });
      console.error(`[data-dispatcher] ${dataset.id} ERROR: ${errorMsg}`);
    }
  }

  // ── Evaluate 6-point health alerts ──────────────────────────────────
  const healthAlerts = await DatasetAlertService.evaluateHealthAlerts().catch((err) => {
    console.error("[data-dispatcher] Health alert evaluation error:", err);
    return [];
  });

  return NextResponse.json({
    status: "COMPLETE",
    requestId,
    dispatched,
    skipped,
    staleAlerts,
    healthAlerts,
    liveDatasetCount: DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "LIVE").length,
    notYetImplementedCount: DATASET_DEFINITIONS.filter(
      (d) => d.readinessStatus === "NOT_YET_IMPLEMENTED"
    ).length,
    timestamp: now.toISOString(),
  });
}

export const GET = withCronRoute(async ({ requestId }) => {
  return handleDispatch(requestId);
});

export const POST = withCronRoute(async ({ requestId }) => {
  return handleDispatch(requestId);
});
