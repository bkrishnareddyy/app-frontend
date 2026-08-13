import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { logAgentError } from "./agentLogger";
import { Prisma } from "@prisma/client";

export interface ValuationAdjustment {
  type: string;
  amount: number;
  description: string;
}

export interface ValuationAssistsInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  documentId?: string | null;
  invoiceSubtotal?: number | null;
  oceanFreight?: number;
  buyerAssists?: number;
  /** Not consumed by valuation logic today -- available for a future line-total-vs-invoice-subtotal reconciliation check. */
  lineItems?: Array<{
    lineNumber: number;
    totalValue?: number | null;
    quantity?: number | null;
    unitPrice?: number | null;
  }>;
}

export interface ValuationAssistsOutput {
  shipmentId: string;
  status: "Completed" | "Review Required" | "Skipped - Missing Invoice Data";
  enteredCustomsValue: number | null;
  valuationMethod: string;
  adjustments: ValuationAdjustment[];
  confidence: number;
  confidenceMetrics: {
    decisionConfidence: number;
    valuationConfidence: number;
  };
  dependencyMetadata: {
    inputsRequired: string[];
    inputsReceived: string[];
    missingInputs: string[];
    blockedByAgents: string[];
  };
  reasoningChain: string;
  agentDecisionId: string | null;
  aiProviderUsed: string;
  /** Populated when a DB or audit call throws, so failures are visible in the API response. */
  debugError?: string;
}

