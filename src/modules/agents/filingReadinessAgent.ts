import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { logAgentError } from "./agentLogger";

export interface Form7501Preview {
  importerNumber: string | null;
  /** Block 2. Null when the caller declared none; was hardcoded to "01". */
  entryType: string | null;
  totalEnteredValue: number | null;
  totalDutyDue: number | null;
  totalLineItems: number;
  /** Block 5. Port of unlading / arrival, sourced from Document Intelligence's tradeMetadata.portOfDischarge. */
  portOfEntry: string | null;
  portOfLoading: string | null;
  carrier: string | null;
  /** Bill of lading / air waybill number CBP matches the entry summary against the inward manifest. */
  billOfLadingNumber: string | null;
}

export interface DetailedMissingRequirement {
  field: string;
  status: "missing" | "blocked_dependency" | "invalid";
  reason: string;
}

export interface FilingReadinessInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  documentId?: string | null;
  enteredValue?: number | null;
  dutyDue?: number | null;
  lineItemCount: number;
  hasCommercialInvoice?: boolean;
  isHtsBlocked?: boolean;
  isOriginBlocked?: boolean;
  isComplianceBlocked?: boolean;
  importerNumber?: string;
  entryType?: string;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  carrier?: string | null;
  transportDocumentNumber?: string | null;
}

export interface FilingReadinessOutput {
  shipmentId: string;
  status: "Completed" | "Review Required";
  readinessScore: number;
  readyForTransmission: boolean;
  brokerSignoffRequired: boolean;
  missingRequirements: string[];
  missingRequirementsDetails: DetailedMissingRequirement[];
  form7501Preview: Form7501Preview;
  confidence: number;
  dependencyMetadata: {
    inputsRequired: string[];
    inputsReceived: string[];
    missingInputs: string[];
    blockedByAgents: string[];
  };
  reasoningChain: string;
  agentDecisionId: string | null;
  aiProviderUsed: string;
  debugError?: string;
}

/** Invoice, valuation, HTS, origin, compliance audit, duty. */
const PREREQUISITE_CHECK_COUNT = 6;

