import { GoogleGenAI, Type, Schema } from "@google/genai";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { logAgentError } from "./agentLogger";
import { screenValue } from "@/lib/screening/embargoMatch";
import { Prisma } from "@prisma/client";

export interface AuditCheckResult {
  ruleId: string;
  ruleName: string;
  category: "PGA" | "ADD_CVD" | "UFLPA" | "VALUATION" | "HTS_INTEGRITY" | "DATA_MISSING" | "SCREENING_GAP";
  passed: boolean;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  details: string;
  lineNumber?: number;
}

export interface ReviewFlag {
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: string;
  summary: string;
  evidenceRef: string;
  suggestedAction: string;
}

export interface ComplianceLineItemInput {
  lineNumber: number;
  htsCode?: string | null;
  countryOfOrigin?: string | null;
  description?: string | null;
  sku?: string | null;
  totalValue?: number | null;
}

export interface ComplianceAuditInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  documentId?: string | null;
  lineItems: ComplianceLineItemInput[];
  destinationCountry?: string | null;
  importerName?: string | null;
  incoterm?: string | null;
  exporterName?: string | null;
  supplierName?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  carrier?: string | null;
  transportDocumentNumber?: string | null;
  isHtsBlocked?: boolean;
}

export interface ComplianceAuditOutput {
  shipmentId: string;
  status: "Completed" | "Review Required" | "BLOCKED_DEPENDENCY";
  riskScore: number | null;
  auditChecksRun: number;
  auditChecksPassed: number;
  pgaRequirements: string[];
  addCvdApplicable: boolean;
  uflpaCleared: boolean;
  auditResults: AuditCheckResult[];
  flags: ReviewFlag[];
  blockingReasons?: string[];
  confidence: number;
  reasoningChain: string;
  agentDecisionId: string | null;
  aiProviderUsed: string;
  debugError?: string;
}

// ---------------------------------------------------------------------------
// Deterministic compliance rules engine, run per line item, grounded in real
// reference data (EmbargoRule table) rather than a hardcoded country list.
// Real ADD/CVD API integration is out of scope -- the alert table below is a
// static, abbreviated internal reference, not the full CBP registry.
// ---------------------------------------------------------------------------

/** Known active ADD/CVD order country-HTS prefixes (abbreviated -- not a complete registry). */
const ADD_CVD_ALERTS: Array<{ originCountry: string; htsPrefix: string; caseId: string }> = [
  { originCountry: "CN", htsPrefix: "7318", caseId: "A-570-979 (Steel Fasteners)" },
  { originCountry: "CN", htsPrefix: "6301", caseId: "A-570-890 (Textile/Blankets)" },
  { originCountry: "IN", htsPrefix: "7306", caseId: "A-533-502 (Steel Pipe)" },
];

const FDA_CHAPTERS = new Set(["09", "10", "17", "18", "19", "20", "21", "22"]); // Food/beverages

function isBlockedHtsCode(code: string | null | undefined): boolean {
  if (!code) return true;
  return code === "BLOCKED_MISSING_DESCRIPTION" || code.includes("BLOCKED") || code === "UNCLASSIFIABLE";
}

const synthesisSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    decisionSummary: { type: Type.STRING },
    overallRisk: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    flags: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          severity: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          category: { type: Type.STRING },
          summary: { type: Type.STRING },
          evidenceRef: { type: Type.STRING },
          suggestedAction: { type: Type.STRING },
        },
        required: ["severity", "category", "summary", "evidenceRef", "suggestedAction"],
      },
    },
  },
  required: ["decisionSummary", "overallRisk", "flags"],
};

const SYNTHESIS_SYSTEM_PROMPT = `
ROLE

You are Qubere's Compliance & Audit Risk Agent, stage 7 of the customs
compliance pipeline -- the last checkpoint before a shipment is considered
ready for filing. You are given the deterministic findings a rules engine
already computed (per-line embargo/UFLPA screening against real OFAC/UFLPA
reference data, missing-data checks, ADD/CVD and PGA flags) plus raw
shipment context. Your job is to write what a human compliance reviewer
sees: a short decision summary and a prioritized list of flags.

GROUNDING RULES

1. Every flag you write must be grounded in the findings/evidence object
   provided -- reference the specific line number, matched rule, or field
   it comes from. Never invent a finding that isn't backed by the evidence.
2. If a screening category did not run (for example, embargoRulesLoaded is
   0), say so explicitly -- "sanctions screening did not run" -- never
   report that category as clear when it was never checked.
3. If the findings list is empty and every category ran successfully, say
   so plainly rather than manufacturing a flag to seem thorough.
4. Rank flags by real severity: CRITICAL (sanctioned/embargoed origin,
   comprehensive missing classification) first, then HIGH, MEDIUM, LOW.
5. decisionSummary is one to two sentences, leading with the single most
   severe issue if one exists.
`;

