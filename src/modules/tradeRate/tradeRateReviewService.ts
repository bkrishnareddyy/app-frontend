/**
 * Review gate for platform-level trade-rate reference data.
 *
 * Section301Rate, Section301Exclusion, and AdCvdCompanyRate are written by
 * LLM/scraper ingestion pipelines with `reviewStatus` defaulting to
 * "PENDING" — nothing in a PENDING row is allowed to affect a duty
 * calculation or refund trigger until a platform admin approves it here.
 * This module is that gate: list what's pending, and move a row to
 * APPROVED or REJECTED, once, with an audit trail.
 *
 * These models have no tenant (no accountId column) — they're shared
 * platform reference data, not per-customer records like Party/Product.
 * Unlike `reviewParty`/`reviewRegistration` in the party module, there is no
 * intermediate IN_REVIEW state and no separate approve permission gate
 * beyond the isPlatformAdmin check the calling route already enforces —
 * the review surface here is smaller by design, matching what the schema
 * actually models (PENDING | APPROVED | REJECTED, not a multi-step workflow).
 */

import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { DomainError } from "@/lib/api/error";

export const RATE_REVIEW_TYPES = ["SECTION_301_RATE", "SECTION_301_EXCLUSION", "ADCVD_COMPANY_RATE"] as const;
export type RateReviewType = (typeof RATE_REVIEW_TYPES)[number];

export function isRateReviewType(value: string): value is RateReviewType {
  return (RATE_REVIEW_TYPES as readonly string[]).includes(value);
}

export interface RateReviewItem {
  type: RateReviewType;
  id: string;
  headline: string;
  citation: string | null;
  /** Raw source text to review, when the model carries one. Null, not fabricated, when it doesn't. */
  evidenceText: string | null;
  createdAt: Date;
}

/** Who is acting. Recorded against the admin's own account — these rows have no tenant of their own. */
export interface RateReviewActor {
  accountId: string;
  userId: string | null;
  requestId?: string | null;
  source?: string | null;
}

export class RateReviewNotFoundError extends DomainError {
  constructor(type: RateReviewType, id: string) {
    super(`No ${type} review item ${id}.`, "RATE_REVIEW_NOT_FOUND", 404);
    this.name = "RateReviewNotFoundError";
  }
}

export class RateReviewNotPendingError extends DomainError {
  constructor(type: RateReviewType, id: string, currentStatus: string) {
    super(
      `This ${type} record is ${currentStatus}, not PENDING — it may already have been reviewed.`,
      "RATE_REVIEW_NOT_PENDING",
      409
    );
    this.name = "RateReviewNotPendingError";
  }
}

function formatTranche(tranche: string): string {
  return tranche.replace(/^LIST_/, "List ").replace("_", "");
}

export async function listPendingRateReviews(): Promise<RateReviewItem[]> {
  const [rates, exclusions, companyRates] = await Promise.all([
    db.section301Rate.findMany({ where: { reviewStatus: "PENDING" } }),
    db.section301Exclusion.findMany({ where: { reviewStatus: "PENDING" } }),
    db.adCvdCompanyRate.findMany({ where: { reviewStatus: "PENDING" } }),
  ]);

  const items: RateReviewItem[] = [
    ...rates.map((r): RateReviewItem => ({
      type: "SECTION_301_RATE",
      id: r.id,
      headline: `HTS ${r.htsNumber} · ${formatTranche(r.tranche)} · ${r.dutyRatePct}%`,
      citation: r.federalRegisterCitation,
      evidenceText: null,
      createdAt: r.createdAt,
    })),
    ...exclusions.map((e): RateReviewItem => ({
      type: "SECTION_301_EXCLUSION",
      id: e.id,
      headline: `HTS ${e.htsNumber} exclusion · ${formatTranche(e.tranche)}`,
      citation: e.federalRegisterCitation,
      evidenceText: e.productDescriptionRaw,
      createdAt: e.createdAt,
    })),
    ...companyRates.map((c): RateReviewItem => ({
      type: "ADCVD_COMPANY_RATE",
      id: c.id,
      headline: `Case ${c.caseNumber} · ${c.manufacturerName} · ${
        c.depositRatePct != null ? `${c.depositRatePct}%` : "all-others rate"
      }`,
      citation: c.federalRegisterCitation,
      evidenceText: null,
      createdAt: c.createdAt,
    })),
  ];

  return items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

async function logReview(
  actor: RateReviewActor,
  type: RateReviewType,
  id: string,
  beforeStatus: string,
  afterStatus: string,
  reviewNote: string | null
) {
  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: afterStatus === "APPROVED" ? AuditAction.TRADE_RATE_APPROVED : AuditAction.TRADE_RATE_REJECTED,
    entity: type,
    entityId: id,
    source: actor.source || "UI",
    metadata: { from: beforeStatus, to: afterStatus, reviewNote },
    requestId: actor.requestId ?? null,
    // Approving is what unlocks this rate for real duty-stack use, so a
    // failure to record it must not silently succeed.
    failClosed: afterStatus === "APPROVED",
  });
}

/** Moves one PENDING trade-rate row to APPROVED or REJECTED. Never SUPERSEDED — that's a separate, future mechanism. */
export async function reviewRate(
  actor: RateReviewActor,
  type: RateReviewType,
  id: string,
  action: "APPROVE" | "REJECT",
  reviewNote: string | null = null
) {
  const target = action === "APPROVE" ? "APPROVED" : "REJECTED";

  if (type === "SECTION_301_RATE") {
    const before = await db.section301Rate.findUnique({ where: { id } });
    if (!before) throw new RateReviewNotFoundError(type, id);
    if (before.reviewStatus !== "PENDING") throw new RateReviewNotPendingError(type, id, before.reviewStatus);

    const after = await db.section301Rate.update({
      where: { id },
      data: { reviewStatus: target, approvedAt: target === "APPROVED" ? new Date() : null },
    });
    await logReview(actor, type, id, before.reviewStatus, after.reviewStatus, reviewNote);
    return after;
  }

  if (type === "SECTION_301_EXCLUSION") {
    const before = await db.section301Exclusion.findUnique({ where: { id } });
    if (!before) throw new RateReviewNotFoundError(type, id);
    if (before.reviewStatus !== "PENDING") throw new RateReviewNotPendingError(type, id, before.reviewStatus);

    const after = await db.section301Exclusion.update({
      where: { id },
      data: { reviewStatus: target, approvedAt: target === "APPROVED" ? new Date() : null },
    });
    await logReview(actor, type, id, before.reviewStatus, after.reviewStatus, reviewNote);
    return after;
  }

  if (type === "ADCVD_COMPANY_RATE") {
    const before = await db.adCvdCompanyRate.findUnique({ where: { id } });
    if (!before) throw new RateReviewNotFoundError(type, id);
    if (before.reviewStatus !== "PENDING") throw new RateReviewNotPendingError(type, id, before.reviewStatus);

    const after = await db.adCvdCompanyRate.update({
      where: { id },
      data: { reviewStatus: target, approvedAt: target === "APPROVED" ? new Date() : null },
    });
    await logReview(actor, type, id, before.reviewStatus, after.reviewStatus, reviewNote);
    return after;
  }

  const exhaustiveCheck: never = type;
  throw new DomainError(`Unknown rate review type "${exhaustiveCheck}".`, "RATE_REVIEW_UNKNOWN_TYPE", 400);
}
