import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { logAgentError } from "../agents/agentLogger";
import { requireEntryTypeCode } from "@/modules/filing/entryType";

export interface ACEResponsePayload {
  status: "ACCEPTED" | "REJECTED" | "DOCS_REQUIRED" | "BLOCKED" | "NOT_SUBMITTED";
  cbpEntryNumber: string | null;
  cbpActionCode: string;
  transmittedAt: string;
  filerCode: string;
  /** Null when the caller did not supply one; was defaulted to 3501 (Chicago). */
  portCode: string | null;
  rejectionReason?: string;
}

export interface CustomsFilingInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  enteredValue?: number | null;
  dutyDue?: number | null;
  readyForTransmission?: boolean;
  entryType?: string;
  portCode?: string;
  // Only an explicit, user-authorized "file this entry" action may set this
  // true. Without it, this agent must never simulate a completed CBP
  // transmission -- this previously fired on demand from the /app/agents
  // test-runner UI (with fake fallback defaults for value/HTS/entry number),
  // silently writing a fabricated CBP entry number and "Accepted" status
  // into the database.
  authorized?: boolean;
}

export interface CustomsFilingOutput {
  shipmentId: string;
  status: "Completed" | "Review Required";
  customsFilingId: string | null;
  aceResponse: ACEResponsePayload;
  confidence: number;
  reasoningChain: string;
  agentDecisionId: string | null;
  aiProviderUsed: string;
  debugError?: string;
}

export class CustomsFilingAgent {
  static async execute(input: CustomsFilingInput): Promise<CustomsFilingOutput> {
    // ACE simulation — no LLM call and no real CBP ABI connection in this environment.
    const aiProvider = "Deterministic ACE Simulation";
    let debugError: string | undefined = undefined;

    const timestamp = new Date().toISOString();
    const dataReady =
      input.readyForTransmission !== false &&
      typeof input.enteredValue === "number" &&
      input.enteredValue > 0;

    if (!dataReady || !input.authorized) {
      const aceResponse: ACEResponsePayload = dataReady
        ? {
            status: "NOT_SUBMITTED",
            cbpEntryNumber: null,
            cbpActionCode: "AWAITING AUTHORIZATION",
            transmittedAt: timestamp,
            filerCode: "QBR",
            portCode: input.portCode ?? null,
          }
        : {
            status: "BLOCKED",
            cbpEntryNumber: null,
            cbpActionCode: "BLOCKED - INCOMPLETE ENTRY PACKET (19 CFR § 141.86)",
            transmittedAt: timestamp,
            filerCode: "QBR",
            portCode: input.portCode ?? null,
            rejectionReason:
              "Transmission blocked: Missing mandatory Commercial Invoice and transaction valuation data.",
          };

      const reasoningChain = dataReady
        ? "Entry data is complete, but no CBP transmission has occurred. Filing requires an explicit, authorized filing action -- it is never triggered automatically."
        : "ACE ABI EDI transmission BLOCKED: Mandatory customs entry documents (Commercial Invoice) missing. Filer code QBR prevented from submitting incomplete entry to CBP per 19 CFR § 141.86.";

      // Null, not a synthetic id: a failed write produced no AgentDecision row.
      let agentDecisionId: string | null = null;
      try {
        const agentDecision = await db.agentDecision.create({
          data: {
            accountId: input.accountId,
            shipmentId: input.shipmentId,
            agentName: "Customs Filing Agent",
            agentIcon: "Send",
            status: "Needs Review",
            confidence: 0,
            decisionSummary: dataReady
              ? "Entry data ready; awaiting explicit filing authorization. Nothing has been transmitted to CBP."
              : "CBP Transmission BLOCKED: Missing Commercial Invoice & Entry Pricing.",
            purpose: "CBP ACE ABI EDIFACT entry summary transmission (simulation)",
            dataSources: [aiProvider],
            regulations: ["19 CFR § 141.86", "19 U.S.C. § 1484"],
            proposedDescription: dataReady ? "ACE Transmission NOT SUBMITTED (Awaiting Authorization)" : "ACE Transmission BLOCKED (Incomplete Entry)",
            rulesApplied: ["CBP ABI Pre-Transmission Mandatory Document Check"],
          },
        });
        agentDecisionId = agentDecision.id;
      } catch (err) {
        debugError = logAgentError(
          "Customs Filing Agent",
          input.shipmentId,
          "DB agentDecision create (blocked path)",
          err
        );
      }

      return {
        shipmentId: input.shipmentId,
        status: "Review Required",
        customsFilingId: null,
        aceResponse,
        confidence: 0,
        reasoningChain,
        agentDecisionId,
        aiProviderUsed: aiProvider,
        debugError,
      };
    }

    const cbpEntryNumber = `QBR-${new Date().getFullYear()}-${Math.floor(
      1000000 + Math.random() * 9000000
    )}`;

    const aceResponse: ACEResponsePayload = {
      status: "ACCEPTED",
      cbpEntryNumber,
      cbpActionCode: "1C - CARGO RELEASED",
      transmittedAt: timestamp,
      filerCode: "QBR",
      portCode: input.portCode ?? null,
    };

    const reasoningChain = `[SIMULATION] Simulated ABI EDIFACT payload for Entry Summary #${cbpEntryNumber}. ACE simulation response: '1C - CARGO RELEASED'. Note: no real CBP transmission occurred in this environment.`;

    let customsFilingId: string | null = null;
    let agentDecisionId: string | null = null;
    try {
      const customsFiling = await db.customsFiling.create({
        data: {
          shipmentId: input.shipmentId,
          accountId: input.accountId,
          entryNumber: cbpEntryNumber,
          entryType: requireEntryTypeCode(input.entryType),
          // Simulated run: must not be stored as a real accepted CBP entry.
          filingStatus: "Simulation",
          submittedAt: new Date(),
          totalValue: input.enteredValue as number,
          // The column is nullable: an uncalculated duty is unknown, not $0.00.
          totalDuties: input.dutyDue ?? null,
        },
      });
      customsFilingId = customsFiling.id;

      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          agentName: "Customs Filing Agent",
          agentIcon: "Send",
          status: "Approved",
          confidence: 90,
          decisionSummary: `[SIMULATION] Simulated ACE entry ${cbpEntryNumber} accepted.`,
          purpose: "CBP ACE ABI EDIFACT entry summary transmission (simulation)",
          dataSources: [aiProvider],
          regulations: ["19 U.S.C. § 1484 (Customs Entry)", "19 CFR Part 142"],
          proposedDescription: `ACE Simulated: Entry #${cbpEntryNumber} (ACCEPTED)`,
          rulesApplied: [
            "CBP ABI EDIFACT Envelope Construction Rule",
            "ACE Entry Summary Transmission Rule",
            "Automated Cargo Release Gate",
          ],
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      debugError = logAgentError(
        "Customs Filing Agent",
        input.shipmentId,
        "entry type resolution, or DB customsFiling or agentDecision create",
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
          metadata: { agentName: "Customs Filing Agent", cbpEntryNumber, simulation: true },
        });
      } catch (err) {
        debugError = logAgentError(
          "Customs Filing Agent",
          input.shipmentId,
          "createAuditLog",
          err
        );
      }
    }

    return {
      shipmentId: input.shipmentId,
      status: "Completed",
      customsFilingId,
      aceResponse,
      confidence: 90,
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
      debugError,
    };
  }
}
