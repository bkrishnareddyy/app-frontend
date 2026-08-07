import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { logAgentError } from "./agentLogger";

export interface PostEntryRefundOpportunity {
  opportunityId: string;
  type: string;
  potentialRefundAmount: number;
  cfrCitation: string;
  description: string;
}

export interface ResponseManagementInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  entryNumber?: string | null;
  hasCommercialInvoice?: boolean;
}

export interface ResponseManagementOutput {
  shipmentId: string;
  status: "Completed" | "Review Required" | "COMPLETED_NO_ACTION";
  refundOpportunities: PostEntryRefundOpportunity[];
  totalPotentialRefund: number;
  legalResponseDrafted: boolean;
  evaluatorScore: number | null;
  evaluatorCritique: string;
  confidence: number;
  dependencyMetadata: {
    inputsRequired: string[];
    inputsReceived: string[];
    missingInputs: string[];
    blockedByAgents: string[];
  };
  reasoningChain: string;
  agentDecisionId: string;
  aiProviderUsed: string;
  debugError?: string;
}

export class ResponseManagementAgent {
  static async execute(input: ResponseManagementInput): Promise<ResponseManagementOutput> {
    // Deterministic post-entry scanner — no LLM or real USTR API call in this environment.
    const aiProvider = "Deterministic Post-Entry Scanner";
    let debugError: string | undefined = undefined;

    // A real Section 301 exclusion or duty drawback scan requires:
    //   - The filed CBP entry number (to look up the entry in ACE)
    //   - The paid duty amount and HTS code (to match against USTR exclusions)
    //   - A live USTR / CBP API integration (not available here)
    //
    // Without those inputs, we cannot claim any refund amount.
    // Status is always COMPLETED_NO_ACTION until real integration is wired up.
    const status = "COMPLETED_NO_ACTION";
    const totalPotentialRefund = 0;
    const refundOpportunities: PostEntryRefundOpportunity[] = [];
    const evaluatorScore = null;

    const reasoningChain = input.entryNumber
      ? `Post-Entry Scanner: Entry ${input.entryNumber} recorded. Section 301 exclusion and duty drawback scan requires live USTR/CBP API integration — not available in current environment. No refund amounts claimed. Manual review recommended post-filing.`
      : "Post-Entry Scanner: No CBP entry number available (entry not filed or filing blocked). Zero post-entry remediation opportunities can be assessed without a filed entry.";

    const evaluatorCritique =
      "No refund amounts claimed — real Section 301 exclusion matching requires live USTR database integration with the filed HTS code and paid duty amount.";

    let agentDecisionId = "dec_fallback_response";
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          agentName: "Response Agent",
          agentIcon: "ReceiptCheck",
          status: "Approved",
          confidence: 100,
          decisionSummary: input.entryNumber
            ? `Post-Summary Scan Complete: Entry ${input.entryNumber} recorded. Live USTR/CBP integration required for refund claim.`
            : "Post-Summary Scan Complete: No entry number available. Zero post-entry remediation.",
          purpose:
            "Post-entry event tracking, CBP Form 28/29 legal response drafting, PSC filing, and Duty Drawback",
          dataSources: [aiProvider],
          regulations: ["19 CFR § 173 (PSC)", "19 CFR Part 190 (Drawback)"],
          proposedDescription: "COMPLETED_NO_ACTION",
          rulesApplied: ["Post-Entry Dependency Gate"],
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      debugError = logAgentError(
        "Response Agent",
        input.shipmentId,
        "DB agentDecision create",
        err
      );
    }

    try {
      await createAuditLog({
        accountId: input.accountId,
        userId: input.userId,
        action: "AGENT_EXECUTION_COMPLETED",
        entity: "AGENT_DECISION",
        entityId: agentDecisionId,
        metadata: {
          agentName: "Response Agent",
          hasEntryNumber: Boolean(input.entryNumber),
          refundAmount: totalPotentialRefund,
        },
      });
    } catch (err) {
      debugError = logAgentError("Response Agent", input.shipmentId, "createAuditLog", err);
    }

    return {
      shipmentId: input.shipmentId,
      status,
      refundOpportunities,
      totalPotentialRefund,
      legalResponseDrafted: false,
      evaluatorScore,
      evaluatorCritique,
      confidence: 100,
      dependencyMetadata: {
        inputsRequired: ["entryNumber", "hasCommercialInvoice", "paidDutyAmount", "htsCode"],
        inputsReceived: input.entryNumber ? ["entryNumber"] : [],
        missingInputs: input.entryNumber
          ? ["paidDutyAmount", "htsCode"]
          : ["entryNumber", "paidDutyAmount", "htsCode"],
        blockedByAgents: input.entryNumber ? [] : ["Customs Filing Agent"],
      },
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
      debugError,
    };
  }
}
