import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import type { AccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { FactAuditService } from "@/modules/audit/factAuditService";
import { FactService } from "@/modules/shipment/factService";
import { lineItemFactField } from "@/modules/shipment/lineItemReconciler";
import { ReconciliationEngine } from "@/modules/shipment/reconciliationEngine";
import {
  OVERRIDE_PERMISSION,
  REVIEW_ACTIONS,
  checkReviewPermission,
  decisionProvenance,
  isClassificationOverride,
  isReviewAction,
  permissionDeniedMessage,
  requiredPermissions,
  reviewerIdentity,
} from "@/modules/decisions/reviewAuthority";
import { buildEditUpdate, readEditableValue } from "@/modules/decisions/editableFields";

const REVIEWER_SELECT = {
  firstName: true,
  lastName: true,
  email: true,
  brokerLicenseNumber: true,
} as const;

type ClassificationApplication = {
  proposedHtsCode: string;
  htsConfidence: number | null;
  updatedLineItemId: string | null;
  skippedReason: "NO_LINE_NUMBER" | "LINE_ITEM_NOT_FOUND" | null;
};

/**
 * AgentDecision now carries the lineNumber it targets (HTS Classification
 * populates one decision per line item, see htsClassificationAgent.ts), so
 * approving finds the exact ShipmentLineItem directly. The previous approach
 * matched line items by their *current* htsCode string, which meant a
 * first-ever classification -- where there is no current code to match --
 * silently did nothing even when a human clicked Approve.
 *
 * Approving is a user action on an already-populated curated field, so it
 * goes through the same version + audit path as any other manual edit:
 * bumps Shipment.version, logs a ShipmentChangeEvent, and records a
 * USER_ENTERED Fact -- never a silent agent-style write.
 */
async function applyProposedHtsCode(
  decision: { shipmentId: string; lineNumber: number | null; confidence: number | null },
  proposedHtsCode: string,
  ctx: { accountId: string; userId: string; reviewerName: string }
): Promise<ClassificationApplication> {
  if (decision.lineNumber == null) {
    return {
      proposedHtsCode,
      htsConfidence: decision.confidence,
      updatedLineItemId: null,
      skippedReason: "NO_LINE_NUMBER",
    };
  }

  const target = await db.shipmentLineItem.findFirst({
    where: { shipmentId: decision.shipmentId, accountId: ctx.accountId, lineNumber: decision.lineNumber },
  });

  if (!target) {
    return {
      proposedHtsCode,
      htsConfidence: decision.confidence,
      updatedLineItemId: null,
      skippedReason: "LINE_ITEM_NOT_FOUND",
    };
  }

  await FactAuditService.logChangeEvent({
    shipmentId: decision.shipmentId,
    userId: ctx.userId,
    changeType: "CLASSIFICATION_CHANGED",
    field: lineItemFactField(decision.lineNumber, "htsCode"),
    previousValue: target.htsCode,
    newValue: proposedHtsCode,
    reason: `Approved via Decisions review by ${ctx.reviewerName}`,
  });

  await db.shipmentLineItem.update({
    where: { id: target.id },
    // The stored confidence scored the code being replaced, so it cannot
    // follow the new one; the decision's own score is the only one that
    // applies here. Approving is what a human confirming a line looks like,
    // so the row is locked (status "Valid") from here.
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

  return {
    proposedHtsCode,
    htsConfidence: decision.confidence,
    updatedLineItemId: target.id,
    skippedReason: null,
  };
}

/**
 * Correcting a value an agent proposed is the same act as overriding a
 * classification -- a human is replacing the model's answer with their own --
 * so it is gated by the same decisions.override permission rather than a new
 * one, and reuses the decision.<verb> audit action naming.
 */
async function handleEditValue(ctx: AccountContext, body: unknown) {
  const { decisionId, fieldKey, value } =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  if (typeof decisionId !== "string" || decisionId.trim() === "") {
    return NextResponse.json({ error: "decisionId is required" }, { status: 400 });
  }
  if (typeof fieldKey !== "string" || fieldKey.trim() === "") {
    return NextResponse.json({ error: "fieldKey is required" }, { status: 400 });
  }
  if (typeof value !== "string" || value.trim() === "") {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }

  const check = checkReviewPermission(ctx, [OVERRIDE_PERMISSION]);
  if (!check.allowed) {
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "decision.edit_value",
      entity: "AgentDecision",
      entityId: decisionId,
      success: false,
      metadata: { reason: "PERMISSION_REQUIRED", missing: check.missing, fieldKey },
    });
    return NextResponse.json(
      {
        error: permissionDeniedMessage(check),
        code: "PERMISSION_REQUIRED",
        required: check.required,
        missing: check.missing,
      },
      { status: 403 }
    );
  }

  const decision = await db.agentDecision.findFirst({
    where: { id: decisionId, accountId: ctx.accountId },
  });
  if (!decision) {
    return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  }

  const trimmedKey = fieldKey.trim();
  const trimmedValue = value.trim();
  const update = buildEditUpdate(decision, trimmedKey, trimmedValue);
  if (!update) {
    return NextResponse.json(
      { error: `"${trimmedKey}" is not an editable field on this decision` },
      { status: 400 }
    );
  }

  const previousValue = readEditableValue(decision, trimmedKey);

  await db.agentDecision.update({
    where: { id: decisionId },
    data: update as unknown as Prisma.AgentDecisionUpdateInput,
  });

  const updatedDecision = await db.agentDecision.findFirst({
    where: { id: decisionId, accountId: ctx.accountId },
    include: { reviewedByUser: { select: REVIEWER_SELECT } },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "decision.edit_value",
    entity: "AgentDecision",
    entityId: decisionId,
    metadata: { fieldKey: trimmedKey, previousValue, newValue: trimmedValue },
  });

  return NextResponse.json({
    decision: updatedDecision,
    provenance: updatedDecision ? decisionProvenance(updatedDecision) : null,
  });
}

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const decisions = await db.agentDecision.findMany({
    where: { accountId: ctx.accountId },
    include: {
      shipment: true,
      reviewedByUser: { select: REVIEWER_SELECT },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    decisions: decisions.map((decision) => ({
      ...decision,
      provenance: decisionProvenance(decision),
    })),
  });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { decisionId, action, humanNotes, expectedVersion } = body;

  if (action === "EDIT_VALUE") {
    return handleEditValue(ctx, body);
  }

  // An unrecognised action used to fall through to "In Progress" and then throw
  // on action.toLowerCase(), so the decision was mutated and no audit log written.
  if (!isReviewAction(action)) {
    return NextResponse.json(
      { error: `action must be one of ${Object.keys(REVIEW_ACTIONS).join(", ")}` },
      { status: 400 }
    );
  }

  // Prisma drops an undefined filter, so a missing id would match an arbitrary decision.
  if (typeof decisionId !== "string" || decisionId.trim() === "") {
    return NextResponse.json({ error: "decisionId is required" }, { status: 400 });
  }

  // The base permission is checked before the decision is read, so a caller
  // who may not review anything cannot use this endpoint to probe for ids.
  const baseCheck = checkReviewPermission(ctx, requiredPermissions(action));
  if (!baseCheck.allowed) {
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: `decision.${action.toLowerCase()}`,
      entity: "AgentDecision",
      entityId: decisionId,
      success: false,
      metadata: { reason: "PERMISSION_REQUIRED", missing: baseCheck.missing },
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

  const rationale = typeof humanNotes === "string" ? humanNotes.trim() : "";

  // A rejection or an override of the proposed code is a legal position the
  // account has to be able to defend later, so the reason is not optional.
  if (action === "REJECT" && rationale === "") {
    return NextResponse.json(
      { error: "humanNotes is required to reject a decision", code: "RATIONALE_REQUIRED" },
      { status: 400 }
    );
  }

  const decision = await db.agentDecision.findFirst({
    where: { id: decisionId, accountId: ctx.accountId },
  });

  if (!decision) {
    return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  }

  // Replacing a code already on the record is a different act from accepting a
  // first classification, so it is gated separately now that the codes are known.
  const overridesClassification = action === "APPROVE" && isClassificationOverride(decision);
  const overrideCheck = checkReviewPermission(
    ctx,
    requiredPermissions(action, overridesClassification)
  );
  if (!overrideCheck.allowed) {
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: `decision.${action.toLowerCase()}`,
      entity: "AgentDecision",
      entityId: decisionId,
      success: false,
      metadata: { reason: "PERMISSION_REQUIRED", missing: overrideCheck.missing },
    });
    return NextResponse.json(
      {
        error: permissionDeniedMessage(overrideCheck),
        code: "PERMISSION_REQUIRED",
        required: overrideCheck.required,
        missing: overrideCheck.missing,
      },
      { status: 403 }
    );
  }

  // A broker license is what separates a broker sign-off from an operator's
  // note, and it lives on the user row rather than in the session context.
  const reviewerRecord = await db.user.findUnique({
    where: { id: ctx.userId },
    select: REVIEWER_SELECT,
  });
  const reviewer = reviewerIdentity(reviewerRecord);

  const newStatus = REVIEW_ACTIONS[action];

  // Two reviewers opening the same decision both used to win. Claiming the row
  // with a conditional update is the lock, so it has to happen before any line
  // item is rewritten; otherwise the loser still changes the classification.
  const guard =
    typeof expectedVersion === "string" ? new Date(expectedVersion) : decision.updatedAt;

  const applied = await db.agentDecision.updateMany({
    where: { id: decisionId, accountId: ctx.accountId, updatedAt: guard },
    data: {
      status: newStatus,
      humanNotes: rationale === "" ? decision.humanNotes : rationale,
      reviewedByUserId: ctx.userId,
    },
  });

  if (applied.count === 0) {
    const current = await db.agentDecision.findFirst({
      where: { id: decisionId, accountId: ctx.accountId },
      select: { status: true, updatedAt: true },
    });
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: `decision.${action.toLowerCase()}`,
      entity: "AgentDecision",
      entityId: decisionId,
      success: false,
      metadata: { reason: "STALE_DECISION", attemptedStatus: newStatus },
    });
    return NextResponse.json(
      {
        error: "This decision changed since it was opened. Reload before reviewing it again.",
        code: "STALE_DECISION",
        currentStatus: current?.status ?? null,
        currentVersion: current?.updatedAt ?? null,
      },
      { status: 409 }
    );
  }

  // Approving a reclassification used to change only the decision row, so the
  // line items kept the code the reviewer had just rejected.
  let classificationApplied: ClassificationApplication | null = null;
  if (action === "APPROVE" && decision.proposedHtsCode) {
    classificationApplied = await applyProposedHtsCode(decision, decision.proposedHtsCode, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      reviewerName: reviewer.name || ctx.userId,
    });
  } else if (action === "REJECT" && decision.lineNumber != null) {
    // Nothing on the curated record changed -- just flagged back for
    // re-review -- so this does not bump Shipment.version.
    await db.shipmentLineItem.updateMany({
      where: { shipmentId: decision.shipmentId, accountId: ctx.accountId, lineNumber: decision.lineNumber },
      data: { status: "Review Required" },
    });
  }

  // Resolves HTS_REVIEW_REQUIRED (and any other now-stale exception) against
  // the line item state this review action just produced, instead of
  // leaving it to wait for the next pipeline trigger.
  await ReconciliationEngine.reconcileShipment(decision.shipmentId, "USER_FIELD_UPDATED").catch((err) => {
    console.error("[decisions/route] Reconciliation after review failed:", err);
  });

  const updatedDecision = await db.agentDecision.findFirst({
    where: { id: decisionId, accountId: ctx.accountId },
    include: { reviewedByUser: { select: REVIEWER_SELECT } },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: `decision.${action.toLowerCase()}`,
    entity: "AgentDecision",
    entityId: decisionId,
    metadata: {
      newStatus,
      humanNotes: rationale,
      classificationApplied,
      overridesClassification,
      reviewerCapacity: reviewer.capacity,
      brokerLicenseNumber: reviewer.licenseNumber,
      permissionBypass: overrideCheck.bypass,
    },
  });

  return NextResponse.json({
    decision: updatedDecision,
    classificationApplied,
    provenance: updatedDecision ? decisionProvenance(updatedDecision) : null,
    reviewedAs: reviewer,
    overridesClassification,
  });
}, { write: true });
