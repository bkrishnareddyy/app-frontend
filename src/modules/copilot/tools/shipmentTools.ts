/**
 * Shipment tools.
 *
 * Shipments have no service layer of their own — the console composes Prisma
 * reads behind `buildShipmentWhere`, which writes `accountId` first and cannot
 * be widened by any parameter. These tools use the same builder, and the two
 * direct reads below carry the same `accountId` and `deletedAt: null` filter
 * that the shipment workspace does.
 *
 * `getShipmentFilingReadiness` is the Copilot's answer to "can I file this?".
 * It does not ask the model to judge readiness. It runs
 * `evaluateFilingReadiness`, the same pure evaluator the filing module owns,
 * and returns its blockers verbatim — including its count of checks actually
 * performed, so an answer cannot imply that bond or PGA status was verified
 * when no column carries it.
 */

import { z } from "zod";
import { db } from "@/lib/db";
import {
  buildShipmentOrderBy,
  buildShipmentWhere,
  parseShipmentQuery,
} from "@/modules/shipments/shipmentQuery";
import {
  FILING_READINESS_MAX_CHECKS,
  evaluateFilingReadiness,
} from "@/modules/filing/filingReadiness";
import { openStatusVariants } from "@/modules/exceptions/exceptionState";
import { COPILOT_LIMITS } from "../copilotConfig";
import { capped, isoDate, isoDay, numeric, text } from "../copilotProjection";
import { defineTool } from "../copilotToolTypes";
import { integerParam, params, stringParam } from "../copilotToolSchema";

const SHIPMENTS_NAV = "/app/shipments";

/** Open exception statuses, taken from the module that owns the vocabulary. */
const OPEN_EXCEPTION_STATUSES = openStatusVariants();

const searchInput = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  health: z.enum(["Healthy", "At Risk", "Critical"]).optional(),
  limit: z.number().int().min(1).max(COPILOT_LIMITS.maxSearchResults).optional(),
});

export const searchShipmentsTool = defineTool<z.infer<typeof searchInput>>({
  name: "searchShipments",
  description:
    "Search shipments in the signed-in account by shipment number, importer name, PO reference or port of entry. Returns a bounded list of summaries with status and readiness score.",
  progressLabel: "Searching shipments",
  access: { navHref: SHIPMENTS_NAV },
  input: searchInput,
  parameters: params({
    query: stringParam("Free text: shipment number, importer name, PO reference or port of entry."),
    status: stringParam("Shipment status, e.g. Draft, In Progress, Ready to File, On Hold, Submitted, Completed."),
    health: stringParam("Health status.", { values: ["Healthy", "At Risk", "Critical"] }),
    limit: integerParam("Maximum rows to return.", { min: 1, max: COPILOT_LIMITS.maxSearchResults }),
  }),

  async execute(ctx, input) {
    const limit = input.limit ?? COPILOT_LIMITS.maxSearchResults;
    const search = new URLSearchParams();
    if (input.query) search.set("q", input.query);
    if (input.status) search.set("status", input.status);
    if (input.health) search.set("health", input.health);
    search.set("pageSize", String(limit));

    const query = parseShipmentQuery(search);
    const where = buildShipmentWhere(ctx.actor.accountId, query);

    const [rows, total] = await Promise.all([
      db.shipment.findMany({
        where,
        orderBy: buildShipmentOrderBy(query),
        take: limit,
        select: {
          id: true,
          shipmentNumber: true,
          importerName: true,
          status: true,
          healthStatus: true,
          readinessScore: true,
          portOfEntry: true,
          entryType: true,
          estimatedArrival: true,
          updatedAt: true,
        },
      }),
      db.shipment.count({ where }),
    ]);

    const shipments = rows.map((row) => {
      ctx.ledger.recordEntity("SHIPMENT", row.id, row.shipmentNumber);
      return {
        shipmentId: row.id,
        shipmentNumber: row.shipmentNumber,
        importerName: row.importerName,
        status: row.status,
        healthStatus: row.healthStatus,
        readinessScore: row.readinessScore,
        portOfEntry: row.portOfEntry,
        entryType: row.entryType,
        estimatedArrival: isoDay(row.estimatedArrival),
        updatedAt: isoDay(row.updatedAt),
      };
    });

    return {
      ok: true,
      data: {
        totalMatching: total,
        returned: shipments.length,
        truncated: total > shipments.length,
        shipments,
      },
    };
  },
});

const shipmentIdInput = z.object({ shipmentId: z.string().trim().min(1).max(64) });

