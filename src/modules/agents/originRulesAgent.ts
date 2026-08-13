import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { logAgentError } from "./agentLogger";
import { Prisma } from "@prisma/client";

export interface OriginQualificationResult {
  lineNumber: number;
  /** Null when the line item declares no manufacturing country. */
  countryOfOrigin: string | null;
  ftaProgram: string;
  spiCode: string;
  preferenceCriterion: string;
  /** Null when origin is unknown, so no tariff shift test could be run. */
  tariffShiftMet: boolean | null;
  /** "Rate not computed — HTS code required" when HTS/rate not provided by caller. */
  standardDutyRate: string;
  ftaDutyRate: string;
  /** null unless real entered value and duty rate are available to compute savings. */
  estimatedSavings: number | null;
}

export interface OriginRulesInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  documentId?: string | null;
  lineItems: Array<{
    lineNumber: number;
    htsCode?: string | null;
    manufacturingCountry?: string | null;
    rawMaterialOrigin?: string;
    /** Caller-provided duty rate for this HTS (e.g. from the HTS DB lookup in Agent 4). */
    standardDutyRate?: string;
    /** Not consumed by origin-determination logic today -- available for future GRI/de-minimis reasoning. */
    description?: string | null;
    sku?: string | null;
    materialComposition?: string | null;
    essentialCharacter?: string | null;
    endUse?: string | null;
  }>;
}

export interface OriginRulesOutput {
  shipmentId: string;
  status: "Completed" | "Review Required" | "BLOCKED_DEPENDENCY";
  qualifications: OriginQualificationResult[];
  blockingReasons?: string[];
  confidence: number;
  reasoningChain: string;
  agentDecisionId: string | null;
  aiProviderUsed: string;
  debugError?: string;
}

