import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface CreateCaseParams {
  accountId: string;
  requestedByUserId: string;
  externalReference?: string;
  priority?: string;
  rawDescription: string;
  structuredAttributesJson?: Prisma.InputJsonObject;
  countryOfOrigin?: string;
  intendedUse?: string;
}

export class ClassificationCaseRepository {
  /**
   * Create a new tenant-isolated classification case.
   */
  static async createCase(params: CreateCaseParams) {
    return db.classificationCase.create({
      data: {
        accountId: params.accountId,
        requestedByUserId: params.requestedByUserId,
        externalReference: params.externalReference,
        priority: params.priority || "MEDIUM",
        status: "DRAFT",
        subjects: {
          create: [
            {
              rawDescription: params.rawDescription,
              structuredAttributesJson: params.structuredAttributesJson || {},
              countryOfOrigin: params.countryOfOrigin,
              intendedUse: params.intendedUse,
            },
          ],
        },
      },
      include: {
        subjects: true,
        documents: true,
      },
    });
  }

  /**
   * Get case by ID with full tenant scoping.
   */
  static async getById(accountId: string, caseId: string) {
    return db.classificationCase.findFirst({
      where: {
        id: caseId,
        accountId,
      },
      include: {
        subjects: true,
        documents: true,
        extractedFacts: true,
        runs: {
          include: {
            proposals: {
              include: {
                proposedNode: {
                  include: { dutyRates: true },
                },
                griSteps: true,
                evidenceItems: true,
              },
            },
          },
        },
        decisions: {
          include: {
            approvedNode: true,
          },
        },
      },
    });
  }

  /**
   * Update classification case status atomically.
   */
  static async updateStatus(accountId: string, caseId: string, status: string) {
    return db.classificationCase.updateMany({
      where: {
        id: caseId,
        accountId,
      },
      data: {
        status,
        updatedAt: new Date(),
      },
    });
  }
}
