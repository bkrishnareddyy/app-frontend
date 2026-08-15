/**
 * Deadline service — stateful lifecycle management for ComplianceDeadline rows.
 *
 * Design rules (non-negotiable):
 * 1. dueAt is derived, never hand-typed. This function owns all writes to dueAt.
 * 2. Rows are never deleted. Status transitions: OPEN → SATISFIED / MISSED / WAIVED.
 * 3. Idempotent: running twice against the same inputs produces one row, not two.
 * 4. Shipment.filingDeadline is kept as a denormalized cache of min(OPEN dueAt)
 *    over blocking deadlines, so the 7501 team's ~60 read sites keep working.
 */

import { db } from "@/lib/db";
import {
  DeadlineStatus,
  DeadlineType,
  type ComplianceDeadline,
} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import {
  computeDeadlines,
  missingAnchors,
  type DeadlineContext,
  DEADLINE_RULES,
} from "./deadlineRules";

// ── Threshold constants ────────────────────────────────────────────────────

const MS_72H = 72 * 60 * 60 * 1000;
const MS_24H = 24 * 60 * 60 * 1000;
/** Anchor shift larger than this triggers a notification. */
const ANCHOR_SHIFT_NOTIFY_MS = 12 * 60 * 60 * 1000;

// ── Internal helpers ───────────────────────────────────────────────────────

function deadlineIsBlocking(type: DeadlineType): boolean {
  return type === DeadlineType.ISF_10_2 || type === DeadlineType.ENTRY_FILING;
}

/** Exception code that identifies a missing-anchor work item. */
function missingAnchorCode(type: DeadlineType, anchor: string): string {
  return `DEADLINE_MISSING_ANCHOR_${type}_${anchor}`;
}

/** Exception code for a breached or urgent deadline. */
function deadlineExceptionCode(type: DeadlineType): string {
  return `DEADLINE_BREACH_${type}`;
}

function ruleForType(type: DeadlineType) {
  return DEADLINE_RULES.find((r) => r.type === type);
}

// ── Core recompute ─────────────────────────────────────────────────────────

/**
 * Recompute all ComplianceDeadline rows for a shipment.
 *
 * Mirrors the idempotent create-or-resolve pattern used by ReconciliationEngine:
 * - Existing OPEN rows are updated in place (anchorAt, dueAt, estimated).
 * - New deadlines get new rows.
 * - SATISFIED / MISSED / WAIVED rows are left alone.
 * - After upsert, Shipment.filingDeadline is refreshed to min(OPEN dueAt).
 */
export async function recomputeShipmentDeadlines(shipmentId: string, accountId: string): Promise<void> {
  const shipment = await db.shipment.findFirst({
    where: { id: shipmentId, accountId },
    include: {
      customsFilings: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { releasedAt: true },
      },
      complianceDeadlines: {
        where: { status: DeadlineStatus.OPEN },
      },
    },
  });

  if (!shipment) return;

  const ctx: DeadlineContext = {
    transportMode: shipment.transportMode,
    ladingDate: shipment.ladingDate,
    arrivalDate: shipment.arrivalDate,
    estimatedArrival: shipment.estimatedArrival,
    releaseDate: shipment.customsFilings[0]?.releasedAt ?? null,
    paymentMethod: null, // Phase 1: wire from IOR once 7501 team adds paymentMethod
  };

  const computed = computeDeadlines(ctx);
  const now = new Date();

  for (const cd of computed) {
    const existing = shipment.complianceDeadlines.find((d) => d.type === cd.type);

    const prevDueAt = existing?.dueAt ?? null;
    const newDueAt = cd.dueAt;

    const data = {
      accountId: shipment.accountId,
      shipmentId,
      type: cd.type,
      deadlineClass: cd.deadlineClass,
      anchorEvent: cd.anchorEvent,
      anchorAt: cd.anchorAt,
      dueAt: newDueAt,
      estimated: cd.estimated,
      ruleId: cd.ruleId,
      ruleCitation: cd.citation,
      penaltyEstimate: cd.penaltyMax != null ? new Decimal(cd.penaltyMax) : null,
      penaltyBasis: cd.penaltyBasis ?? null,
      status: DeadlineStatus.OPEN,
      version: (existing?.version ?? 0) + 1,
      updatedAt: now,
    };

    if (existing) {
      await db.complianceDeadline.update({
        where: { id: existing.id },
        data,
      });

      // Notify if anchor moved significantly.
      if (
        prevDueAt &&
        Math.abs(newDueAt.getTime() - prevDueAt.getTime()) > ANCHOR_SHIFT_NOTIFY_MS
      ) {
        await db.shipmentEventLog.create({
          data: {
            shipmentId,
            eventType: "DEADLINE_ANCHOR_SHIFTED",
            payload: {
              type: cd.type,
              prevDueAt: prevDueAt.toISOString(),
              newDueAt: newDueAt.toISOString(),
            },
            triggeredBy: "DeadlineService",
          },
        });
      }
    } else {
      await db.complianceDeadline.create({ data: { ...data, id: generateId(), createdAt: now } });
    }
  }

  // Surface missing-anchor exceptions.
  await _upsertMissingAnchorExceptions(shipmentId, shipment.accountId, ctx);

  // Refresh the denormalized cache.
  await _refreshFilingDeadline(shipmentId);

  // Evaluate breach / urgency thresholds.
  await _evaluateUrgencyExceptions(shipmentId, shipment.accountId, now);
}