export class FilingReadinessAgent {
  static async execute(input: FilingReadinessInput): Promise<FilingReadinessOutput> {
    // Deterministic Form 7501 field validation — no LLM is called.
    const aiProvider = "Deterministic Filing Readiness Validator";
    let debugError: string | undefined = undefined;

    const missingRequirements: string[] = [];
    const missingRequirementsDetails: DetailedMissingRequirement[] = [];
    const hasInvoice =
      input.hasCommercialInvoice !== false &&
      typeof input.enteredValue === "number" &&
      input.enteredValue > 0;

    if (input.hasCommercialInvoice === false) {
      missingRequirements.push("Commercial Invoice document (19 CFR § 141.86)");
      missingRequirementsDetails.push({
        field: "commercialInvoice",
        status: "missing",
        reason: "Commercial Invoice document missing from filing packet (19 CFR § 141.86)",
      });
    }

    if (!hasInvoice) {
      missingRequirements.push("Customs Valuation appraisal (19 U.S.C. § 1401a)");
      missingRequirementsDetails.push({
        field: "transactionValue",
        status: "missing",
        reason: "Customs valuation appraisal skipped due to missing invoice pricing data (19 U.S.C. § 1401a)",
      });
    }

    if (input.isHtsBlocked) {
      missingRequirements.push("10-Digit HTS Tariff Classification (19 U.S.C. § 1202)");
      missingRequirementsDetails.push({
        field: "htsClassification",
        status: "blocked_dependency",
        reason: "Product description missing for 10-digit HTS tariff resolution",
      });
    }

    if (input.isOriginBlocked) {
      missingRequirements.push("Country of Origin qualification (19 CFR Part 102)");
      missingRequirementsDetails.push({
        field: "countryOfOrigin",
        status: "missing",
        reason: "Origin rules evaluation unverified",
      });
    }

    if (input.isComplianceBlocked) {
      missingRequirements.push("Pre-filing compliance audit clearance (19 U.S.C. § 1592)");
      missingRequirementsDetails.push({
        field: "complianceAudit",
        status: "blocked_dependency",
        reason: "Pre-filing audit blocked due to missing HTS and Origin dependencies",
      });
    }

    if (typeof input.dutyDue !== "number") {
      missingRequirements.push("Estimated duty calculation (19 CFR § 141.101)");
      missingRequirementsDetails.push({
        field: "totalDutyDue",
        status: "missing",
        reason: "Duty due is a required Form 7501 field and has not been calculated for this entry",
      });
    }

    const readyForTransmission = missingRequirements.length === 0;
    // Binary by design: every prerequisite passed, or it did not. A graduated
    // score would need weighted rules that do not exist yet.
    const readinessScore = readyForTransmission ? 100 : 0;
    const brokerSignoffRequired = !readyForTransmission;

    const form7501Preview: Form7501Preview = {
      // Never fabricate an importer number — use null when not provided.
      importerNumber: input.importerNumber || null,
      entryType: input.entryType || null,
      totalEnteredValue: readyForTransmission ? input.enteredValue ?? null : null,
      // Was `?? 0.0`, which declared $0.00 duty owed on entries where duty was
      // never calculated.
      totalDutyDue: readyForTransmission ? input.dutyDue ?? null : null,
      totalLineItems: input.lineItemCount,
      portOfEntry: input.portOfDischarge || null,
      portOfLoading: input.portOfLoading || null,
      carrier: input.carrier || null,
      billOfLadingNumber: input.transportDocumentNumber || null,
    };

    const reasoningChain = readyForTransmission
      ? `Filing Readiness Validator: All ${PREREQUISITE_CHECK_COUNT} prerequisite checks passed. Readiness Score: 100%. Entry is READY for ACE Transmission pending licensed broker signoff.`
      : `Filing Readiness Validator: Blocked — ${missingRequirements.length} missing filing element(s): ${missingRequirements.join("; ")}. Readiness Score: 0%. Transmission to ACE prohibited.`;

    // Null, not a synthetic id: a failed write produced no AgentDecision row.
    let agentDecisionId: string | null = null;
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          documentId: input.documentId ?? null,
          agentName: "Filing Readiness Agent",
          agentIcon: "CheckCircle2",
          status: readyForTransmission ? "AUTO_VERIFIED" : "Needs Review",
          triageState: readyForTransmission ? "AUTO_VERIFIED" : "NEEDS_REVIEW",
          ...(readyForTransmission ? { autoApprovalPolicy: "filing-readiness-deterministic-v1" } : {}),
          confidence: readinessScore,
          decisionSummary: readyForTransmission
            ? `Form 7501 Entry Summary Verified (Readiness Score: ${readinessScore}%)`
            : `Filing Readiness Gate Blocked (${missingRequirements.length} missing prerequisites)`,
          purpose:
            "Form 7501 Entry Summary validation, missing document checks, and licensed broker signoff gate",
          dataSources: ["CBP Form 7501 Manual", "ACE Entry Summary Guidelines", aiProvider],
          regulations: ["19 CFR § 141.61", "19 CFR § 142.3"],
          proposedDescription: readyForTransmission ? "Form 7501 READY" : "Form 7501 BLOCKED",
          rulesApplied: [
            "CBP Form 7501 Mandatory Field Validator",
            "ACE Transmission Readiness Check",
            "Licensed Customs Broker Signoff Requirement",
          ],
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      debugError = logAgentError(
        "Filing Readiness Agent",
        input.shipmentId,
        "DB agentDecision create",
        err
      );
    }

    if (agentDecisionId) {
      try {
        await createAuditLog({
          accountId: input.accountId,
          userId: input.userId,
          action: "AGENT_EXECUTION_COMPLETED",
          entity: "AGENT_DECISION",
          entityId: agentDecisionId,
          metadata: {
            agentName: "Filing Readiness Agent",
            readyForTransmission,
            missingRequirementsCount: missingRequirements.length,
          },
        });
      } catch (err) {
        debugError = logAgentError(
          "Filing Readiness Agent",
          input.shipmentId,
          "createAuditLog",
          err
        );
      }
    }

    const blockedByAgents: string[] = [];
    if (input.hasCommercialInvoice === false) blockedByAgents.push("Document Intelligence Agent");
    if (input.isHtsBlocked) blockedByAgents.push("HTS Classification Agent");
    if (input.isOriginBlocked) blockedByAgents.push("Origin Rules Agent");
    if (input.isComplianceBlocked) blockedByAgents.push("Compliance Audit Agent");

    return {
      shipmentId: input.shipmentId,
      status: readyForTransmission ? "Completed" : "Review Required",
      readinessScore,
      readyForTransmission,
      brokerSignoffRequired,
      missingRequirements,
      missingRequirementsDetails,
      form7501Preview,
      confidence: readinessScore,
      dependencyMetadata: {
        inputsRequired: ["commercialInvoice", "enteredValue", "htsCode", "originCountry"],
        inputsReceived: readyForTransmission
          ? ["commercialInvoice", "enteredValue", "htsCode", "originCountry"]
          : [],
        missingInputs: missingRequirementsDetails.map((d) => d.field),
        blockedByAgents,
      },
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
      debugError,
    };
  }
}
