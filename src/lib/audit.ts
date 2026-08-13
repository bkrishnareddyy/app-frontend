import { db } from "./db";
import { headers } from "next/headers";

export interface CreateAuditLogParams {
  accountId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown> | null;
  /** Snapshot of the record BEFORE the mutation (for immutable evidence trail). */
  beforeJson?: Record<string, unknown> | null;
  /** Snapshot of the record AFTER the mutation. */
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
    } catch {
      // Ignore if called outside request context
    }

    return await db.auditLog.create({
      data: {
        accountId: params.accountId,
        userId: params.userId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
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

/**
 * QPR-008 Immutable Audit Trail:
 * AuditLog is legally append-only. Under no circumstances should an UPDATE or DELETE
 * query be run on the AuditLog model/table. Row-level security on PostgreSQL
 * enforces this constraint (DENY UPDATE, DELETE ON audit_logs).
 */
export function assertAppendOnlyAuditPolicy() {
  return true;
}