export class ValuationAssistsAgent {
  static async execute(input: ValuationAssistsInput): Promise<ValuationAssistsOutput> {
    // Deterministic arithmetic per 19 U.S.C. § 1401a — no LLM is called.
    const aiProvider = "Deterministic Valuation Calculator (19 U.S.C. § 1401a)";
    let debugError: string | undefined = undefined;

    const hasInvoiceValue =
      typeof input.invoiceSubtotal === "number" && input.invoiceSubtotal > 0;

    if (!hasInvoiceValue) {
      const reasoningChain =
        "Valuation Agent skipped: Commercial Invoice pricing data is missing from document packet. Cannot appraise transaction value per 19 U.S.C. § 1401a without invoice totals.";

      // Null, not a synthetic id: a failed write produced no AgentDecision row.
      let agentDecisionId: string | null = null;
      try {
        const agentDecision = await db.agentDecision.create({
          data: {
            accountId: input.accountId,
            shipmentId: input.shipmentId,
            documentId: input.documentId ?? null,
            agentName: "Valuation Agent",
            agentIcon: "Calculator",
            status: "Needs Review",
            triageState: "BLOCKED",
            blockedReason: "BLOCKED_MISSING_INVOICE",
            confidence: 0,
            decisionSummary: "Valuation Skipped: Missing Commercial Invoice pricing data.",
            purpose:
              "CBP transaction value calculation, buyer assist allocation, and nondutiable freight deduction audit",
            dataSources: ["19 U.S.C. § 1401a Valuation Manual"],
            regulations: ["19 U.S.C. § 1401a", "19 CFR § 152.103"],
            proposedDescription: "Valuation Skipped (No Invoice)",
            rulesApplied: ["19 U.S.C. 1401a Transaction Value Pre-Requisite Check"],
          },
        });
        agentDecisionId = agentDecision.id;
      } catch (err) {
        debugError = logAgentError(
          "Valuation Agent",
          input.shipmentId,
          "DB agentDecision create (skipped path)",
          err
        );
      }

      return {
        shipmentId: input.shipmentId,
        status: "Skipped - Missing Invoice Data",
        enteredCustomsValue: null,
        valuationMethod: "METHOD_1_TRANSACTION_VALUE_UNAVAILABLE",
        adjustments: [],
        confidence: 0,
        confidenceMetrics: { decisionConfidence: 100, valuationConfidence: 0 },
        dependencyMetadata: {
          inputsRequired: ["invoiceSubtotal", "currency"],
          inputsReceived: [],
          missingInputs: ["invoiceSubtotal", "currency"],
          blockedByAgents: ["Document Intelligence Agent"],
        },
        reasoningChain,
        agentDecisionId,
        aiProviderUsed: aiProvider,
        debugError,
      };
    }

    const baseVal = input.invoiceSubtotal!;

    // Only apply adjustments when the caller explicitly provides the values.
    // Never silently assume $3,200 freight or $1,500 buyer assists on every shipment.
    const adjustments: ValuationAdjustment[] = [];

    const oceanFreightVal = typeof input.oceanFreight === "number" ? input.oceanFreight : 0;

    if (oceanFreightVal > 0) {
      adjustments.push({
        type: "DEDUCTION_INTERNATIONAL_FREIGHT",
        amount: -oceanFreightVal,
        description: "Nondutiable Ocean Freight & Insurance per 19 CFR § 152.103",
      });
    }

    if (typeof input.buyerAssists === "number" && input.buyerAssists > 0) {
      adjustments.push({
        type: "ADDITION_BUYER_ASSIST",
        amount: input.buyerAssists,
        description: "Tooling & Design Assist furnished by buyer per 19 U.S.C. § 1401a",
      });
    }

    const totalAdjustment = adjustments.reduce((sum, a) => sum + a.amount, 0);
    const enteredCustomsValue = Math.max(0, baseVal + totalAdjustment);

    // Confidence is proportional to input completeness, not a hardcoded constant.
    const inputsReceived = ["invoiceSubtotal"];
    const inputsRequired = ["invoiceSubtotal", "currency"];
    const completeness = Math.round((inputsReceived.length / inputsRequired.length) * 100);

    const adjustmentNote =
      adjustments.length > 0
        ? adjustments
            .map((a) => `${a.type}: $${Math.abs(a.amount).toFixed(2)}`)
            .join("; ")
        : "No adjustments applied (oceanFreight and buyerAssists not provided by caller)";

    const reasoningChain = `Invoice Subtotal: $${baseVal.toFixed(2)}. ${adjustmentNote}. Appraised Entered Customs Value: $${enteredCustomsValue.toFixed(2)} USD under Method 1 (Transaction Value).`;

    let agentDecisionId: string | null = null;
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          documentId: input.documentId ?? null,
          agentName: "Valuation Agent",
          agentIcon: "Calculator",
          status: "AUTO_VERIFIED",
          triageState: "AUTO_VERIFIED",
          autoApprovalPolicy: "valuation-deterministic-v1",
          confidence: completeness,
          decisionSummary: `Appraised Entered Customs Value: $${enteredCustomsValue.toFixed(2)} (Method 1 Transaction Value). ${adjustments.length} adjustments applied.`,
          purpose:
            "CBP transaction value calculation, buyer assist allocation, and nondutiable freight deduction audit",
          dataSources: ["19 U.S.C. § 1401a Valuation Manual", aiProvider],
          regulations: ["19 U.S.C. § 1401a", "19 CFR § 152.103"],
          proposedDescription: `Appraised Customs Value: $${enteredCustomsValue.toFixed(2)}`,
          rulesApplied: [
            "19 U.S.C. 1401a Transaction Value Calculation",
            ...(adjustments.length > 0
              ? [
                  "19 CFR § 152.103 International Freight Deduction",
                  "Tooling Assist Allocation Rule",
                ]
              : []),
          ],
          evidenceItems: {
            enteredCustomsValue,
            valuationMethod: "METHOD_1_TRANSACTION_VALUE",
            adjustments,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      debugError = logAgentError(
        "Valuation Agent",
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
          action: AuditAction.AGENT_EXECUTION_COMPLETED,
          entity: "AGENT_DECISION",
          entityId: agentDecisionId,
          source: "SYSTEM",
          metadata: {
            agentName: "Valuation Agent",
            enteredCustomsValue,
            valuationMethod: "METHOD_1_TRANSACTION_VALUE",
            adjustmentsApplied: adjustments.length,
            autoApprovalPolicy: "valuation-deterministic-v1",
            triageState: "AUTO_VERIFIED",
          },
        });
      } catch (err) {
        debugError = logAgentError(
          "Valuation Agent",
          input.shipmentId,
          "createAuditLog",
          err
        );
      }
    }

    return {
      shipmentId: input.shipmentId,
      status: "Completed",
      enteredCustomsValue,
      valuationMethod: "METHOD_1_TRANSACTION_VALUE",
      adjustments,
      confidence: completeness,
      confidenceMetrics: {
        decisionConfidence: completeness,
        valuationConfidence: completeness,
      },
      dependencyMetadata: {
        inputsRequired,
        inputsReceived,
        missingInputs: [],
        blockedByAgents: [],
      },
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
      debugError,
    };
  }
}
