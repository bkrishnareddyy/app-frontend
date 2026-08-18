/**
 * Review gate for ComplianceKeywordRule — the phrase/keyword reference data
 * shared by End-Use Screening, Military End-Use Screening, Anti-Boycott
 * Screening, and Restricted Party Screening's red-flag check.
 *
 * These rows are hand-authored starter data (see
 * scripts/seed-compliance-keyword-rules.ts), inserted as DRAFT. Every
 * screening engine that reads this table only ever queries
 * `publicationStatus: "PUBLISHED"` — a DRAFT row is invisible to live
 * screening. This module is the gate: list what's pending, and move a row to
 * PUBLISHED or REJECTED, once, with an audit trail.
 *
 * ComplianceKeywordRule has no tenant (no accountId column) — it's shared
 * platform reference data, mirroring Section301Rate/Section301Exclusion/
 * AdCvdCompanyRate. As with tradeRateReviewService.ts, there is no
 * intermediate IN_REVIEW state and no separate approve permission beyond the
 * isPlatformAdmin check the calling route already enforces.
 */

import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { DomainError } from "@/lib/api/error";

export interface KeywordRuleReviewItem {
  id: string;
  category: string;
  phrase: string;
  matchType: string;
  citation: string | null;
  severity: string;
  authority: string;
  createdAt: Date;
}

/** Who is acting. Recorded against the admin's own account — these rows have no tenant of their own. */
export interface KeywordRuleReviewActor {
  accountId: string;
  userId: string | null;
  requestId?: string | null;
}

export class KeywordRuleReviewNotFoundError extends DomainError {
  constructor(id: string) {
    super(`No ComplianceKeywordRule review item ${id}.`, "KEYWORD_RULE_REVIEW_NOT_FOUND", 404);
    this.name = "KeywordRuleReviewNotFoundError";
  }
}

export class KeywordRuleReviewNotPendingError extends DomainError {
  constructor(id: string, currentStatus: string) {
    super(
      `This keyword rule is ${currentStatus}, not DRAFT — it may already have been reviewed.`,
      "KEYWORD_RULE_REVIEW_NOT_PENDING",
      409
    );
    this.name = "KeywordRuleReviewNotPendingError";
  }
}

/** Lists DRAFT keyword rules awaiting review, optionally narrowed to specific categories. */
export async function listPendingKeywordRuleReviews(categories?: string[]): Promise<KeywordRuleReviewItem[]> {
  const rows = await db.complianceKeywordRule.findMany({
    where: {
      publicationStatus: "DRAFT",
      ...(categories && categories.length > 0 ? { category: { in: categories } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    phrase: r.phrase,
    matchType: r.matchType,
    citation: r.citation,
    severity: r.severity,
    authority: r.authority,
    createdAt: r.createdAt,
  }));
}

async function logReview(
  actor: KeywordRuleReviewActor,
  id: string,
  beforeStatus: string,
  afterStatus: string,
  reviewNote: string | null
) {
  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action:
      afterStatus === "PUBLISHED" ? AuditAction.COMPLIANCE_KEYWORD_RULE_PUBLISHED : AuditAction.COMPLIANCE_KEYWORD_RULE_REJECTED,
    entity: "ComplianceKeywordRule",
    entityId: id,
    source: "UI",
    metadata: { from: beforeStatus, to: afterStatus, reviewNote },
    requestId: actor.requestId ?? null,
    // Publishing is what unlocks this phrase for live screening, so a
    // failure to record it must not silently succeed.
    failClosed: afterStatus === "PUBLISHED",
  });
}

/** Moves one DRAFT keyword rule to PUBLISHED or REJECTED. Never SUPERSEDED — that's a separate, future mechanism. */
export async function reviewKeywordRule(
  actor: KeywordRuleReviewActor,
  id: string,
  action: "PUBLISH" | "REJECT",
  reviewNote: string | null = null
) {
  const target = action === "PUBLISH" ? "PUBLISHED" : "REJECTED";

  const before = await db.complianceKeywordRule.findUnique({ where: { id } });
  if (!before) throw new KeywordRuleReviewNotFoundError(id);
  if (before.publicationStatus !== "DRAFT") {
    throw new KeywordRuleReviewNotPendingError(id, before.publicationStatus);
  }

  const after = await db.complianceKeywordRule.update({
    where: { id },
    data: {
      publicationStatus: target,
      publishedAt: target === "PUBLISHED" ? new Date() : null,
    },
  });

  await logReview(actor, id, before.publicationStatus, after.publicationStatus, reviewNote);
  return after;
}
