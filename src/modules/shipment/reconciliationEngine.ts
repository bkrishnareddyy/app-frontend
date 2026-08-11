import { db } from "@/lib/db";
import { ShipmentEventBus } from "@/modules/events/shipmentEventBus";
import { LINE_ITEM_SENTINELS } from "./lineItemReconciler";

export interface ReconciliationResult {
  shipmentId: string;
  reconciledAt: string;
  conflictsDetected: number;
  exceptionsGenerated: number;
  exceptionsResolved: number;
  affectedAgents: string[];
}

export class ReconciliationEngine {
  /**
   * Reconciles all inputs, document extractions, and user edits for a shipment.
   * Generates or auto-resolves ExceptionItem records durably.
   */
  static async reconcileShipment(shipmentId: string, triggerSource: string = "SYSTEM"): Promise<ReconciliationResult> {
    const shipment = await db.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        documents: { include: { parseVersions: true } },
        exceptionItems: { where: { status: { not: "Resolved" } } },
        shipmentParties: { include: { legalEntity: true } },
        importerOfRecord: true,
        lineItems: true,
      },
    });

    if (!shipment) {
      throw new Error(`Shipment ${shipmentId} not found`);
    }

    const affectedAgentsSet = new Set<string>();
    const conflictsDetected = 0;
    let exceptionsGenerated = 0;
    let exceptionsResolved = 0;

    const activeExceptions = shipment.exceptionItems || [];

    // 1. Check Missing Importer / Client
    const missingImporterException = activeExceptions.find((e) => e.code === "MISSING_IMPORTER_OF_RECORD");
    if (!shipment.importerOfRecordId && !shipment.clientId && shipment.shipmentParties.length === 0) {
      if (!missingImporterException) {
        await db.exceptionItem.create({
          data: {
            accountId: shipment.accountId,
            shipmentId: shipment.id,
            code: "MISSING_IMPORTER_OF_RECORD",
            category: "MISSING_DATA",
            type: "compliance_flag",
            severity: "High",
            description: "No Importer of Record or Client entity assigned to this shipment.",
            blocking: true,
            requiredAction: "Assign a Client or Importer of Record entity",
            sourceAgent: "Reconciliation Engine",
          },
        });
        exceptionsGenerated++;
        affectedAgentsSet.add("COMPLIANCE_AUDIT");
      }
    } else if (missingImporterException) {
      // Resolve exception
      await db.exceptionItem.update({
        where: { id: missingImporterException.id },
        data: { status: "Resolved", resolvedAt: new Date(), resolvedBy: triggerSource },
      });
      exceptionsResolved++;
    }

    // 2. Check Line Items HTS Review Requirements
    const unreviewedItems = shipment.lineItems.filter(
      (item) => item.status === "Unreviewed" || (item.htsConfidence !== null && item.htsConfidence < 80)
    );
    const htsReviewException = activeExceptions.find((e) => e.code === "HTS_REVIEW_REQUIRED");

    if (unreviewedItems.length > 0) {
      if (!htsReviewException) {
        await db.exceptionItem.create({
          data: {
            accountId: shipment.accountId,
            shipmentId: shipment.id,
            code: "HTS_REVIEW_REQUIRED",
            category: "CLASSIFICATION",
            type: "data_mismatch",
            severity: "Medium",
            description: `${unreviewedItems.length} line item(s) require tariff classification review.`,
            blocking: false,
            requiredAction: "Review and confirm HTS classification codes",
            sourceAgent: "HTS Classification Agent",
          },
        });
        exceptionsGenerated++;
        affectedAgentsSet.add("HTS_CLASSIFICATION");
      }
    } else if (htsReviewException) {
      await db.exceptionItem.update({
        where: { id: htsReviewException.id },
        data: { status: "Resolved", resolvedAt: new Date(), resolvedBy: triggerSource },
      });
      exceptionsResolved++;
    }

    // 3. Check for line-item fields LineItemReconciler had to placeholder --
    // never left missing, but flagged here the same way HTS review is, so a
    // human confirms the real value before it's relied on for filing.
    const lineItems = shipment.lineItems;
    const defaultedFieldChecks: Array<{
      fieldKey: "quantity" | "unitPrice" | "countryOfOrigin";
      code: string;
      label: string;
      isDefaulted: (item: (typeof lineItems)[number]) => boolean;
    }> = [
      {
        fieldKey: "quantity",
        code: "MISSING_LINE_ITEM_QUANTITY",
        label: "Quantity",
        isDefaulted: (item) => item.quantity === LINE_ITEM_SENTINELS.quantity,
      },
      {
        fieldKey: "unitPrice",
        code: "MISSING_LINE_ITEM_UNIT_PRICE",
        label: "Unit Price",
        isDefaulted: (item) => Number(item.unitPrice) === LINE_ITEM_SENTINELS.unitPrice,
      },
      {
        fieldKey: "countryOfOrigin",
        code: "MISSING_LINE_ITEM_COUNTRY_OF_ORIGIN",
        label: "Country of Origin",
        isDefaulted: (item) => item.countryOfOrigin === LINE_ITEM_SENTINELS.countryOfOrigin,
      },
    ];

    for (const check of defaultedFieldChecks) {
      // Only rows still awaiting review carry this signal -- once a human
      // approves a row (status "Valid"), a lingering sentinel value is a
      // deliberate confirmed answer (e.g. a genuinely unknown origin), not a
      // still-open gap.
      const affectedLines = shipment.lineItems.filter((item) => item.status !== "Valid" && check.isDefaulted(item));
      const existing = activeExceptions.find((e) => e.code === check.code);

      if (affectedLines.length > 0) {
        if (!existing) {
          await db.exceptionItem.create({
            data: {
              accountId: shipment.accountId,
              shipmentId: shipment.id,
              code: check.code,
              fieldKey: check.fieldKey,
              category: "MISSING_DATA",
              type: "data_mismatch",
              severity: "Medium",
              description: `${check.label} could not be extracted for ${affectedLines.length} line item(s) (line ${affectedLines
                .map((i) => i.lineNumber)
                .join(", ")}) -- confirm before filing.`,
              blocking: false,
              requiredAction: `Review and confirm ${check.label.toLowerCase()} for the affected line item(s)`,
              sourceAgent: "Line Item Reconciler",
            },
          });
          exceptionsGenerated++;
          affectedAgentsSet.add("LINE_ITEM_RECONCILER");
        }
      } else if (existing) {
        await db.exceptionItem.update({
          where: { id: existing.id },
          data: { status: "Resolved", resolvedAt: new Date(), resolvedBy: triggerSource },
        });
        exceptionsResolved++;
      }
    }

    // Always include Filing Readiness for score updates
    affectedAgentsSet.add("FILING_READINESS");

    const affectedAgents = Array.from(affectedAgentsSet);

    // Log reconciliation event
    await ShipmentEventBus.logEvent({
      shipmentId,
      eventType: "RECONCILIATION_REQUESTED",
      payload: {
        triggerSource,
        conflictsDetected,
        exceptionsGenerated,
        exceptionsResolved,
        affectedAgents,
      },
      triggeredBy: triggerSource,
    });

    return {
      shipmentId,
      reconciledAt: new Date().toISOString(),
      conflictsDetected,
      exceptionsGenerated,
      exceptionsResolved,
      affectedAgents,
    };
  }
}