export const getShipmentTool = defineTool<z.infer<typeof shipmentIdInput>>({
  name: "getShipment",
  description:
    "Detail for one shipment: header data, line items with their classification and declared origin, documents on file, open exceptions and recent agent decisions.",
  progressLabel: "Reading shipment",
  access: { navHref: SHIPMENTS_NAV },
  input: shipmentIdInput,
  parameters: params({ shipmentId: stringParam("The Qubere shipment id.") }, ["shipmentId"]),

  async execute(ctx, input) {
    const shipment = await db.shipment.findFirst({
      where: { id: input.shipmentId, accountId: ctx.actor.accountId, deletedAt: null },
      include: {
        lineItems: { orderBy: { lineNumber: "asc" }, take: 25 },
        documents: { orderBy: { createdAt: "desc" }, take: 15 },
        exceptionItems: {
          where: { status: { in: OPEN_EXCEPTION_STATUSES } },
          orderBy: { createdAt: "desc" },
          take: 15,
        },
        agentDecisions: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });

    if (!shipment) {
      return { ok: false, code: "NOT_FOUND", message: "No such shipment in this account." };
    }

    ctx.ledger.recordEntity("SHIPMENT", shipment.id, shipment.shipmentNumber);
    for (const doc of shipment.documents) {
      ctx.ledger.recordEntity("DOCUMENT", doc.id, doc.fileName);
    }
    for (const exception of shipment.exceptionItems) {
      ctx.ledger.recordEntity("EXCEPTION", exception.id, text(exception.description, 60) ?? exception.type);
    }
    for (const decision of shipment.agentDecisions) {
      ctx.ledger.recordEntity("DECISION", decision.id, `${decision.agentName}: ${decision.decisionSummary}`.slice(0, 80));
    }

    const lines = capped(shipment.lineItems, 25, (line) => ({
      lineNumber: line.lineNumber,
      description: text(line.description, 160),
      partNumber: line.partNumber,
      quantity: line.quantity,
      unitPrice: numeric(line.unitPrice),
      totalValue: numeric(line.totalValue),
      htsCode: line.htsCode || null,
      htsConfidence: line.htsConfidence,
      // The value declared on this line, which is a declaration and not a
      // determination. Product-level origin is answered by getProduct.
      declaredCountryOfOrigin: line.countryOfOrigin || null,
      status: line.status,
      linkedProductId: line.productId,
    }));

    return {
      ok: true,
      data: {
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        importerName: shipment.importerName,
        hasImporterOfRecord: shipment.importerOfRecordId !== null,
        status: shipment.status,
        healthStatus: shipment.healthStatus,
        readinessScore: shipment.readinessScore,
        riskScore: shipment.riskScore,
        entryType: shipment.entryType,
        incoterm: shipment.incoterm,
        portOfEntry: shipment.portOfEntry,
        carrierName: shipment.carrierName,
        countryOfExport: shipment.countryOfExport,
        shipmentDeclaredCountryOfOrigin: shipment.countryOfOrigin,
        poReference: shipment.poReference,
        estimatedArrival: isoDay(shipment.estimatedArrival),
        lineItemCount: shipment.lineItems.length,
        lineItems: lines.items,
        lineItemsTruncated: lines.truncated,
        documents: shipment.documents.map((doc) => ({
          documentId: doc.id,
          fileName: doc.fileName,
          docType: doc.docType,
          status: doc.status,
          extractionConfidence: doc.confidence,
          receivedAt: isoDay(doc.createdAt),
        })),
        openExceptions: shipment.exceptionItems.map((exception) => ({
          exceptionId: exception.id,
          type: exception.type,
          severity: exception.severity,
          status: exception.status,
          blocking: exception.blocking,
          description: text(exception.description, 200),
          requiredAction: text(exception.requiredAction, 200),
        })),
        recentDecisions: shipment.agentDecisions.map((decision) => ({
          decisionId: decision.id,
          agentName: decision.agentName,
          status: decision.status,
          confidence: decision.confidence,
          summary: text(decision.decisionSummary, 200),
          createdAt: isoDay(decision.createdAt),
        })),
        updatedAt: isoDate(shipment.updatedAt),
      },
    };
  },
});

export const getShipmentFilingReadinessTool = defineTool<z.infer<typeof shipmentIdInput>>({
  name: "getShipmentFilingReadiness",
  description:
    "Whether one shipment can be filed right now, and if not, exactly what is missing. Returns the blockers Qubere computed together with how many checks were actually run.",
  progressLabel: "Checking filing readiness",
  access: { navHref: SHIPMENTS_NAV },
  input: shipmentIdInput,
  parameters: params({ shipmentId: stringParam("The Qubere shipment id.") }, ["shipmentId"]),

  async execute(ctx, input) {
    const shipment = await db.shipment.findFirst({
      where: { id: input.shipmentId, accountId: ctx.actor.accountId, deletedAt: null },
      select: {
        id: true,
        shipmentNumber: true,
        importerOfRecordId: true,
        entryType: true,
        status: true,
        lineItems: {
          orderBy: { lineNumber: "asc" },
          select: { lineNumber: true, htsCode: true, countryOfOrigin: true },
        },
        documents: { select: { docType: true, status: true } },
        exceptionItems: {
          where: { status: { in: OPEN_EXCEPTION_STATUSES } },
          select: { severity: true },
        },
        reconciliationIssues: { where: { status: "Open" }, select: { severity: true } },
      },
    });

    if (!shipment) {
      return { ok: false, code: "NOT_FOUND", message: "No such shipment in this account." };
    }

    const readiness = evaluateFilingReadiness({
      importerOfRecordId: shipment.importerOfRecordId,
      entryType: shipment.entryType,
      lineItems: shipment.lineItems,
      documents: shipment.documents,
      openExceptions: shipment.exceptionItems,
      openReconciliationIssues: shipment.reconciliationIssues,
    });

    ctx.ledger.recordEntity("SHIPMENT", shipment.id, shipment.shipmentNumber);

    return {
      ok: true,
      data: {
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        shipmentStatus: shipment.status,
        ready: readiness.ready,
        checksPerformed: readiness.checksPerformed,
        checksPassed: readiness.checksPassed,
        maxChecks: FILING_READINESS_MAX_CHECKS,
        blockers: readiness.blockers.map((blocker) => ({
          code: blocker.code,
          requirement: blocker.label,
          detail: blocker.detail,
        })),
        // Said plainly so an answer cannot imply a clean bill of health.
        scopeNote:
          "These are the only checks Qubere performs from stored shipment data. Bond sufficiency, PGA requirements and licence conditions are not among them and have not been verified.",
      },
    };
  },
});

export const shipmentTools = [
  searchShipmentsTool,
  getShipmentTool,
  getShipmentFilingReadinessTool,
];
