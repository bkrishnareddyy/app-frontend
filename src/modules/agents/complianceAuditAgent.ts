import { GoogleGenAI, Type, Schema } from "@google/genai";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { meterGeminiCall } from "@/lib/ai/aiMeter";
import { aiModel } from "@/lib/ai/aiModel";
import { hashPromptVersion } from "@/lib/ai/promptVersion";
import { logAgentError } from "./agentLogger";
import { Prisma } from "@prisma/client";
import { runCountryEmbargoScreening } from "./compliance/embargo/countryEmbargoScreening";
import { getAccountEmbargoConfig } from "./compliance/embargo/embargoRepository";
import type {
  CountryEmbargoScreeningResult,
  EmbargoParty,
  EmbargoLineItem,
} from "./compliance/embargo/types";
import { runForcedLaborScreening } from "./compliance/forcedLabor/forcedLaborScreening";
import type { ForcedLaborScreeningResult } from "./compliance/forcedLabor/types";
import { runEndUseScreening } from "./compliance/endUse/endUseScreening";
import type { EndUseScreeningResult } from "./compliance/endUse/types";
import { runEndUserScreening } from "./compliance/endUser/endUserScreening";
import type { EndUserScreeningResult } from "./compliance/endUser/types";
import { runAntiBoycottScreening } from "./compliance/antiBoycott/antiBoycottScreening";
import type { AntiBoycottScreeningResult } from "./compliance/antiBoycott/types";
import { runMilitaryEndUseScreening } from "./compliance/militaryEndUse/militaryEndUseScreening";
import type { MilitaryEndUseScreeningResult } from "./compliance/militaryEndUse/types";

export interface AuditCheckResult {
  ruleId: string;
  ruleName: string;
  category:
    | "PGA"
    | "ADD_CVD"
    | "UFLPA"
    | "VALUATION"
    | "HTS_INTEGRITY"
    | "DATA_MISSING"
    | "SCREENING_GAP"
    | "COUNTRY_EMBARGO"
    | "END_USE_RESTRICTION"
    | "END_USER_RESTRICTION"
    | "ANTI_BOYCOTT"
    | "MILITARY_END_USE"
    | "MILITARY_END_USER";
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
  /** Optional line-level ECCN, if known directly (bypasses classification-string parsing). */
  eccn?: string | null;
  /** Optional pipe-delimited classification string, e.g. "HTS|...|CCL|...|SCHB|...". */
  classification?: string | null;
  /** Optional line-specific destination party, distinct from the transaction's ship-to. */
  destinationParty?: EmbargoParty | null;
}

