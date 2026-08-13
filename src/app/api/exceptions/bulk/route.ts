import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { hasPermission } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { ExceptionService } from "@/modules/exceptions/exception.service";
import { RISK_ACCEPTANCE_PERMISSION, isRiskAcceptance, normalizeExceptionStatus } from "@/modules/exceptions/exceptionState";

// PATCH /api/exceptions/bulk
// Body: { exceptionIds: string[], status: "RESOLVED" | "WAIVED", resolutionReason: string, resolutionReasonCode?: string }
// Returns: { succeeded, failed, skipped, results }
export const PATCH = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { exceptionIds, status, resolutionReason, resolutionReasonCode } = body as {
    exceptionIds: unknown;
    status: unknown;
    resolutionReason?: unknown;
    resolutionReasonCode?: unknown;
  };

  if (!Array.isArray(exceptionIds) || exceptionIds.length === 0) {
    return NextResponse.json({ error: "exceptionIds must be a non-empty array" }, { status: 400 });
  }
  if (exceptionIds.length > 100) {
    return NextResponse.json({ error: "Cannot bulk-act on more than 100 exceptions at once" }, { status: 400 });
  }
  const ids = (exceptionIds as unknown[]).filter((id): id is string => typeof id === "string" && id.trim() !== "");
  if (ids.length === 0) {
    return NextResponse.json({ error: "No valid exception IDs provided" }, { status: 400 });
  }

  const requestedState = normalizeExceptionStatus(typeof status === "string" ? status : undefined);
  if (!requestedState) {
    return NextResponse.json({ error: "status must be RESOLVED or WAIVED" }, { status: 400 });
  }

  const reason = typeof resolutionReason === "string" ? resolutionReason.trim() : "";
  if (!reason) {
    return NextResponse.json(
      { error: "resolutionReason is required for bulk exception resolution", code: "RATIONALE_REQUIRED" },
      { status: 400 }
    );
  }

  const code = typeof resolutionReasonCode === "string" ? resolutionReasonCode.trim() : undefined;

  // WAIVED requires risk acceptance permission
  if (isRiskAcceptance(requestedState)) {
    const allowed = await hasPermission(RISK_ACCEPTANCE_PERMISSION);
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Waiving exceptions accepts risk on the account's behalf. Missing required permission: ${RISK_ACCEPTANCE_PERMISSION}`,
          code: "FORBIDDEN",
        },
        { status: 403 }
      );
    }
  }

  const resolverName = [ctx.firstName, ctx.lastName].filter(Boolean).join(" ") || ctx.email;

  type BulkResult = { id: string; status: "ok" | "skipped" | "error"; reason?: string };
  const results: BulkResult[] = [];

  for (const id of ids) {
    try {
      // Fetch current version for the optimistic lock in ExceptionService
      const existing = await db.exceptionItem.findFirst({
        where: { id, accountId: ctx.accountId },
        select: { version: true, status: true },
      });

      if (!existing) {
        results.push({ id, status: "skipped", reason: "not_found" });
        continue;
      }

      // Skip already-closed exceptions
      const currentNorm = normalizeExceptionStatus(existing.status ?? undefined);
      if (currentNorm === "RESOLVED" || currentNorm === "WAIVED") {
        results.push({ id, status: "skipped", reason: "already_closed" });
        continue;
      }

      await ExceptionService.updateException(
        ctx.accountId,
        id,
        {
          status: requestedState,
          resolutionReason: reason,
          resolutionReasonCode: code,
          expectedVersion: existing.version,
        },
        { userId: ctx.userId, name: resolverName }
      );

      await createAuditLog({
        accountId: ctx.accountId,
        userId: ctx.userId,
        action: "exception.update",
        entity: "ExceptionItem",
        entityId: id,
        source: "UI",
        metadata: { newStatus: requestedState, bulkAction: true, resolutionReason: reason, resolutionReasonCode: code },
      });

      results.push({ id, status: "ok" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "STALE_VERSION") {
        results.push({ id, status: "skipped", reason: "stale_version" });
      } else {
        results.push({ id, status: "error", reason: msg });
      }
    }
  }

  const succeeded = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  return NextResponse.json({ succeeded, failed, skipped, results });

}, { permission: "exceptions.resolve", write: true });

export const POST = PATCH;

