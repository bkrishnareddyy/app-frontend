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
import { validateReasonCode, isRiskAcceptanceReason, type ExceptionCategory } from "./resolutionReasons";

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
  /** Picklist code from resolutionReasons.ts. Must be valid for the exception's category. */
  resolutionReasonCode?: string;
  resolutionEvidence?: string;
  expectedVersion: number;
}

export interface ExceptionResolver {
  userId: string;
  name: string;
}

// Fields Document Intelligence extracts on every document and that have a
// real place to be written back to (see field-review route) -- kept in one
// place so the label shown to users always matches the fieldKey used to
// group/resolve exceptions.
export const DOCUMENT_FIELD_LABELS: Record<string, string> = {
  exporterName: "Exporter Name",
  importerName: "Importer / Consignee Name",
  originCountry: "Country of Origin",
};

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
      omit: { resolutionReasonCode: true },
      include: {
        shipment: { omit: { filingDeadline: true } },
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
    resolver?: ExceptionResolver | null
  ) {
    const existing = await db.exceptionItem.findFirst({
      where: { id: exceptionId, accountId },
      omit: { resolutionReasonCode: true },
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
      // Validate the picklist code when provided.
      if (input.resolutionReasonCode?.trim()) {
        const category = (existing.category as ExceptionCategory | null) ?? null;
        const codeError = validateReasonCode(input.resolutionReasonCode.trim(), category);
        if (codeError) throw new Error(codeError);
        // A risk-acceptance reason code requires the WAIVED status.
        if (isRiskAcceptanceReason(input.resolutionReasonCode.trim()) && normalized !== "WAIVED") {
          throw new Error(`Reason code "${input.resolutionReasonCode}" is a risk acceptance and requires WAIVED status.`);
        }
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

    // The audit entry records the reason alongside the transition itself, and it
    // fails closed: a closed exception with no stated reason is the outcome this
    // guard exists to prevent.
    const isClosing = Boolean(nextStatus && isTerminalExceptionState(nextStatus));
    if (nextStatus && requiresResolutionReason(nextStatus)) {
      await createAuditLog({
        accountId,
        userId: resolver?.userId ?? null,
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
        resolvedAt: isClosing ? new Date() : undefined,
        resolvedBy: isClosing ? resolver?.userId : undefined,
        resolvedByName: isClosing ? resolver?.name : undefined,
        resolutionNote: isClosing ? input.resolutionReason : undefined,
        resolutionReasonCode: isClosing && input.resolutionReasonCode?.trim()
          ? input.resolutionReasonCode.trim()
          : undefined,
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

  /**
   * Keeps per-document field exceptions in sync with the latest extraction
   * for one document: opens an exception for each expected field that's
   * still missing, and auto-resolves any that are now present (e.g. after
   * a document was re-processed). Never touches fields that were never in
   * DOCUMENT_FIELD_LABELS -- this is intentionally narrow, not a general
   * validation engine.
   */
  static async syncDocumentFieldExceptions(input: {
    accountId: string;
    shipmentId: string;
    documentId: string;
    fileName: string;
    fields: Record<string, string | null | undefined>;
  }) {
    for (const fieldKey of Object.keys(DOCUMENT_FIELD_LABELS)) {
      const value = input.fields[fieldKey];
      const label = DOCUMENT_FIELD_LABELS[fieldKey];

      const existingOpen = await db.exceptionItem.findFirst({
        where: { documentId: input.documentId, fieldKey, status: { not: "Resolved" } },
        omit: { resolutionReasonCode: true },
      });

      if (!value) {
        if (!existingOpen) {
          await db.exceptionItem.create({
            data: {
              accountId: input.accountId,
              shipmentId: input.shipmentId,
              documentId: input.documentId,
              fieldKey,
              code: `MISSING_FIELD:${fieldKey}`,
              category: "MISSING_DATA",
              type: "missing_document",
              severity: "Medium",
              blocking: false,
              description: `${label} was not found on ${input.fileName}.`,
              requiredAction: `Provide ${label} or confirm it's not applicable.`,
              sourceAgent: "Document Intelligence Agent",
            },
          });
        }
      } else if (existingOpen) {
        await db.exceptionItem.update({
          where: { id: existingOpen.id },
          data: {
            status: "Resolved",
            resolvedAt: new Date(),
            resolvedBy: "SYSTEM",
            resolvedByName: "Automated re-extraction",
            resolutionNote: `${label} was found on reprocessing: "${value}".`,
          },
        });
      }
    }
  }

  /**
   * Resolves the open exception (if any) for one document field, with real
   * approver identity -- used by the field-review route so approving/editing
   * a field also clears its exception instead of leaving a stale duplicate.
   */
  static async resolveDocumentFieldException(
    documentId: string,
    fieldKey: string,
    resolver: ExceptionResolver,
    note: string
  ) {
    const existingOpen = await db.exceptionItem.findFirst({
      where: { documentId, fieldKey, status: { not: "Resolved" } },
      omit: { resolutionReasonCode: true },
    });
    if (!existingOpen) return null;

    return db.exceptionItem.update({
      where: { id: existingOpen.id },
      data: {
        status: "Resolved",
        resolvedAt: new Date(),
        resolvedBy: resolver.userId,
        resolvedByName: resolver.name,
        resolutionNote: note,
      },
    });
  }
}
