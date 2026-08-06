import { db } from "@/lib/db";
import { ProviderMetadata } from "@/lib/providers";

export interface ExceptionListQuery {
  status?: string;
  severity?: string;
  assignedToMe?: boolean;
}

export interface ExceptionUpdateInput {
  status?: string;
  assignedToUserId?: string;
  resolutionReason?: string;
  resolutionEvidence?: string;
  expectedVersion: number;
}

export const VALID_EXCEPTION_STATES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_IMPORTER",
  "WAITING_FOR_DOCUMENT",
  "READY_FOR_REVIEW",
  "RESOLVED",
  "WAIVED",
  "CANCELLED",
];

export class ExceptionService {
  static async listExceptions(accountId: string, userId: string, query: ExceptionListQuery) {
    const where: any = { accountId };

    if (query.status && query.status !== "all") {
      where.status = { equals: query.status, mode: "insensitive" };
    }
    if (query.severity) {
      where.severity = { equals: query.severity, mode: "insensitive" };
    }
    if (query.assignedToMe) {
      where.assignedToUserId = userId;
    }

    const exceptions = await db.exceptionItem.findMany({
      where,
      include: {
        shipment: true,
        filing: true,
        assignedToUser: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      exceptions,
      metadata: {
        providerName: "InternalExceptionEngine",
        datasetVersion: "2026.1",
        retrievedAt: new Date().toISOString(),
        completenessStatus: "COMPLETE",
      } as ProviderMetadata,
    };
  }

  static async updateException(accountId: string, exceptionId: string, input: ExceptionUpdateInput) {
    const existing = await db.exceptionItem.findFirst({
      where: { id: exceptionId, accountId },
    });

    if (!existing) {
      throw new Error("NOT_FOUND");
    }

    if (existing.version !== input.expectedVersion) {
      throw new Error("STALE_VERSION");
    }

    if (input.status) {
      const normalizedStatus = input.status.toUpperCase();
      if (!VALID_EXCEPTION_STATES.includes(normalizedStatus)) {
        throw new Error(`Invalid exception status state: ${input.status}`);
      }
      if (normalizedStatus === "RESOLVED" && !input.resolutionReason) {
        throw new Error("Resolution reason is required when resolving an exception");
      }
    }

    const updated = await db.exceptionItem.update({
      where: { id: exceptionId },
      data: {
        status: input.status ? input.status : undefined,
        assignedToUserId: input.assignedToUserId !== undefined ? input.assignedToUserId : undefined,
        resolvedAt: input.status?.toUpperCase() === "RESOLVED" ? new Date() : undefined,
        version: { increment: 1 },
      },
      include: {
        shipment: true,
        filing: true,
        assignedToUser: true,
      },
    });

    return updated;
  }
}
