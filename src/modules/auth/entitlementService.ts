import { db } from "@/lib/db";

export class EntitlementService {
  /**
   * Check if account has quota remaining for batch classification jobs.
   */
  static async verifyBatchQuota(accountId: string, requestedBatchSize: number = 1) {
    const account = await db.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new Error(`Account '${accountId}' not found.`);
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
      throw new Error(`Batch execution quota exceeded (${usedThisMonth}/${monthlyLimit} monthly classification cases used for account type '${account.type}'). Upgrade to Enterprise plan for increased capacity.`);
    }

    return { allowed: true, remainingQuota: monthlyLimit - usedThisMonth };
  }
}