export class ComplianceAuditAgent {
  private static aiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
  });

  static async execute(input: ComplianceAuditInput): Promise<ComplianceAuditOutput> {
    let aiProvider = "Deterministic Compliance Rules Engine";
    let debugError: string | undefined = undefined;
    const lineItems = input.lineItems || [];

    const classifiedLines = lineItems.filter((li) => !isBlockedHtsCode(li.htsCode));
    const originLines = lineItems.filter((li) => Boolean(li.countryOfOrigin));

    const isFullyBlocked =
      input.isHtsBlocked || lineItems.length === 0 || classifiedLines.length === 0 || originLines.length === 0;

    if (isFullyBlocked) {
      const blockingReasons = [
        lineItems.length === 0
          ? "No line items available for this shipment"
          : classifiedLines.length === 0
            ? "HTS classification unavailable for every line item (Agent 4 Blocked)"
            : "Country of origin unverified for every line item",
        "Manufacturer / Exporter details missing",
      ];
      const reasoningChain =
        "Compliance Audit Gating STOPPED: No line item has both an HTS classification and a country of origin. 0 rules evaluated.";

      let agentDecisionId: string | null = null;
      try {
        const agentDecision = await db.agentDecision.create({
          data: {
            accountId: input.accountId,
            shipmentId: input.shipmentId,
            documentId: input.documentId ?? null,
            agentName: "Compliance Agent",
            agentIcon: "ShieldAlert",
            status: "Needs Review",
            triageState: "BLOCKED",
            blockedReason: "BLOCKED_MISSING_CLASSIFICATION",
            confidence: 0,
            decisionSummary:
              "Compliance Audit BLOCKED: Missing prerequisite HTS classification and country of origin.",
            purpose: "CBP pre-filing compliance rules execution",
            dataSources: [aiProvider],
            regulations: ["19 CFR § 141.86", "UFLPA Screening Rules"],
            proposedDescription: "BLOCKED_DEPENDENCY",
            rulesApplied: ["Dependency Validation Prerequisite Gate"],
          },
        });
        agentDecisionId = agentDecision.id;
      } catch (err) {
        debugError = logAgentError(
          "Compliance Agent",
          input.shipmentId,
          "DB agentDecision create (blocked path)",
          err
        );
      }

      return {
        shipmentId: input.shipmentId,
        status: "BLOCKED_DEPENDENCY",
        riskScore: null,
        auditChecksRun: 0,
        auditChecksPassed: 0,
        pgaRequirements: [],
        addCvdApplicable: false,
        uflpaCleared: false,
        auditResults: [],
        flags: [],
        blockingReasons,
        confidence: 0,
        reasoningChain,
        agentDecisionId,
        aiProviderUsed: aiProvider,
        debugError,
      };
    }

    // ---- Grounded evidence gathering (real DB data, no hardcoded lists) ----
    const embargoRules = await db.embargoRule.findMany().catch((err) => {
      debugError = logAgentError("Compliance Agent", input.shipmentId, "db.embargoRule.findMany", err);
      return [];
    });

    const auditResults: AuditCheckResult[] = [];

    if (embargoRules.length === 0) {
      auditResults.push({
        ruleId: "RULE-SCREENING-GAP-00",
        ruleName: "Embargo/Sanctions Reference Data Availability",
        category: "SCREENING_GAP",
        passed: false,
        severity: "MEDIUM",
        details:
          "No embargo/sanctions reference data is loaded (EmbargoRule table empty). UFLPA and country-sanctions screening did not run for any line -- this shipment has not been screened. The absence of other UFLPA/sanctions flags below does not mean it is clear.",
      });
    }

    for (const li of lineItems) {
      const co = (li.countryOfOrigin || "").toUpperCase();
      const hts = li.htsCode || "";
      const htsPrefix4 = hts.replace(/\./g, "").substring(0, 4);

      if (!li.countryOfOrigin) {
        auditResults.push({
          ruleId: "RULE-DATA-01",
          ruleName: "Line-Level Country of Origin Presence",
          category: "DATA_MISSING",
          passed: false,
          severity: "HIGH",
          details: `Line ${li.lineNumber}: country of origin not established. UFLPA/embargo screening cannot run for this line.`,
          lineNumber: li.lineNumber,
        });
      }
      if (isBlockedHtsCode(li.htsCode)) {
        auditResults.push({
          ruleId: "RULE-DATA-02",
          ruleName: "Line-Level HTS Classification Presence",
          category: "DATA_MISSING",
          passed: false,
          severity: "HIGH",
          details: `Line ${li.lineNumber}: HTS classification missing or unresolved. Duty rate, PGA, and ADD/CVD applicability cannot be determined for this line.`,
          lineNumber: li.lineNumber,
        });
      }

      if (li.countryOfOrigin && embargoRules.length > 0) {
        const matches = screenValue(li.countryOfOrigin, embargoRules);
        if (matches.length > 0) {
          auditResults.push({
            ruleId: "RULE-UFLPA-01",
            ruleName: "UFLPA Forced Labor & Sanctions Country Check",
            category: "UFLPA",
            passed: false,
            severity: "CRITICAL",
            details: `Line ${li.lineNumber}: origin "${li.countryOfOrigin}" matches ${matches.map((m) => `${m.regime} (${m.countryName})`).join(", ")}. Manual entity-list screening and supply chain documentation required before CBP release.`,
            lineNumber: li.lineNumber,
          });
        } else {
          auditResults.push({
            ruleId: "RULE-UFLPA-01",
            ruleName: "UFLPA Forced Labor & Sanctions Country Check",
            category: "UFLPA",
            passed: true,
            severity: "CRITICAL",
            details: `Line ${li.lineNumber}: origin "${li.countryOfOrigin}" does not match any loaded embargo/sanctions rule.`,
            lineNumber: li.lineNumber,
          });
        }
      }

      if (co && hts) {
        const addCvdMatch = ADD_CVD_ALERTS.find(
          (a) => a.originCountry === co && htsPrefix4.startsWith(a.htsPrefix.substring(0, 4))
        );
        if (addCvdMatch) {
          auditResults.push({
            ruleId: "RULE-ADD-CVD-02",
            ruleName: "Anti-Dumping & Countervailing Duty Order Scope Check",
            category: "ADD_CVD",
            passed: false,
            severity: "HIGH",
            details: `Line ${li.lineNumber}: potential ADD/CVD order match: Case ${addCvdMatch.caseId} may apply to HTS ${hts} from ${co}. Scope ruling verification required.`,
            lineNumber: li.lineNumber,
          });
        }
      }

      if (hts) {
        const htsChapter = hts.substring(0, 2);
        if (FDA_CHAPTERS.has(htsChapter)) {
          auditResults.push({
            ruleId: "RULE-PGA-03",
            ruleName: "Partner Government Agency (PGA) Flagging",
            category: "PGA",
            passed: false,
            severity: "MEDIUM",
            details: `Line ${li.lineNumber}: HTS chapter ${htsChapter} falls under FDA jurisdiction. Prior Notice filing required (21 U.S.C. § 381).`,
            lineNumber: li.lineNumber,
          });
        }
      }
    }

    // Optional, best-effort valuation/origin sanity check against benchmark data.
    const uniqueHts = Array.from(new Set(lineItems.map((li) => li.htsCode).filter((h): h is string => Boolean(h) && !isBlockedHtsCode(h))));
    for (const hts of uniqueHts) {
      const benchmark = await db.tradeBenchmark
        .findFirst({ where: { htsCode10: { contains: hts } } })
        .catch(() => null);
      if (!benchmark) continue;
      const line = lineItems.find((li) => li.htsCode === hts);
      if (line?.countryOfOrigin && benchmark.topOriginCountry && line.countryOfOrigin.toUpperCase() !== benchmark.topOriginCountry.toUpperCase()) {
        auditResults.push({
          ruleId: "RULE-VALUATION-04",
          ruleName: "Trade Benchmark Origin Comparison",
          category: "VALUATION",
          passed: true,
          severity: "LOW",
          details: `Line ${line.lineNumber}: declared origin "${line.countryOfOrigin}" differs from this HTS code's most common US import origin ("${benchmark.topOriginCountry}") per internal trade benchmark data. Informational only.`,
          lineNumber: line.lineNumber,
        });
      }
    }

    const failedResults = auditResults.filter((r) => !r.passed);
    const criticalCount = failedResults.filter((r) => r.severity === "CRITICAL").length;
    const highCount = failedResults.filter((r) => r.severity === "HIGH").length;
    const mediumCount = failedResults.filter((r) => r.severity === "MEDIUM").length;

    const uflpaResults = auditResults.filter((r) => r.category === "UFLPA");
    const uflpaCleared = embargoRules.length > 0 && uflpaResults.length > 0 && uflpaResults.every((r) => r.passed);
    const addCvdApplicable = auditResults.some((r) => r.category === "ADD_CVD" && !r.passed);
    const pgaRequirements = auditResults
      .filter((r) => r.category === "PGA" && !r.passed)
      .map((r) => r.details);

    const riskScore = Math.min(100, criticalCount * 40 + highCount * 20 + mediumCount * 10);
    const deterministicRequiresReview = criticalCount > 0 || highCount > 0;
    const confidence = 70;
    const auditChecksRun = auditResults.length;
    const auditChecksPassed = auditResults.filter((r) => r.passed).length;

    const deterministicSummary = `Executed ${auditChecksRun} deterministic compliance checks across ${lineItems.length} line item(s). ${auditChecksPassed}/${auditChecksRun} passed.${criticalCount ? ` ${criticalCount} critical finding(s).` : ""}${highCount ? ` ${highCount} high-severity finding(s).` : ""} Note: live entity-list and full ADD/CVD registry checks require external API integration not available in this environment.`;

    let decisionSummary = deterministicSummary;
    let flags: ReviewFlag[] = failedResults.map((r) => ({
      severity: r.severity,
      category: r.category,
      summary: r.details,
      evidenceRef: r.lineNumber ? `Line ${r.lineNumber}` : "Shipment",
      suggestedAction: "Manual compliance review required before filing.",
    }));

    if (process.env.GEMINI_API_KEY) {
      try {
        const evidence = {
          lineItems: lineItems.map((li) => ({
            lineNumber: li.lineNumber,
            description: li.description ?? null,
            sku: li.sku ?? null,
            htsCode: li.htsCode ?? null,
            countryOfOrigin: li.countryOfOrigin ?? null,
          })),
          shipmentContext: {
            destinationCountry: input.destinationCountry ?? null,
            importerName: input.importerName ?? null,
            incoterm: input.incoterm ?? null,
            exporterName: input.exporterName ?? null,
            portOfLoading: input.portOfLoading ?? null,
            portOfDischarge: input.portOfDischarge ?? null,
            carrier: input.carrier ?? null,
            transportDocumentNumber: input.transportDocumentNumber ?? null,
          },
          findings: auditResults,
          embargoRulesLoaded: embargoRules.length,
        };

        const prompt = `${SYNTHESIS_SYSTEM_PROMPT}\n\nEVIDENCE:\n${JSON.stringify(evidence, null, 2)}`;

        const response = await this.aiClient.models.generateContent({
          model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: synthesisSchema,
            temperature: 0.1,
          },
        });

        const parsed = JSON.parse(response.text || "{}");
        if (parsed.decisionSummary && Array.isArray(parsed.flags)) {
          decisionSummary = parsed.decisionSummary;
          flags = parsed.flags;
          aiProvider = "Deterministic Compliance Rules Engine + Gemini 3.6 Flash Synthesis";
        }
      } catch (err) {
        debugError = logAgentError("Compliance Agent", input.shipmentId, "Gemini generateContent", err);
      }
    }

    const reasoningChain = deterministicSummary;

    // Recomputed after flags are finalized: the LLM synthesis (or its
    // fallback) can surface findings -- like missing shipmentContext fields --
    // that never appeared in auditResults, so status must account for flags
    // too or it can read "Approved" next to a summary describing a blocking
    // issue.
    const requiresReview =
      deterministicRequiresReview || flags.length > 0;

    let agentDecisionId: string | null = null;
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          documentId: input.documentId ?? null,
          agentName: "Compliance Agent",
          agentIcon: "ShieldAlert",
          status: requiresReview ? "Needs Review" : "AUTO_VERIFIED",
          triageState: requiresReview ? "NEEDS_REVIEW" : "AUTO_VERIFIED",
          ...(requiresReview ? {} : { autoApprovalPolicy: "compliance-deterministic-v1" }),
          confidence,
          decisionSummary,
          purpose: "CBP pre-filing compliance rules execution (PGA, ADD/CVD, UFLPA)",
          dataSources: [aiProvider, "Internal ADD/CVD Alert Table", "EmbargoRule Reference Table (OFAC/UFLPA)"],
          regulations: ["19 CFR § 141.86", "UFLPA (Public Law 117-78)", "19 CFR Part 159 (ADD/CVD)"],
          proposedDescription: `Compliance check for ${lineItems.length} line item(s)`,
          rulesApplied: Array.from(new Set(auditResults.map((r) => r.ruleName))),
          evidenceItems: { auditResults, flags, embargoRulesLoaded: embargoRules.length } as unknown as Prisma.InputJsonValue,
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      debugError = logAgentError("Compliance Agent", input.shipmentId, "DB agentDecision create", err);
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
            agentName: "Compliance Agent",
            lineItemCount: lineItems.length,
            auditChecksRun,
            auditChecksPassed,
            riskScore,
          },
        });
      } catch (err) {
        debugError = logAgentError("Compliance Agent", input.shipmentId, "createAuditLog", err);
      }
    }

    return {
      shipmentId: input.shipmentId,
      status: requiresReview ? "Review Required" : "Completed",
      riskScore,
      auditChecksRun,
      auditChecksPassed,
      pgaRequirements,
      addCvdApplicable,
      uflpaCleared,
      auditResults,
      flags,
      confidence,
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
      debugError,
    };
  }
}
