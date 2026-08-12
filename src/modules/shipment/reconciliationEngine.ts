import { db } from "@/lib/db";
import { ShipmentEventBus } from "@/modules/events/shipmentEventBus";
import { isPlaceholderValue, lineItemFactField } from "./lineItemReconciler";

interface ComplianceAuditFinding {
  ruleId: string;
  category: "PGA" | "ADD_CVD" | "UFLPA" | "VALUATION" | "HTS_INTEGRITY" | "DATA_MISSING" | "SCREENING_GAP";
  passed: boolean;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  details: string;
  lineNumber?: number;
}

interface ComplianceAuditFlag {
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: string;
  summary: string;
  evidenceRef: string;
  suggestedAction: string;
}

const COMPLIANCE_EXCEPTION_CATEGORY: Record<ComplianceAuditFinding["category"], "COMPLIANCE" | "MISSING_DATA"> = {
  UFLPA: "COMPLIANCE",
  ADD_CVD: "COMPLIANCE",
  PGA: "COMPLIANCE",
  SCREENING_GAP: "COMPLIANCE",
  VALUATION: "COMPLIANCE",
  HTS_INTEGRITY: "COMPLIANCE",
  DATA_MISSING: "MISSING_DATA",
};

function complianceExceptionCode(finding: ComplianceAuditFinding): string {
  const sanitizedRuleId = finding.ruleId.replace(/[^A-Z0-9]/gi, "_").toUpperCase();
  return `COMPLIANCE_${sanitizedRuleId}${finding.lineNumber != null ? `_L${finding.lineNumber}` : ""}`;
}

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

    // Every value a source actually supplied is recorded as a Fact, and only when
    // it was present -- LineItemReconciler.recordFacts skips null and empty. So
    // the presence of a fact is the out-of-band answer to "was this extracted?",
    // which the stored value alone cannot give: the placeholder for an unknown
    // quantity is 1, and a line legitimately shipping one unit is byte-identical
    // to it. Reading the sentinel alone reported 20 of this invoice's 68 lines as
    // having no quantity when all 68 were read correctly.
    const recordedFacts = await db.fact.findMany({
      where: {
        shipmentId: shipment.id,
        field: { startsWith: "lineItem." },
      },
      select: { field: true },
    });
    const factFields = new Set(recordedFacts.map((fact) => fact.field));
    const wasExtracted = (lineNumber: number, field: string) =>
      factFields.has(lineItemFactField(lineNumber, field));

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
        isDefaulted: (item) =>
          isPlaceholderValue("quantity", item.quantity, wasExtracted(item.lineNumber, "quantity")),
      },
      {
        fieldKey: "unitPrice",
        code: "MISSING_LINE_ITEM_UNIT_PRICE",
        label: "Unit Price",
        isDefaulted: (item) =>
          isPlaceholderValue("unitPrice", Number(item.unitPrice), wasExtracted(item.lineNumber, "unitPrice")),
      },
      {
        fieldKey: "countryOfOrigin",
        code: "MISSING_LINE_ITEM_COUNTRY_OF_ORIGIN",
        label: "Country of Origin",
        isDefaulted: (item) =>
          isPlaceholderValue(
            "countryOfOrigin",
            item.countryOfOrigin,
            wasExtracted(item.lineNumber, "countryOfOrigin")
          ),
      },
    ];

    const invoiceDoc = shipment.documents.find((d) => d.docType.toLowerCase().includes("invoice")) || shipment.documents[0];
    const docSuffix = invoiceDoc ? ` on ${invoiceDoc.fileName}` : "";

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
              documentId: invoiceDoc?.id ?? null,
              code: check.code,
              fieldKey: check.fieldKey,
              category: "MISSING_DATA",
              type: "data_mismatch",
              severity: "Medium",
              description: `${check.label} could not be extracted for ${affectedLines.length} line item(s) (line ${affectedLines
                .map((i) => i.lineNumber)
                .join(", ")})${docSuffix} -- confirm before filing.`,
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

    // 4. Sync Compliance Audit Agent's CRITICAL/HIGH findings into real
    // exceptions -- the deterministic auditResults are the dedup source
    // (stable ruleId/lineNumber), not the LLM-phrased flags, whose wording
    // can vary run to run for the same underlying finding.
    const latestComplianceDecision = await db.agentDecision.findFirst({
      where: { shipmentId: shipment.id, agentName: "Compliance Agent" },
      orderBy: { createdAt: "desc" },
    });
    const evidenceItems = latestComplianceDecision?.evidenceItems as
      | { auditResults?: ComplianceAuditFinding[]; flags?: ComplianceAuditFlag[] }
      | null
      | undefined;
    const auditResults = evidenceItems?.auditResults ?? [];
    const flags = evidenceItems?.flags ?? [];

    const activeComplianceExceptions = activeExceptions.filter((e) => e.sourceAgent === "Compliance Agent");
    const currentFindings = auditResults.filter(
      (r) => !r.passed && (r.severity === "CRITICAL" || r.severity === "HIGH")
    );
    const currentCodes = new Set(currentFindings.map(complianceExceptionCode));

    for (const finding of currentFindings) {
      const code = complianceExceptionCode(finding);
      if (activeComplianceExceptions.some((e) => e.code === code)) continue;

      const matchingFlag = flags.find(
        (f) => f.category === finding.category && (finding.lineNumber == null || f.evidenceRef.includes(`Line ${finding.lineNumber}`))
      );

      await db.exceptionItem.create({
        data: {
          accountId: shipment.accountId,
          shipmentId: shipment.id,
          code,
          category: COMPLIANCE_EXCEPTION_CATEGORY[finding.category],
          type: "compliance_flag",
          severity: finding.severity === "CRITICAL" ? "Critical" : "High",
          description: matchingFlag?.summary ?? finding.details,
          blocking: finding.severity === "CRITICAL",
          requiredAction: matchingFlag?.suggestedAction ?? "Manual compliance review required before filing.",
          sourceAgent: "Compliance Agent",
        },
      });
      exceptionsGenerated++;
      affectedAgentsSet.add("COMPLIANCE_AUDIT");
    }

    for (const existing of activeComplianceExceptions) {
      if (existing.code && !currentCodes.has(existing.code)) {
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
