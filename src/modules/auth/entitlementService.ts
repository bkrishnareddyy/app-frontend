import { db } from "@/lib/db";
import { DomainError } from "@/lib/api/error";

export class EntitlementService {
  /**
   * Check if account has quota remaining for batch classification jobs.
   */
  static async verifyBatchQuota(accountId: string, requestedBatchSize: number = 1) {
    const account = await db.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new DomainError(`Account '${accountId}' not found.`, "ACCOUNT_NOT_FOUND", 404);
    }

    const monthlyLimit = account.type === "ENTERPRISE" ? 10000 : 100;

    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const usedThisMonth = await db.classificationCase.count({
      where: {
        accountId,
        createdAt: { gte: firstDayOfMonth },
      },
    });

    if (usedThisMonth + requestedBatchSize > monthlyLimit) {
      throw new DomainError(
        `Batch execution quota exceeded (${usedThisMonth}/${monthlyLimit} monthly classification cases used for account type '${account.type}'). Upgrade to Enterprise plan for increased capacity.`,
        "QUOTA_EXCEEDED",
        429
      );
    }

    return { allowed: true, remainingQuota: monthlyLimit - usedThisMonth };
  }
}
