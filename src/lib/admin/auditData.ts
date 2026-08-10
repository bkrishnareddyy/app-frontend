import { db } from "@/lib/db";
import type { AccountContext } from "@/lib/auth";

export interface FormattedAuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
  userEmail: string | null;
}

export interface SettingsAuditData {
  auditLogs: FormattedAuditLog[];
}

export async function getSettingsAuditData(ctx: AccountContext): Promise<SettingsAuditData> {
  const auditLogs = await db.auditLog.findMany({
    where: { accountId: ctx.accountId },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return {
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString(),
      userEmail: log.user?.email ?? null,
    })),
  };
}
