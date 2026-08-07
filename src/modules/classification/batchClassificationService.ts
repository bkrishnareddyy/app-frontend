import { EntitlementService } from "@/modules/auth/entitlementService";
import { ClassificationCaseEngine } from "./classificationCaseEngine";

export interface BatchItemInput {
  rawDescription: string;
  externalReference?: string;
  countryOfOrigin?: string;
  intendedUse?: string;
  materialComposition?: string;
  functionUsage?: string;
}

export class BatchClassificationService {
  /**
   * Submit a batch of items for asynchronous classification with quota validation.
   */
  static async submitBatch(accountId: string, userId: string, items: BatchItemInput[]) {
    if (!items || items.length === 0) {
      throw new Error("Batch items array cannot be empty.");
    }

    // Verify account entitlement quota
    await EntitlementService.verifyBatchQuota(accountId, items.length);

    const createdCases = [];
    for (const item of items) {
      const caseRes = await ClassificationCaseEngine.createCase({
        accountId,
        userId,
        rawDescription: item.rawDescription,
        externalReference: item.externalReference,
        countryOfOrigin: item.countryOfOrigin,
        intendedUse: item.intendedUse,
        structuredAttributesJson: {
          materialComposition: item.materialComposition,
          functionUsage: item.functionUsage,
        },
      });
      createdCases.push(caseRes);
    }

    return {
      batchId: `batch_${Date.now()}`,
      totalItems: createdCases.length,
      cases: createdCases.map((c) => ({ caseId: c.classificationCase.id, jobId: c.jobId })),
    };
  }
}
