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
    const where: import("@prisma/client").Prisma.ExceptionItemWhereInput = { accountId };

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

  static async updateException(
    accountId: string,
    exceptionId: string,
    input: ExceptionUpdateInput,
    resolver: ExceptionResolver
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

    const isResolving = input.status?.toUpperCase() === "RESOLVED";

    if (input.status) {
      const normalizedStatus = input.status.toUpperCase();
      if (!VALID_EXCEPTION_STATES.includes(normalizedStatus)) {
        throw new Error(`Invalid exception status state: ${input.status}`);
      }
      if (isResolving && !input.resolutionReason) {
        throw new Error("Resolution reason is required when resolving an exception");
      }
    }

    const updated = await db.exceptionItem.update({
      where: { id: exceptionId },
      data: {
        status: input.status ? input.status : undefined,
        assignedToUserId: input.assignedToUserId !== undefined ? input.assignedToUserId : undefined,
        resolvedAt: isResolving ? new Date() : undefined,
        resolvedBy: isResolving ? resolver.userId : undefined,
        resolvedByName: isResolving ? resolver.name : undefined,
        resolutionNote: isResolving ? input.resolutionReason : undefined,
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
