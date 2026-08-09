import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { ProviderMetadata } from "@/lib/providers";
import {
  EXCEPTION_STATES,
  isTerminalExceptionState,
  normalizeExceptionStatus,
  requiresResolutionReason,
  statusVariants,
  type ExceptionState,
} from "./exceptionState";

export interface ExceptionListQuery {
  status?: string;
  severity?: string;
  assignedToMe?: boolean;
}

export interface ExceptionUpdateInput {
  status?: string;
  assignedToUserId?: string;
  /** Null detaches the exception; a string must name a shipment in the same account. */
  shipmentId?: string | null;
  resolutionReason?: string;
  resolutionEvidence?: string;
  expectedVersion: number;
}

export const VALID_EXCEPTION_STATES: readonly string[] = EXCEPTION_STATES;

export class ExceptionService {
  static async listExceptions(accountId: string, userId: string, query: ExceptionListQuery) {
    const where: import("@prisma/client").Prisma.ExceptionItemWhereInput = { accountId };

    if (query.status && query.status !== "all") {
      const normalized = normalizeExceptionStatus(query.status);
      // An unrecognised status must not widen the result to everything.
      where.status = normalized ? { in: statusVariants(normalized) } : { in: [] };
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

  static async updateException(
    accountId: string,
    exceptionId: string,
    input: ExceptionUpdateInput,
    userId?: string | null
  ) {
    const existing = await db.exceptionItem.findFirst({
      where: { id: exceptionId, accountId },
    });

    if (!existing) {
      throw new Error("NOT_FOUND");
    }

    if (existing.version !== input.expectedVersion) {
      throw new Error("STALE_VERSION");
    }

    let nextStatus: ExceptionState | undefined;
    if (input.status) {
      const normalized = normalizeExceptionStatus(input.status);
      if (!normalized) {
        throw new Error(`Invalid exception status state: ${input.status}`);
      }
      if (requiresResolutionReason(normalized) && !input.resolutionReason?.trim()) {
        throw new Error(`A stated reason is required to move this exception to ${normalized}`);
      }
      nextStatus = normalized;
    }

    if (input.shipmentId) {
      const owned = await db.shipment.findFirst({
        where: { id: input.shipmentId, accountId },
        select: { id: true },
      });
      if (!owned) {
        throw new Error("SHIPMENT_NOT_FOUND");
      }
    }

    // There is no column for the reason, so the audit entry is the only durable
    // record of it. Write it before the status moves and fail closed: a closed
    // exception with no stated reason is the outcome this guard exists to prevent.
    if (nextStatus && requiresResolutionReason(nextStatus)) {
      await createAuditLog({
        accountId,
        userId: userId ?? null,
        action: "exception.resolve",
        entity: "ExceptionItem",
        entityId: exceptionId,
        metadata: {
          fromStatus: existing.status,
          toStatus: nextStatus,
          resolutionReason: input.resolutionReason,
          resolutionEvidence: input.resolutionEvidence ?? null,
        },
        failClosed: true,
      });
    }

    const updated = await db.exceptionItem.update({
      where: { id: exceptionId },
      data: {
        status: nextStatus,
        assignedToUserId: input.assignedToUserId !== undefined ? input.assignedToUserId : undefined,
        shipmentId: input.shipmentId !== undefined ? input.shipmentId : undefined,
        resolvedAt: nextStatus && isTerminalExceptionState(nextStatus) ? new Date() : undefined,
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