export interface ComplianceAuditInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  transactionId?: string;
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
  /** Country Embargo Screening -- compliance/ship-from country. Screening is skipped (SCREENING_GAP) if absent. */
  shipFromCountry?: string | null;
  /** Country Embargo Screening -- transaction parties, including the SHIP_TO party. */
  parties?: EmbargoParty[];
  /** Explicit per-invocation Country Embargo Screening disable, independent of account configuration. */
  embargoScreening?: boolean;
  /** End-Use / Military End-Use Screening -- stated end-use text (e.g. an end-use statement/certificate), captured as a Fact. */
  endUseStatement?: string | null;
  /** Anti-Boycott Screening -- free-text transaction document/narrative content (e.g. an LC or purchase order), captured as a Fact. */
  documentNarrativeText?: string | null;
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
  countryEmbargoScreening?: CountryEmbargoScreeningResult;
  forcedLaborScreening?: ForcedLaborScreeningResult;
  endUseScreening?: EndUseScreeningResult;
  endUserScreening?: EndUserScreeningResult;
  antiBoycottScreening?: AntiBoycottScreeningResult;
  militaryEndUseScreening?: MilitaryEndUseScreeningResult;
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

    // ---- Country Embargo Screening (deterministic; see compliance/embargo/) ----
    let countryEmbargoScreening: CountryEmbargoScreeningResult | undefined;
    if (!input.shipFromCountry) {
      auditResults.push({
        ruleId: "RULE-SCREENING-GAP-01",
        ruleName: "Country Embargo Screening Availability",
        category: "SCREENING_GAP",
        passed: false,
        severity: "MEDIUM",
        details:
          "Country Embargo Screening did not run: no compliance/ship-from country is available for this shipment. This is not a CLEAR result -- treat destination/origin embargo status as unscreened.",
      });
    } else {
      const accountConfig = await getAccountEmbargoConfig(input.accountId).catch((err) => {
        debugError = logAgentError("Compliance Agent", input.shipmentId, "getAccountEmbargoConfig", err);
        return {
          embargoScreeningEnabled: true,
          privateEmbargoEnabled: false,
          serverScreeningEnabled: true,
          genericExportLdEnabled: false,
          audited: false,
          emailAlertEnabled: false,
          generalAuditLogEnabled: false,
        };
      });

      const embargoLineItems: EmbargoLineItem[] = lineItems.map((li) => ({
        lineItemId: String(li.lineNumber),
        lineNumber: li.lineNumber,
        classification: li.classification ?? null,
        eccn: li.eccn ?? null,
        countryOfOrigin: li.countryOfOrigin ?? null,
        destinationParty: li.destinationParty ?? null,
      }));

      countryEmbargoScreening = await runCountryEmbargoScreening({
        accountId: input.accountId,
        shipmentId: input.shipmentId,
        transactionId: input.transactionId,
        shipFromCountry: input.shipFromCountry,
        shipToCountry: input.destinationCountry ?? null,
        parties: input.parties ?? [],
        lineItems: embargoLineItems,
        screeningDate: new Date(),
        accountConfig,
        embargoScreening: input.embargoScreening,
      }).catch((err) => {
        debugError = logAgentError("Compliance Agent", input.shipmentId, "runCountryEmbargoScreening", err);
        return undefined;
      });

      if (countryEmbargoScreening) {
        if (countryEmbargoScreening.status === "SKIPPED") {
          auditResults.push({
            ruleId: "RULE-SCREENING-GAP-02",
            ruleName: "Country Embargo Screening Availability",
            category: "SCREENING_GAP",
            passed: false,
            severity: "MEDIUM",
            details: `Country Embargo Screening was skipped (${countryEmbargoScreening.skippedChecks[0]?.reason ?? "disabled"}). This is not a CLEAR result.`,
          });
        }
        for (const hit of countryEmbargoScreening.hits) {
          auditResults.push({
            ruleId: hit.ruleId ? `RULE-COUNTRY-EMBARGO-${hit.ruleId}` : "RULE-COUNTRY-EMBARGO",
            ruleName: "Country Embargo Screening",
            category: "COUNTRY_EMBARGO",
            passed: false,
            severity: "CRITICAL",
            details: `${hit.screeningLevel}/${hit.type === "D" ? "destination" : "origin"} screening: compliance country "${hit.complianceCountry}" embargoes "${hit.country}" (matcher: ${hit.matcher}).${hit.lineItemId ? ` Line ${hit.lineItemId}.` : ""}`,
            lineNumber: hit.lineItemId ? Number(hit.lineItemId) || undefined : undefined,
          });
        }
        if (countryEmbargoScreening.errors.length > 0) {
          auditResults.push({
            ruleId: "RULE-SCREENING-GAP-03",
            ruleName: "Country Embargo Screening Completeness",
            category: "SCREENING_GAP",
            passed: false,
            severity: "MEDIUM",
            details: `Country Embargo Screening encountered ${countryEmbargoScreening.errors.length} error(s) (e.g. unresolvable country) -- some checks did not complete.`,
          });
        }
      }
    }

    // ---- UFLPA / Forced Labor Screening (deterministic; see compliance/forcedLabor/) ----
    const entityNames = [
      input.exporterName ? { role: "Exporter", name: input.exporterName } : null,
      input.supplierName ? { role: "Supplier/Manufacturer", name: input.supplierName } : null,
    ].filter((n): n is { role: string; name: string } => n !== null);

    const forcedLaborScreening = await runForcedLaborScreening({
      accountId: input.accountId,
      shipmentId: input.shipmentId,
      lineItems: lineItems.map((li) => ({ lineNumber: li.lineNumber, countryOfOrigin: li.countryOfOrigin ?? null })),
      entityNames,
      screeningDate: new Date(),
    }).catch((err) => {
      debugError = logAgentError("Compliance Agent", input.shipmentId, "runForcedLaborScreening", err);
      return undefined;
    });

    if (forcedLaborScreening) {
      if (forcedLaborScreening.status === "SKIPPED") {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-04",
          ruleName: "UFLPA / Forced Labor Screening Availability",
          category: "UFLPA",
          passed: false,
          severity: "MEDIUM",
          details: `UFLPA / Forced Labor Screening did not run: ${[...forcedLaborScreening.skipped].map((s) => s.reason).join(" ") || "no reference data loaded"}. This is not a CLEAR result.`,
        });
      }
      for (const hit of forcedLaborScreening.hits) {
        auditResults.push({
          ruleId: hit.kind === "COUNTRY_REGION" ? `RULE-UFLPA-01-${hit.ruleId}` : "RULE-UFLPA-02",
          ruleName:
            hit.kind === "COUNTRY_REGION"
              ? "UFLPA Country/Region Rebuttable Presumption Check"
              : "UFLPA Entity List Check",
          category: "UFLPA",
          passed: false,
          severity: "CRITICAL",
          details: hit.reason,
          lineNumber: hit.kind === "COUNTRY_REGION" ? hit.lineNumber : undefined,
        });
      }
      if (forcedLaborScreening.errors.length > 0) {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-05",
          ruleName: "UFLPA / Forced Labor Screening Completeness",
          category: "UFLPA",
          passed: false,
          severity: "MEDIUM",
          details: `UFLPA / Forced Labor Screening encountered ${forcedLaborScreening.errors.length} error(s) -- some checks did not complete.`,
        });
      }
    }

    // ---- End-Use / End-User / Anti-Boycott / Military End-Use Screening ----
    // These four are independent of one another (no shared data dependency),
    // so they run concurrently rather than as four sequential round-trips.
    const endUserEntityNames = [
      input.exporterName ? { role: "Exporter", name: input.exporterName } : null,
      input.supplierName ? { role: "Supplier/Manufacturer", name: input.supplierName } : null,
      input.importerName ? { role: "Importer", name: input.importerName } : null,
    ].filter((n): n is { role: string; name: string } => n !== null);

    const [endUseScreening, endUserScreening, antiBoycottScreening, militaryEndUseScreening] = await Promise.all([
      runEndUseScreening({
        accountId: input.accountId,
        shipmentId: input.shipmentId,
        endUseStatement: input.endUseStatement ?? null,
        screeningDate: new Date(),
      }).catch((err) => {
        debugError = logAgentError("Compliance Agent", input.shipmentId, "runEndUseScreening", err);
        return undefined;
      }),
      runEndUserScreening({
        accountId: input.accountId,
        shipmentId: input.shipmentId,
        entityNames: endUserEntityNames,
        screeningDate: new Date(),
      }).catch((err) => {
        debugError = logAgentError("Compliance Agent", input.shipmentId, "runEndUserScreening", err);
        return undefined;
      }),
      runAntiBoycottScreening({
        accountId: input.accountId,
        shipmentId: input.shipmentId,
        destinationCountry: input.destinationCountry ?? null,
        documentNarrativeText: input.documentNarrativeText ?? null,
        screeningDate: new Date(),
      }).catch((err) => {
        debugError = logAgentError("Compliance Agent", input.shipmentId, "runAntiBoycottScreening", err);
        return undefined;
      }),
      runMilitaryEndUseScreening({
        accountId: input.accountId,
        shipmentId: input.shipmentId,
        endUseStatement: input.endUseStatement ?? null,
        entityNames: endUserEntityNames,
        screeningDate: new Date(),
      }).catch((err) => {
        debugError = logAgentError("Compliance Agent", input.shipmentId, "runMilitaryEndUseScreening", err);
        return undefined;
      }),
    ]);

    if (endUseScreening) {
      if (endUseScreening.status === "SKIPPED") {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-06",
          ruleName: "End-Use Screening Availability",
          category: "END_USE_RESTRICTION",
          passed: false,
          severity: "MEDIUM",
          details: `End-Use Screening did not run: ${[...endUseScreening.skipped].map((s) => s.reason).join(" ") || "no reference data loaded"}. This is not a CLEAR result.`,
        });
      }
      for (const hit of endUseScreening.hits) {
        auditResults.push({
          ruleId: `RULE-END-USE-01-${hit.category}`,
          ruleName: "Restricted End-Use Check",
          category: "END_USE_RESTRICTION",
          passed: false,
          severity: "CRITICAL",
          details: hit.reason,
        });
      }
      if (endUseScreening.errors.length > 0) {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-07",
          ruleName: "End-Use Screening Completeness",
          category: "END_USE_RESTRICTION",
          passed: false,
          severity: "MEDIUM",
          details: `End-Use Screening encountered ${endUseScreening.errors.length} error(s) -- some checks did not complete.`,
        });
      }
    }

    // ---- End-User Screening (deterministic; see compliance/endUser/) ----
    // Broader than the UFLPA/forced-labor entityNames set -- BIS Entity List /
    // Unverified List concern any transaction party, so the importer (the
    // usual receiving/end-user party) is included alongside exporter/supplier.
    if (endUserScreening) {
      if (endUserScreening.status === "SKIPPED") {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-08",
          ruleName: "End-User Screening Availability",
          category: "END_USER_RESTRICTION",
          passed: false,
          severity: "MEDIUM",
          details: `End-User Screening did not run: ${[...endUserScreening.skipped].map((s) => s.reason).join(" ") || "no reference data loaded"}. This is not a CLEAR result.`,
        });
      }
      for (const hit of endUserScreening.hits) {
        auditResults.push({
          ruleId: "RULE-END-USER-01",
          ruleName: "BIS Entity List / Unverified List Check",
          category: "END_USER_RESTRICTION",
          passed: false,
          severity: "CRITICAL",
          details: hit.reason,
        });
      }
      if (endUserScreening.errors.length > 0) {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-09",
          ruleName: "End-User Screening Completeness",
          category: "END_USER_RESTRICTION",
          passed: false,
          severity: "MEDIUM",
          details: `End-User Screening encountered ${endUserScreening.errors.length} error(s) -- some checks did not complete.`,
        });
      }
    }

    // ---- Anti-Boycott Screening (deterministic; see compliance/antiBoycott/) ----
    if (antiBoycottScreening) {
      if (antiBoycottScreening.status === "SKIPPED") {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-10",
          ruleName: "Anti-Boycott Screening Availability",
          category: "ANTI_BOYCOTT",
          passed: false,
          severity: "MEDIUM",
          details: `Anti-Boycott Screening did not run: ${[...antiBoycottScreening.skipped].map((s) => s.reason).join(" ") || "no reference data loaded"}. This is not a CLEAR result.`,
        });
      }
      for (const hit of antiBoycottScreening.hits) {
        auditResults.push({
          ruleId: hit.kind === "COUNTRY" ? "RULE-ANTI-BOYCOTT-01" : "RULE-ANTI-BOYCOTT-02",
          ruleName: hit.kind === "COUNTRY" ? "Anti-Boycott Country Check" : "Anti-Boycott Document Language Check",
          category: "ANTI_BOYCOTT",
          passed: false,
          severity: "HIGH",
          details: hit.reason,
        });
      }
      if (antiBoycottScreening.errors.length > 0) {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-11",
          ruleName: "Anti-Boycott Screening Completeness",
          category: "ANTI_BOYCOTT",
          passed: false,
          severity: "MEDIUM",
          details: `Anti-Boycott Screening encountered ${antiBoycottScreening.errors.length} error(s) -- some checks did not complete.`,
        });
      }
    }

    // ---- Military End-Use / End-User Screening (deterministic; see compliance/militaryEndUse/) ----
    if (militaryEndUseScreening) {
      if (militaryEndUseScreening.status === "SKIPPED") {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-12",
          ruleName: "Military End-Use / End-User Screening Availability",
          category: "MILITARY_END_USE",
          passed: false,
          severity: "MEDIUM",
          details: `Military End-Use / End-User Screening did not run: ${[...militaryEndUseScreening.skipped].map((s) => s.reason).join(" ") || "no reference data loaded"}. This is not a CLEAR result.`,
        });
      }
      for (const hit of militaryEndUseScreening.hits) {
        auditResults.push({
          ruleId: hit.kind === "MILITARY_END_USE" ? "RULE-MILITARY-END-USE-01" : "RULE-MILITARY-END-USER-01",
          ruleName: hit.kind === "MILITARY_END_USE" ? "Military End-Use Keyword Check" : "Military End User (MEU) List Check",
          category: hit.kind,
          passed: false,
          severity: "CRITICAL",
          details: hit.reason,
        });
      }
      if (militaryEndUseScreening.errors.length > 0) {
        auditResults.push({
          ruleId: "RULE-SCREENING-GAP-13",
          ruleName: "Military End-Use / End-User Screening Completeness",
          category: "MILITARY_END_USE",
          passed: false,
          severity: "MEDIUM",
          details: `Military End-Use / End-User Screening encountered ${militaryEndUseScreening.errors.length} error(s) -- some checks did not complete.`,
        });
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

    // CLEAR only when both the country/region and entity-list checks actually
    // ran with no hits/errors -- SKIPPED/ERROR/PARTIAL/HIT/undefined all fall
    // through to false, never a fabricated clearance.
    const uflpaCleared = forcedLaborScreening?.status === "CLEAR";
    const addCvdApplicable = auditResults.some((r) => r.category === "ADD_CVD" && !r.passed);
    const pgaRequirements = auditResults
      .filter((r) => r.category === "PGA" && !r.passed)
      .map((r) => r.details);

    const riskScore = Math.min(100, criticalCount * 40 + highCount * 20 + mediumCount * 10);
    const deterministicRequiresReview = criticalCount > 0 || highCount > 0;

    // Confidence reflects how much of the audit surface actually had data to
    // evaluate -- never a flat constant regardless of what ran. Each factor
    // is real coverage, not a proxy for risk (that's riskScore): the fraction
    // of lines with a usable origin, the fraction with a usable HTS code,
    // whether embargo/sanctions reference data was loaded at all, and whether
    // Country Embargo Screening actually ran rather than being skipped.
    const totalLines = lineItems.length || 1;
    const originCoverage = originLines.length / totalLines;
    const htsCoverage = classifiedLines.length / totalLines;
    const embargoDataLoaded = embargoRules.length > 0 ? 1 : 0;
    const embargoScreeningRan = countryEmbargoScreening && countryEmbargoScreening.status !== "SKIPPED" ? 1 : 0;
    const forcedLaborScreeningRan = forcedLaborScreening && forcedLaborScreening.status !== "SKIPPED" ? 1 : 0;
    const endUseScreeningRan = endUseScreening && endUseScreening.status !== "SKIPPED" ? 1 : 0;
    const endUserScreeningRan = endUserScreening && endUserScreening.status !== "SKIPPED" ? 1 : 0;
    const antiBoycottScreeningRan = antiBoycottScreening && antiBoycottScreening.status !== "SKIPPED" ? 1 : 0;
    const militaryEndUseScreeningRan = militaryEndUseScreening && militaryEndUseScreening.status !== "SKIPPED" ? 1 : 0;
    const confidence = Math.round(
      ((originCoverage +
        htsCoverage +
        embargoDataLoaded +
        embargoScreeningRan +
        forcedLaborScreeningRan +
        endUseScreeningRan +
        endUserScreeningRan +
        antiBoycottScreeningRan +
        militaryEndUseScreeningRan) /
        9) *
        100
    );
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
          forcedLaborScreeningStatus: forcedLaborScreening?.status ?? null,
          endUseScreeningStatus: endUseScreening?.status ?? null,
          endUserScreeningStatus: endUserScreening?.status ?? null,
          antiBoycottScreeningStatus: antiBoycottScreening?.status ?? null,
          militaryEndUseScreeningStatus: militaryEndUseScreening?.status ?? null,
        };

        const prompt = `${SYNTHESIS_SYSTEM_PROMPT}\n\nEVIDENCE:\n${JSON.stringify(evidence, null, 2)}`;

        const response = await this.aiClient.models.generateContent({
          model: aiModel("compliance-audit"),
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: synthesisSchema,
            temperature: 0.1,
          },
        });

        // Accounting only — see meterGeminiCall. Never refuses and never throws.
        await meterGeminiCall(
          "compliance-audit",
          { accountId: input.accountId, userId: input.userId },
          response
        );

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
          purpose: "CBP pre-filing compliance rules execution (PGA, ADD/CVD, UFLPA, Country Embargo)",
          dataSources: [
            aiProvider,
            "Internal ADD/CVD Alert Table",
            "EmbargoRule Reference Table (OFAC/UFLPA)",
            ...(countryEmbargoScreening ? ["Country Embargo Screening (countries / country_by_country_maps)"] : []),
            ...(forcedLaborScreening ? ["UFLPA Entity List Reference Table (ScreeningEntity)"] : []),
            ...(endUseScreening ? ["Restricted End-Use Keyword Reference Table (ComplianceKeywordRule)"] : []),
            ...(endUserScreening ? ["BIS Entity List / Unverified List Reference Table (ScreeningEntity)"] : []),
            ...(antiBoycottScreening ? ["Anti-Boycott Country Flag (countries) + Keyword Reference Table (ComplianceKeywordRule)"] : []),
            ...(militaryEndUseScreening ? ["Military End-Use Keyword Reference Table + Military End User (MEU) List (ComplianceKeywordRule / ScreeningEntity)"] : []),
          ],
          regulations: [
            "19 CFR § 141.86",
            "UFLPA (Public Law 117-78)",
            "19 CFR Part 159 (ADD/CVD)",
            "15 CFR Part 744 (End-Use / End-User / Military End-Use Controls)",
            "15 CFR Part 760 (Anti-Boycott Regulations)",
          ],
          modelVersion: aiProvider.includes("Gemini") ? aiModel("compliance-audit") : null,
          promptVersion: aiProvider.includes("Gemini") ? hashPromptVersion(SYNTHESIS_SYSTEM_PROMPT) : null,
          proposedDescription: `Compliance check for ${lineItems.length} line item(s)`,
          rulesApplied: Array.from(new Set(auditResults.map((r) => r.ruleName))),
          evidenceItems: {
            auditResults,
            flags,
            embargoRulesLoaded: embargoRules.length,
            countryEmbargoScreening,
            forcedLaborScreening,
            endUseScreening,
            endUserScreening,
            antiBoycottScreening,
            militaryEndUseScreening,
          } as unknown as Prisma.InputJsonValue,
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
          action: AuditAction.AGENT_EXECUTION_COMPLETED,
          entity: "AGENT_DECISION",
          entityId: agentDecisionId,
          source: "SYSTEM",
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
      countryEmbargoScreening,
      forcedLaborScreening,
      endUseScreening,
      endUserScreening,
      antiBoycottScreening,
      militaryEndUseScreening,
    };
  }
}
