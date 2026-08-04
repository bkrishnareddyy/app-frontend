import { db } from "./db";
import { headers } from "next/headers";

export interface CreateAuditLogParams {
  accountId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  success?: boolean;
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
    console.error("Failed to create audit log entry:", error);
    return null;
  }
}