// ── Satisfaction ───────────────────────────────────────────────────────────

/**
 * Mark a deadline satisfied. Idempotent — calling twice is safe.
 * Auto-resolves any breach exception for this deadline.
 */
export async function satisfyDeadline(
  shipmentId: string,
  accountId: string,
  type: DeadlineType,
  satisfiedBy: string
): Promise<void> {
  const deadline = await db.complianceDeadline.findFirst({
    where: { shipmentId, accountId, type, status: DeadlineStatus.OPEN },
  });

  if (!deadline) return; // already satisfied or not yet computed

  const now = new Date();

  await db.complianceDeadline.update({
    where: { id: deadline.id },
    data: {
      status: DeadlineStatus.SATISFIED,
      satisfiedAt: now,
      satisfiedBy,
      version: { increment: 1 },
    },
  });

  // Auto-resolve the breach exception if one exists.
  await db.exceptionItem.updateMany({
    where: {
      shipmentId,
      accountId,
      code: deadlineExceptionCode(type),
      status: { not: "Resolved" },
    },
    data: {
      status: "Resolved",
      resolvedAt: now,
      resolvedBy: "SYSTEM",
      resolvedByName: "DeadlineMonitor",
      resolutionNote: `Deadline ${type} satisfied`,
    },
  });

  await _refreshFilingDeadline(shipmentId);
}

// ── Waiver ─────────────────────────────────────────────────────────────────

export async function waiveDeadline(
  shipmentId: string,
  accountId: string,
  type: DeadlineType,
  reason: string,
  waivedBy: string
): Promise<void> {
  const deadline = await db.complianceDeadline.findFirst({
    where: { shipmentId, accountId, type, status: DeadlineStatus.OPEN },
  });

  if (!deadline) return;

  await db.complianceDeadline.update({
    where: { id: deadline.id },
    data: {
      status: DeadlineStatus.WAIVED,
      waivedReason: reason,
      satisfiedAt: new Date(),
      satisfiedBy: waivedBy,
      version: { increment: 1 },
    },
  });

  await _refreshFilingDeadline(shipmentId);
}

// ── Sweep (called by cron) ─────────────────────────────────────────────────

/**
 * Re-evaluate all OPEN deadlines across all accounts.
 * Marks breached ones MISSED and fires urgency exceptions.
 * Called every 15 minutes by the deadline-sweep cron route.
 */
export async function sweepDeadlines(): Promise<{ evaluated: number; missed: number; notified: number }> {
  const now = new Date();
  let evaluated = 0;
  let missed = 0;
  let notified = 0;

  // Process in batches to avoid loading the entire table into memory.
  const batchSize = 200;
  let cursor: string | undefined;

  while (true) {
    const batch = await db.complianceDeadline.findMany({
      where: { status: DeadlineStatus.OPEN, dueAt: { not: null } },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { shipment: { select: { accountId: true, assignedBrokerId: true } } },
    });

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    evaluated += batch.length;

    for (const d of batch) {
      if (!d.dueAt || !d.shipmentId || !d.shipment) continue;

      const msRemaining = d.dueAt.getTime() - now.getTime();

      // Transition to MISSED.
      if (msRemaining <= 0) {
        await db.complianceDeadline.update({
          where: { id: d.id },
          data: { status: DeadlineStatus.MISSED, version: { increment: 1 } },
        });
        missed++;
        await _escalateToException(d, d.shipment.accountId, true, now);
        notified++;
        continue;
      }

      // 72h warning.
      if (msRemaining <= MS_72H) {
        const alreadyNotified = await db.exceptionItem.count({
          where: {
            shipmentId: d.shipmentId,
            code: deadlineExceptionCode(d.type),
            status: { not: "Resolved" },
          },
        });
        if (alreadyNotified === 0) {
          await _escalateToException(d, d.shipment.accountId, false, now);
          notified++;
        }
      }
    }

    if (batch.length < batchSize) break;
  }

  return { evaluated, missed, notified };
}

// ── Private helpers ────────────────────────────────────────────────────────