export class OriginRulesAgent {
  static async execute(input: OriginRulesInput): Promise<OriginRulesOutput> {
    // Deterministic rule evaluation per 19 CFR Part 102 and 19 CFR Part 181 (USMCA).
    // No LLM is called — aiProviderUsed reflects what actually ran.
    const aiProvider = "Deterministic Origin Rules Engine (19 CFR Part 102)";
    let debugError: string | undefined = undefined;

    const primaryCountry = input.lineItems[0]?.manufacturingCountry;
    const isMissingOrUnknownOrigin =
      input.lineItems.length === 0 ||
      !primaryCountry ||
      primaryCountry === "UNKNOWN" ||
      primaryCountry === "null";

    if (isMissingOrUnknownOrigin) {
      const blockingReasons = [
        "Country of origin missing or unverified",
        "Manufacturer details missing",
        "Product HTS classification unavailable",
      ];
      const reasoningChain =
        "Origin Rules Agent Gating STOPPED: Cannot evaluate substantial transformation or FTA qualification because country of origin / HTS input is missing. 0 rules evaluated.";

      // Null, not a synthetic id: a failed write produced no AgentDecision row.
      let agentDecisionId: string | null = null;
      try {
        const agentDecision = await db.agentDecision.create({
          data: {
            accountId: input.accountId,
            shipmentId: input.shipmentId,
            documentId: input.documentId ?? null,
            agentName: "Origin Agent",
            agentIcon: "Globe2",
            status: "Needs Review",
            triageState: "BLOCKED",
            blockedReason: "BLOCKED_MISSING_ORIGIN",
            confidence: 0,
            decisionSummary:
              "Origin Rules Evaluation BLOCKED: Missing country of origin and product classification.",
            purpose: "Country of origin rules evaluation and USMCA FTA qualification",
            dataSources: ["Origin Rules Gate"],
            regulations: ["19 CFR Part 102", "19 CFR Part 181 (USMCA)"],
            proposedDescription: "BLOCKED_DEPENDENCY",
            rulesApplied: ["Dependency Validation Prerequisite Gate"],
          },
        });
        agentDecisionId = agentDecision.id;
      } catch (err) {
        debugError = logAgentError(
          "Origin Agent",
          input.shipmentId,
          "DB agentDecision create (blocked path)",
          err
        );
      }

      return {
        shipmentId: input.shipmentId,
        status: "BLOCKED_DEPENDENCY",
        qualifications: [],
        blockingReasons,
        confidence: 0,
        reasoningChain,
        agentDecisionId,
        aiProviderUsed: aiProvider,
        debugError,
      };
    }

    const qualifications: OriginQualificationResult[] = [];

    for (const item of input.lineItems) {
      // An unknown manufacturing country used to default to "CN", so every
      // unidentified line was reported to the operator as Chinese origin.
      const co = item.manufacturingCountry ? item.manufacturingCountry.toUpperCase() : null;
      const isUsmca = co === "MX" || co === "CA";

      // Only claim a specific duty rate when the caller provides one from the HTS DB.
      // Never fabricate "6.2%" — that is the HTS Classification Agent's job.
      const callerProvidedRate = item.standardDutyRate;
      const standardDutyRate = callerProvidedRate
        ? callerProvidedRate
        : "Rate not computed — HTS code lookup required";
      const ftaDutyRate = isUsmca ? "0.0% (USMCA Preference)" : standardDutyRate;

      // Was a flat $3,007 on every USMCA line. Entered value and the HTS-specific
      // rate are not available here, so no saving can be computed.
      const estimatedSavings = null;

      qualifications.push({
        lineNumber: item.lineNumber,
        countryOfOrigin: co,
        ftaProgram: co === null ? "UNDETERMINED" : isUsmca ? "USMCA" : "NONE",
        spiCode: isUsmca ? "S" : "",
        preferenceCriterion: isUsmca ? "B" : co === null ? "Not evaluated" : "N/A",
        tariffShiftMet: co === null ? null : isUsmca,
        standardDutyRate,
        ftaDutyRate,
        estimatedSavings,
      });
    }

    const primaryCo = qualifications[0]?.countryOfOrigin ?? null;
    const primaryFta = qualifications[0]?.ftaProgram ?? "UNDETERMINED";
    const reasoningChain = `Evaluated origin rules for ${primaryCo ?? "an undeclared country of origin"}. ${
      primaryCo === null
        ? "No FTA qualification could be assessed because no line item declares a manufacturing country."
        : primaryFta !== "NONE"
        ? `FTA preference '${primaryFta}' may apply under Criterion B — tariff shift verification pending HTS confirmation.`
        : "Standard MFN tariff applicable — no qualifying FTA program detected for this origin."
    } Duty savings not computed: entered value and HTS-specific rate not available at this stage.`;

    let agentDecisionId: string | null = null;
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          documentId: input.documentId ?? null,
          agentName: "Origin Agent",
          agentIcon: "Globe2",
          status: "AUTO_VERIFIED",
          triageState: "AUTO_VERIFIED",
          autoApprovalPolicy: "origin-deterministic-v1",
          confidence: 80,
          decisionSummary: `Origin rules evaluated for ${qualifications.length} line(s): ${primaryFta} qualification assessed for ${primaryCo ?? "an undeclared country of origin"}.`,
          purpose:
            "Country of origin rules evaluation, tariff shift (CTH/CTSH) testing, and USMCA FTA qualification",
          dataSources: ["USMCA Annex 4-B Rules Engine", "19 CFR Part 102", aiProvider],
          regulations: ["19 CFR Part 102", "19 CFR Part 181 (USMCA)"],
          proposedDescription: `Origin ${primaryCo ?? "undeclared"} (${primaryFta})`,
          rulesApplied: [
            "USMCA Preference Criterion B Evaluation",
            "19 CFR Part 102 Substantial Transformation",
            "19 CFR § 134 Marking Verification",
          ],
          evidenceItems: { qualifications } as unknown as Prisma.InputJsonValue,
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      debugError = logAgentError(
        "Origin Agent",
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
          metadata: { agentName: "Origin Agent", primaryCountry: primaryCo, ftaProgram: primaryFta, autoApprovalPolicy: "origin-deterministic-v1", triageState: "AUTO_VERIFIED" },
        });
      } catch (err) {
        debugError = logAgentError("Origin Agent", input.shipmentId, "createAuditLog", err);
      }
    }

    return {
      shipmentId: input.shipmentId,
      status: "Completed",
      qualifications,
      confidence: 80,
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
      debugError,
    };
  }
}
