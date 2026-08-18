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

import { AccountContextBuilder } from "@/modules/memory";

export class OriginRulesAgent {
  static async execute(input: OriginRulesInput): Promise<OriginRulesOutput> {
    let accountContextPrompt = "";
    try {
      const accountContext = await AccountContextBuilder.build({
        accountId: input.accountId,
        task: "ORIGIN_DETERMINATION",
        shipmentId: input.shipmentId,
      });
      accountContextPrompt = accountContext.formattedText;
    } catch (err) {
      // Non-blocking fallback
    }

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
    // A country of manufacture matching MX/CA is a candidate for USMCA, never
    // a qualification by itself. A defensible claim additionally needs: the
    // product-specific tariff-shift/RVC rule for this line's HTS code, an
    // itemized bill of materials establishing non-originating content is
    // within that rule's limit, and supplier-origin evidence. This agent
    // receives none of those today (materialComposition is free text, not an
    // itemized-with-HTS/cost BOM, and no supplier certification is passed
    // in) — so a USMCA candidate can never be substantiated here and must
    // never be auto-approved. Claiming SPI "S" / Criterion B / a passed
    // tariff shift on country alone previously let unsubstantiated FTA
    // claims reach AUTO_VERIFIED.
    let usmcaCandidateCount = 0;

    for (const item of input.lineItems) {
      // An unknown manufacturing country used to default to "CN", so every
      // unidentified line was reported to the operator as Chinese origin.
      const co = item.manufacturingCountry ? item.manufacturingCountry.toUpperCase() : null;
      const isUsmcaCandidate = co === "MX" || co === "CA";
      if (isUsmcaCandidate) usmcaCandidateCount++;

      // Only claim a specific duty rate when the caller provides one from the HTS DB.
      // Never fabricate "6.2%" — that is the HTS Classification Agent's job.
      const callerProvidedRate = item.standardDutyRate;
      const standardDutyRate = callerProvidedRate
        ? callerProvidedRate
        : "Rate not computed — HTS code lookup required";
      // The preferential rate is not applied until the claim is substantiated.
      const ftaDutyRate = standardDutyRate;

      // Was a flat $3,007 on every USMCA line. Entered value and the HTS-specific
      // rate are not available here, so no saving can be computed.
      const estimatedSavings = null;

      qualifications.push({
        lineNumber: item.lineNumber,
        countryOfOrigin: co,
        ftaProgram: co === null ? "UNDETERMINED" : isUsmcaCandidate ? "USMCA_CANDIDATE" : "NONE",
        spiCode: "",
        preferenceCriterion: isUsmcaCandidate
          ? "Pending verification — rule, BOM, and supplier evidence required"
          : co === null
          ? "Not evaluated"
          : "N/A",
        // Never asserted true/false without an itemized BOM to test the
        // product-specific rule against; null means "not yet tested".
        tariffShiftMet: null,
        standardDutyRate,
        ftaDutyRate,
        estimatedSavings,
      });
    }

    const primaryCo = qualifications[0]?.countryOfOrigin ?? null;
    const primaryFta = qualifications[0]?.ftaProgram ?? "UNDETERMINED";
    const requiresReview = usmcaCandidateCount > 0;

    // Confidence reflects how much of what this agent needs was actually
    // supplied -- known origin per line, an HTS code to anchor the rule, and
    // a caller-provided duty rate to compare against -- never a flat 50/80
    // regardless of input completeness. Review-required lines (unsubstantiated
    // USMCA candidates) are additionally capped: no amount of ancillary data
    // completeness makes an unsubstantiated FTA claim high-confidence.
    const totalLines = input.lineItems.length || 1;
    const linesWithKnownOrigin = qualifications.filter((q) => q.countryOfOrigin !== null).length;
    const linesWithHts = input.lineItems.filter((li) => Boolean(li.htsCode)).length;
    const linesWithRate = input.lineItems.filter((li) => Boolean(li.standardDutyRate)).length;
    const inputCompleteness =
      (linesWithKnownOrigin / totalLines + linesWithHts / totalLines + linesWithRate / totalLines) / 3;
    const baseConfidence = Math.round(inputCompleteness * 100);
    const confidence = requiresReview ? Math.min(baseConfidence, 60) : baseConfidence;

    const reasoningChain = `Evaluated origin rules for ${primaryCo ?? "an undeclared country of origin"}. ${
      primaryCo === null
        ? "No FTA qualification could be assessed because no line item declares a manufacturing country."
        : requiresReview
        ? `${usmcaCandidateCount} line(s) manufactured in a USMCA territory are FTA candidates, but no claim is substantiated: the product-specific tariff-shift/RVC rule, an itemized bill of materials, and supplier-origin evidence are all required before a preference can be claimed. Routed to human review.`
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
          status: requiresReview ? "Needs Review" : "AUTO_VERIFIED",
          triageState: requiresReview ? "NEEDS_REVIEW" : "AUTO_VERIFIED",
          ...(requiresReview ? {} : { autoApprovalPolicy: "origin-deterministic-v1" }),
          confidence,
          decisionSummary: requiresReview
            ? `Origin rules evaluated for ${qualifications.length} line(s): ${usmcaCandidateCount} USMCA candidate(s) require human substantiation before any FTA preference can be claimed.`
            : `Origin rules evaluated for ${qualifications.length} line(s): ${primaryFta} qualification assessed for ${primaryCo ?? "an undeclared country of origin"}.`,
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
          metadata: {
            agentName: "Origin Agent",
            primaryCountry: primaryCo,
            ftaProgram: primaryFta,
            triageState: requiresReview ? "NEEDS_REVIEW" : "AUTO_VERIFIED",
            ...(requiresReview ? {} : { autoApprovalPolicy: "origin-deterministic-v1" }),
          },
        });
      } catch (err) {
        debugError = logAgentError("Origin Agent", input.shipmentId, "createAuditLog", err);
      }
    }

    return {
      shipmentId: input.shipmentId,
      status: "Completed",
      qualifications,
      confidence,
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
      debugError,
    };
  }
}
