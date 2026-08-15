import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { ReconciliationEngine } from "@/modules/shipment/reconciliationEngine";
import { FactAuditService } from "@/modules/audit/factAuditService";
import { FactService } from "@/modules/shipment/factService";
import { lineItemFactField } from "@/modules/shipment/lineItemReconciler";
import { normalizeDecisionStatus } from "@/modules/decisions/decisionState";
import {
  REVIEW_ACTIONS,
  REVIEW_TRIAGE_STATES,
  checkReviewPermission,
  isClassificationOverride,
  isReviewAction,
  permissionDeniedMessage,
  requiredPermissions,
  reviewerIdentity,
} from "@/modules/decisions/reviewAuthority";

async function applyProposedHtsCode(
  decision: { shipmentId: string; lineNumber: number | null; confidence: number | null },
  proposedHtsCode: string,
  ctx: { accountId: string; userId: string; reviewerName: string }
) {
  if (decision.lineNumber == null) return;

  const target = await db.shipmentLineItem.findFirst({
    where: { shipmentId: decision.shipmentId, accountId: ctx.accountId, lineNumber: decision.lineNumber },
  });
  if (!target) return;

  await FactAuditService.logChangeEvent({
    shipmentId: decision.shipmentId,
    userId: ctx.userId,
    changeType: "CLASSIFICATION_CHANGED",
    field: lineItemFactField(decision.lineNumber, "htsCode"),
    previousValue: target.htsCode,
    newValue: proposedHtsCode,
    reason: `Bulk approved via Decisions review by ${ctx.reviewerName}`,
  });

  await db.shipmentLineItem.update({
    where: { id: target.id },
    data: { htsCode: proposedHtsCode, htsConfidence: decision.confidence, status: "Valid" },
  });

  await db.shipment.update({ where: { id: decision.shipmentId }, data: { version: { increment: 1 } } });

  await FactService.record({
    shipmentId: decision.shipmentId,
    field: lineItemFactField(decision.lineNumber, "htsCode"),
    value: proposedHtsCode,
    sourceType: "USER_ENTERED",
    confidence: decision.confidence,
  });
}

const REVIEWER_SELECT = {
  firstName: true,
  lastName: true,
  email: true,
  brokerLicenseNumber: true,
} as const;