async function _refreshFilingDeadline(shipmentId: string): Promise<void> {
  // min(dueAt) over OPEN deadlines that are blocking (ISF, entry filing).
  const rows = await db.complianceDeadline.findMany({
    where: {
      shipmentId,
      status: DeadlineStatus.OPEN,
      dueAt: { not: null },
    },
    select: { type: true, dueAt: true },
  });

  const blockingDueDates = rows
    .filter((r) => deadlineIsBlocking(r.type) && r.dueAt != null)
    .map((r) => r.dueAt!.getTime());

  const minDueAt =
    blockingDueDates.length > 0
      ? new Date(Math.min(...blockingDueDates))
      : null;

  await db.shipment.update({
    where: { id: shipmentId },
    data: { filingDeadline: minDueAt },
  });
}

async function _upsertMissingAnchorExceptions(
  shipmentId: string,
  accountId: string,
  ctx: DeadlineContext
): Promise<void> {
  const missing = missingAnchors(ctx);

  for (const { type, missingAnchor } of missing) {
    const code = missingAnchorCode(type, missingAnchor);
    const rule = ruleForType(type);
    const description = `Cannot compute ${type} deadline — no ${missingAnchor.toLowerCase().replace("_", " ")} on file. ${rule?.citation ? `(${rule.citation})` : ""}`;

    const existing = await db.exceptionItem.findFirst({
      where: { shipmentId, code, status: { not: "Resolved" } },
    });

    if (!existing) {
      await db.exceptionItem.create({
        data: {
          accountId,
          shipmentId,
          code,
          category: "FILING",
          type: "compliance_flag",
          severity: "High",
          description,
          blocking: false,
          sourceAgent: "DeadlineMonitor",
          status: "Open",
        },
      });
    }
  }

  // Auto-resolve missing-anchor exceptions whose anchor is now present.
  const allRules = DEADLINE_RULES.filter((r) => r.appliesTo(ctx));
  for (const rule of allRules) {
    const resolved = missing.find((m) => m.type === rule.type);
    if (!resolved) {
      // Anchor is now present — auto-resolve if there's an open exception.
      const code = missingAnchorCode(rule.type, rule.anchor);
      await db.exceptionItem.updateMany({
        where: { shipmentId, code, status: { not: "Resolved" } },
        data: {
          status: "Resolved",
          resolvedAt: new Date(),
          resolvedBy: "SYSTEM",
          resolvedByName: "DeadlineMonitor",
          resolutionNote: `Anchor date ${rule.anchor} is now on file`,
        },
      });
    }
  }
}

async function _escalateToException(
  d: ComplianceDeadline,
  accountId: string,
  breached: boolean,
  now: Date
): Promise<void> {
  if (!d.shipmentId) return;

  const code = deadlineExceptionCode(d.type);
  const msRemaining = d.dueAt ? d.dueAt.getTime() - now.getTime() : 0;
  const hoursStr = breached
    ? "BREACHED"
    : `${Math.ceil(msRemaining / 3_600_000)}h remaining`;

  const description = `${d.type.replace(/_/g, " ")} deadline ${hoursStr}. ${d.ruleCitation}${
    d.penaltyBasis ? ` · ${d.penaltyBasis}` : ""
  }`;

  const existing = await db.exceptionItem.findFirst({
    where: { shipmentId: d.shipmentId, code, status: { not: "Resolved" } },
  });

  if (!existing) {
    await db.exceptionItem.create({
      data: {
        accountId,
        shipmentId: d.shipmentId,
        code,
        category: "FILING",
        type: "compliance_flag",
        severity: breached ? "Critical" : "High",
        description,
        blocking: deadlineIsBlocking(d.type),
        sourceAgent: "DeadlineMonitor",
        status: "Open",
      },
    });
  } else if (breached && existing.severity !== "Critical") {
    // Escalate from High to Critical on breach.
    await db.exceptionItem.update({
      where: { id: existing.id },
      data: { severity: "Critical", description, blocking: deadlineIsBlocking(d.type) },
    });
  }
}

async function _evaluateUrgencyExceptions(
  shipmentId: string,
  accountId: string,
  now: Date
): Promise<void> {
  const open = await db.complianceDeadline.findMany({
    where: { shipmentId, status: DeadlineStatus.OPEN, dueAt: { not: null } },
  });

  for (const d of open) {
    if (!d.dueAt) continue;
    const msRemaining = d.dueAt.getTime() - now.getTime();
    const isUrgent = msRemaining <= MS_24H;
    const isBreached = msRemaining <= 0;

    if (isBreached || isUrgent) {
      await _escalateToException(d, accountId, isBreached, now);
    }
  }
}

// Inline CUID-lite so we don't need a dependency in a hot path.
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 9);
  return `c${timestamp}${random}`;
}
