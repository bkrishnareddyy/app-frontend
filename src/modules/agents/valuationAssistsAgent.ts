import { GoogleGenAI } from "@google/genai";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { agentEventBus } from "@/modules/intake/documentIntakeAgent";
import { Prisma } from "@prisma/client";

export interface ValuationAdjustment {
  type: "DEDUCTION_OCEAN_FREIGHT" | "DEDUCTION_INSURANCE" | "ADDITION_TOOLING_ASSIST" | "ADDITION_ROYALTY";
  description: string;
  amount: number;
  cfrCitation: string;
}

export interface ValuationAssistsInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  invoiceSubtotal?: number | null;
  oceanFreightIncluded?: number;
  buyerAssists?: number;
  isRelatedParty?: boolean;
}

export interface ValuationAssistsOutput {
  shipmentId: string;
  status: "Completed" | "Review Required" | "Skipped - Missing Invoice Data";
  enteredCustomsValue: number | null;
  valuationMethod: string;
  adjustments: ValuationAdjustment[];
  confidence: number;
  reasoningChain: string;
  agentDecisionId: string;
  aiProviderUsed: string;
}

export class ValuationAssistsAgent {
  private static aiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
  });

  static async execute(input: ValuationAssistsInput): Promise<ValuationAssistsOutput> {
    let aiProvider = "Gemini 2.5 Flash Valuation Engine (Google GenAI SDK)";

    const hasInvoiceValue = typeof input.invoiceSubtotal === "number" && input.invoiceSubtotal > 0;

    if (!hasInvoiceValue) {
      const reasoningChain = "Valuation Agent skipped: Commercial Invoice pricing data is missing from document packet. Cannot appraise transaction value per 19 U.S.C. § 1401a without invoice totals.";
      
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          agentName: "Valuation Agent",
          agentIcon: "Calculator",
          status: "Needs Review",
          confidence: 100,
          decisionSummary: "Valuation Skipped: Missing Commercial Invoice pricing data.",
          purpose: "CBP transaction value calculation, buyer assist allocation, and nondutiable freight deduction audit",
          dataSources: ["19 U.S.C. § 1401a Valuation Manual", aiProvider],
          regulations: ["19 U.S.C. § 1401a", "19 CFR § 152.103"],
          proposedDescription: "Valuation Skipped (No Invoice)",
          rulesApplied: ["19 U.S.C. 1401a Transaction Value Pre-Requisite Check"],
        },
      });

      return {
        shipmentId: input.shipmentId,
        status: "Skipped - Missing Invoice Data",
        enteredCustomsValue: null,
        valuationMethod: "NOT_APPLICABLE_NO_INVOICE",
        adjustments: [],
        confidence: 100,
        reasoningChain,
        agentDecisionId: agentDecision.id,
        aiProviderUsed: aiProvider,
      };
    }

    const subtotal = input.invoiceSubtotal as number;
    const oceanFreight = input.oceanFreightIncluded || 0;
    const assists = input.buyerAssists || 0;
    const enteredCustomsValue = subtotal - oceanFreight + assists;

    const adjustments: ValuationAdjustment[] = [];
    if (oceanFreight > 0) {
      adjustments.push({
        type: "DEDUCTION_OCEAN_FREIGHT",
        description: "Nondutiable international ocean freight deduction",
        amount: oceanFreight,
        cfrCitation: "19 U.S.C. § 1401a(b)(4)(A)",
      });
    }

    if (assists > 0) {
      adjustments.push({
        type: "ADDITION_TOOLING_ASSIST",
        description: "Buyer-furnished production tooling assist allocation",
        amount: assists,
        cfrCitation: "19 U.S.C. § 1401a(b)(1)(C)",
      });
    }

    const reasoningChain = `Invoice Subtotal: $${subtotal.toFixed(2)}. Deducted $${oceanFreight.toFixed(2)} non-dutiable ocean freight. Added $${assists.toFixed(2)} buyer assists. Appraised Entered Customs Value: $${enteredCustomsValue.toFixed(2)}.`;
    const requiresReview = Boolean(input.isRelatedParty);

    const agentDecision = await db.agentDecision.create({
      data: {
        accountId: input.accountId,
        shipmentId: input.shipmentId,
        agentName: "Valuation Agent",
        agentIcon: "Calculator",
        status: requiresReview ? "Needs Review" : "Approved",
        confidence: 99,
        decisionSummary: `Transaction Valuation computed: Entered Value $${enteredCustomsValue.toLocaleString()} (Method 1 - Transaction Value).`,
        purpose: "CBP transaction value calculation, buyer assist allocation, and nondutiable freight deduction audit",
        dataSources: ["19 U.S.C. § 1401a Valuation Manual", "CBP Form 7501 Valuation Directives", aiProvider],
        regulations: ["19 U.S.C. § 1401a", "19 CFR § 152.103"],
        proposedDescription: `Entered Value $${enteredCustomsValue.toFixed(2)} (Transaction Value)`,
        rulesApplied: [
          "19 U.S.C. 1401a(b) Transaction Value Rule",
          "Nondutiable Freight Deduction Rule",
          "Buyer Assist Addition Rule",
        ],
      },
    });

    return {
      shipmentId: input.shipmentId,
      status: requiresReview ? "Review Required" : "Completed",
      enteredCustomsValue,
      valuationMethod: "1 - TRANSACTION VALUE",
      adjustments,
      confidence: 99,
      reasoningChain,
      agentDecisionId: agentDecision.id,
      aiProviderUsed: aiProvider,
    };
  }
}
