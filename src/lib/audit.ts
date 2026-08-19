import { db } from "./db";
import { headers } from "next/headers";
import { AuditAction } from "./audit/auditActions";

export { AuditAction };
export { diff } from "./audit/diffHelper";
export type AuditSource = "UI" | "CHAT" | "SYSTEM" | "API";

/**
 * QPR-008 Immutable Audit Trail:
 * AuditLog is legally append-only. Under no circumstances should an UPDATE or DELETE
 * query be run on the AuditLog model/table. Row-level security on PostgreSQL
 * (migration 20260814000000_audit_log_rls) enforces this constraint.
 */
export function assertAppendOnlyAuditPolicy(operation: "INSERT" | "UPDATE" | "DELETE" = "INSERT"): boolean {
  if (operation !== "INSERT") {
    throw new Error(`AuditLog mutation violation: ${operation} operation prohibited on append-only audit trail.`);
  }
  return true;
}

export interface CreateAuditLogParams {
  accountId: string;
  userId?: string | null;
  action: AuditAction | string;
  entity: string;
  entityId: string;
  /** Provenance source: "UI" (default), "CHAT" (copilot), "SYSTEM" (cron/worker), "API" (external API) */
  source?: AuditSource | string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * Snapshot of the record BEFORE the mutation (for immutable evidence trail).
   * The AuditLog table has no dedicated column for this — it's persisted as
   * `metadata.beforeJson` alongside any caller-supplied `metadata`.
   */
  beforeJson?: Record<string, unknown> | null;
  /** Snapshot of the record AFTER the mutation. Persisted as `metadata.afterJson`. */
  afterJson?: Record<string, unknown> | null;
  /** Correlation ID linking related audit events across a single user operation. */
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  success?: boolean;
  /**
   * When true, throws on audit failure instead of swallowing it.
   * Use this for consequential mutations (filings, transmissions, drawback claims)
   * by wrapping the audit call + business write in a db.$transaction.
   * QPR-008: audit logging for consequential mutations must be transactional/fail-closed.
   */
  failClosed?: boolean;
}

export async function createAuditLog(params: CreateAuditLogParams) {
  try {
    let ipAddress = params.ipAddress;
    let userAgent = params.userAgent;
    let headerSource: AuditSource | null = null;

    try {
      const headerList = await headers();
      if (!ipAddress) {
        ipAddress =
          headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          headerList.get("x-real-ip") ||
          null;
      }
      if (!userAgent) {
        userAgent = headerList.get("user-agent") || null;
      }
      const xSource = headerList.get("x-qubere-source") || headerList.get("x-audit-source");
      if (xSource === "CHAT" || xSource === "SYSTEM" || xSource === "API" || xSource === "UI") {
        headerSource = xSource as AuditSource;
      }
    } catch {
      // Ignore if called outside request context
    }

    const metadata: Record<string, unknown> | undefined =
      params.metadata || params.beforeJson || params.afterJson
        ? {
            ...(params.metadata ?? {}),
            ...(params.beforeJson ? { beforeJson: params.beforeJson } : {}),
            ...(params.afterJson ? { afterJson: params.afterJson } : {}),
          }
        : undefined;

    const resolvedSource =
      params.source && params.source !== "UI"
        ? params.source
        : (headerSource ?? params.source ?? "UI");

    return await db.auditLog.create({
      data: {
        accountId: params.accountId,
        userId: params.userId ?? null,
        action: String(params.action),
        entity: params.entity,
        entityId: params.entityId,
        source: resolvedSource,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        requestId: params.requestId || null,
        success: params.success ?? true,
      },
    });
  } catch (error) {
    if (params.failClosed) {
      throw error;
    }
    console.error("Failed to create audit log entry:", error);
    return null;
  }
}