// POST /api/decisions/bulk
// Body: { decisionIds: string[], action: "APPROVE" | "REJECT", humanNotes?: string }
// Returns: { succeeded, failed, results }
export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { decisionIds, action, humanNotes } = body as {
    decisionIds: unknown;
    action: unknown;
    humanNotes?: unknown;
  };

  if (!Array.isArray(decisionIds) || decisionIds.length === 0) {
    return NextResponse.json({ error: "decisionIds must be a non-empty array" });
  }
  if (decisionIds.length > 100) {
    return NextResponse.json({ error: "Cannot bulk-act on more than 100 decisions at once" }, { status: 400 });
  }
  if (!isReviewAction(action)) {
    return NextResponse.json(
      { error: `action must be one of ${Object.keys(REVIEW_ACTIONS).join(", ")}` },
      { status: 400 }
    );
  }
  // RE_EVALUATE is a valid isReviewAction but not meaningful in bulk — each decision would need a
  // separate pipeline trigger, so block it here and let callers use the single-item endpoint.
  if (action === "RE_EVALUATE") {
    return NextResponse.json({ error: "Bulk action supports only APPROVE or REJECT" }, { status: 400 });
  }
  const ids = (decisionIds as unknown[]).filter((id): id is string => typeof id === "string" && id.trim() !== "");
  if (ids.length === 0) {
    return NextResponse.json({ error: "No valid decision IDs provided" }, { status: 400 });
  }

  const rationale = typeof humanNotes === "string" ? humanNotes.trim() : "";
  if (action === "REJECT" && rationale === "") {
    return NextResponse.json(
      { error: "humanNotes is required to bulk-reject decisions", code: "RATIONALE_REQUIRED" },
      { status: 400 }
    );
  }

  // Permission checked once upfront — any ID mismatch just shows up as a skip
  const baseCheck = checkReviewPermission(ctx, requiredPermissions(action));
  if (!baseCheck.allowed) {
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: `decision.bulk_${action.toLowerCase()}`,
      entity: "AgentDecision",
      entityId: "bulk",
      success: false,
      metadata: { reason: "PERMISSION_REQUIRED", missing: baseCheck.missing, attemptedCount: ids.length },
    });
    return NextResponse.json(
      {
        error: permissionDeniedMessage(baseCheck),
        code: "PERMISSION_REQUIRED",
        required: baseCheck.required,
        missing: baseCheck.missing,
      },
      { status: 403 }
    );
  }

  const reviewerRecord = await db.user.findUnique({
    where: { id: ctx.userId },
    select: REVIEWER_SELECT,
  });
  const reviewer = reviewerIdentity(reviewerRecord);

  // Load all matching decisions in one query
  const decisions = await db.agentDecision.findMany({
    where: { id: { in: ids }, accountId: ctx.accountId },
  });

  const decisionById = new Map(decisions.map((d) => [d.id, d]));

  const newStatus = REVIEW_ACTIONS[action];

  type BulkResult = { id: string; status: "ok" | "skipped" | "error"; reason?: string };
  const results: BulkResult[] = [];
  const affectedShipmentIds = new Set<string>();

  for (const id of ids) {
    const decision = decisionById.get(id);
    if (!decision) {
      results.push({ id, status: "skipped", reason: "not_found" });
      continue;
    }

    // Skip if already in a terminal reviewed state — idempotent sweep
    const normStatus = normalizeDecisionStatus(decision.status);
    if (
      decision.status === "Approved" ||
      decision.status === "Rejected" ||
      decision.status === "APPROVED" ||
      decision.status === "REJECTED" ||
      decision.triageState === "APPROVED" ||
      decision.triageState === "REJECTED" ||
      normStatus === "APPROVED" ||
      normStatus === "REJECTED"
    ) {
      results.push({ id, status: "skipped", reason: "already_terminal" });
      continue;
    }

    // If approving a reclassification, require the override permission
    const overridesClassification = action === "APPROVE" && isClassificationOverride(decision);
    if (overridesClassification) {
      const overrideCheck = checkReviewPermission(ctx, requiredPermissions(action, true));
      if (!overrideCheck.allowed) {
        results.push({ id, status: "skipped", reason: "insufficient_permission_for_override" });
        continue;
      }
    }

    try {
      const applied = await db.agentDecision.updateMany({
        where: { id, accountId: ctx.accountId, updatedAt: decision.updatedAt },
        data: {
          status: newStatus,
          triageState: REVIEW_TRIAGE_STATES[action],
          humanNotes: rationale === "" ? decision.humanNotes : rationale,
          reviewedByUserId: ctx.userId,
        },
      });

      if (applied.count === 0) {
        // Stale — another reviewer got there first; treat as already-done
        results.push({ id, status: "skipped", reason: "stale_version" });
        continue;
      }

      // Apply HTS code for classification approvals
      if (action === "APPROVE" && decision.proposedHtsCode) {
        await applyProposedHtsCode(decision, decision.proposedHtsCode, {
          accountId: ctx.accountId,
          userId: ctx.userId,
          reviewerName: reviewer.name || ctx.userId,
        });
      } else if (action === "REJECT" && decision.lineNumber != null) {
        await db.shipmentLineItem.updateMany({
          where: { shipmentId: decision.shipmentId, accountId: ctx.accountId, lineNumber: decision.lineNumber },
          data: { status: "Review Required" },
        });
      }

      affectedShipmentIds.add(decision.shipmentId);

      await createAuditLog({
        accountId: ctx.accountId,
        userId: ctx.userId,
        action: action === "APPROVE" ? AuditAction.DECISION_APPROVED : AuditAction.DECISION_REJECTED,
        entity: "AgentDecision",
        entityId: id,
        source: "UI",
        metadata: {
          newStatus,
          humanNotes: rationale,
          bulkAction: true,
          reviewerCapacity: reviewer.capacity,
          brokerLicenseNumber: reviewer.licenseNumber,
        },
      });

      results.push({ id, status: "ok" });
    } catch {
      results.push({ id, status: "error", reason: "internal_error" });
    }
  }

  // Reconcile each affected shipment once
  await Promise.allSettled(
    Array.from(affectedShipmentIds).map((shipmentId) =>
      ReconciliationEngine.reconcileShipment(shipmentId, ctx.accountId, "USER_FIELD_UPDATED").catch((err) => {
        console.error(`[decisions/bulk] Reconciliation failed for shipment ${shipmentId}:`, err);
      })
    )
  );

  const succeeded = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  return NextResponse.json({ succeeded, failed, skipped, results });
}, {
  permission: [
    "decisions.approve",
    "decisions.reject",
    "decisions.reevaluate",
    "decisions.override",
    "decisions.review",
  ],
  write: true,
});
