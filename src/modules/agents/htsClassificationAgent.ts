import { GoogleGenAI, Type, Schema } from "@google/genai";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { meterGeminiCall } from "@/lib/ai/aiMeter";
import { aiModel } from "@/lib/ai/aiModel";
import { agentEventBus } from "@/modules/intake/documentIntakeAgent";
import { Prisma } from "@prisma/client";
import { logAgentError } from "./agentLogger";
import { HtsNodeRepository } from "@/repositories/htsNodeRepository";

// Real, ingested HTS Master Release data (29k+ classifiable nodes, 50k+
// parsed duty rate rows) -- looks up the General column rate for a
// 10-digit HTS code, in dotted display format ("8481.80.5090").
function realGeneralDutyRate(node: { dutyRates: { rateColumn: string; rawRateText: string }[] } | null): string | null {
  const general = node?.dutyRates.find((r) => r.rateColumn === "General");
  return general?.rawRateText ?? null;
}

export interface ClassificationResultItem {
  lineNumber: number;
  productDescription: string;
  htsCode: string;
  htsDescription: string;
  dutyRate: string;
  griCitations: string[];
  crossRulings: string[];
  confidence: number;
  evaluatorScore: number | null;
  evaluatorCritique: string;
  refinementTurns: number;
  legalRationale: string;
}

interface HtsModelResult {
  htsCode: string;
  htsDescription: string;
  dutyRate: string;
  griCitations: string[];
  crossRulings: string[];
  confidence: number;
  legalRationale: string;
  evaluatorScore?: number | null;
}

export interface HTSClassificationInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  documentId?: string | null;
  productProfiles: Array<{
    lineNumber: number;
    rawDescription: string;
    enrichedDescription?: string;
    essentialCharacter?: string;
    // The rest of what Product Intelligence discovered -- previously dropped
    // before reaching this agent, even though material composition in
    // particular drives GRI 1 chapter/heading selection directly.
    materialComposition?: string | null;
    endUse?: string | null;
    finish?: string | null;
    carbonContentPercentage?: number | null;
    casNumber?: string | null;
  }>;
  /** From the shipment's accumulated context, when known. */
  countryOfOrigin?: string | null;
}

export interface HTSClassificationOutput {
  shipmentId: string;
  status: "Completed" | "Review Required" | "BLOCKED_MISSING_DESCRIPTION";
  classifications: ClassificationResultItem[];
  overallConfidence: number;
  reasoningChain: string;
  agentDecisionId: string | null;
  aiProviderUsed: string;
  debugError?: string;
}

const htsSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    htsCode: { type: Type.STRING },
    htsDescription: { type: Type.STRING },
    dutyRate: { type: Type.STRING },
    griCitations: { type: Type.ARRAY, items: { type: Type.STRING } },
    crossRulings: { type: Type.ARRAY, items: { type: Type.STRING } },
    confidence: { type: Type.INTEGER },
    legalRationale: { type: Type.STRING },
  },
  required: ["htsCode", "htsDescription", "dutyRate", "griCitations", "legalRationale", "confidence"],
};

export const HTS_CLASSIFICATION_SYSTEM_PROMPT = `
ROLE

You are Qubere's HTS Classification Agent, stage 4 of the customs
compliance pipeline. You receive an enriched product profile and must
resolve the most specific defensible 10-digit HTSUS classification. Your
output feeds directly into duty calculation, origin qualification, and
the CBP Form 7501 filing — a wrong or overconfident answer here has real
tariff and penalty consequences, so precision and honesty about
uncertainty matter more than always producing a clean answer.


GROUNDING RULES

1. Apply GRI 1 through 6 in strict order and cite which GRI(s) actually
   drove the classification — don't cite GRI 6 out of habit if GRI 1
   alone resolved it.
2. Only cite a CBP CROSS ruling number if you are genuinely confident it
   exists and is on point. If you are not certain, return an empty
   crossRulings array — a fabricated or misremembered ruling number cited
   with confidence is worse than no citation at all in a compliance
   filing.
3. The DB candidate codes you're given are a starting reference, not a
   default answer — override them when the product description supports
   a more specific or different code, and explain why.
4. If the product description (even enriched) doesn't support a
   defensible classification, return htsCode = "UNCLASSIFIABLE" with a
   clear explanation in legalRationale — do not force-fit the closest DB
   candidate just to return something.
5. confidence must reflect genuine classification certainty. A vague or
   ambiguous product should score low even if you're able to name a
   plausible-looking code — plausible is not the same as defensible.
6. dutyRate must come from the HTSUS schedule for the code you selected —
   never estimate or round a rate you're not sure of; if uncertain, say
   so in legalRationale rather than stating a specific percentage.


CLASSIFICATION PROCESS

1. Read the raw description, enriched description, and essential
   character together — the essential character (GRI 3(b)) matters most
   for composite or multi-material products.
2. Work through GRI 1 (terms of headings and section/chapter notes)
   first; only move to GRI 2-6 if GRI 1 doesn't resolve it cleanly.
3. Select the most specific 10-digit code the evidence supports — don't
   round up to a broader heading just because it feels safer.
4. State the general (non-preferential) rate of duty from the HTSUS 2026
   schedule for that exact code.
5. legalRationale should be a short, defensible legal explanation a
   licensed customs broker could review and sign off on — not a
   restatement of the product description.
`;

export class HTSClassificationAgent {
  private static aiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
  });

  static async execute(input: HTSClassificationInput): Promise<HTSClassificationOutput> {
    let aiProvider = process.env.GEMINI_API_KEY
      ? "Gemini 2.5 Flash HTS Classification Engine"
      : "Deterministic HTS DB Lookup (No API Key)";
    let debugError: string | undefined = undefined;

    // Prerequisite gate
    const hasValidDescription = input.productProfiles.some((p) => {
      const d = (p.rawDescription || "").toLowerCase();
      return (
        d.length > 5 &&
        !d.startsWith("screenshot") &&
        !d.includes("needs classification") &&
        !d.includes("general cargo")
      );
    });

    if (input.productProfiles.length === 0 || !hasValidDescription) {
      const reasoningChain =
        "HTS Classification Gating STOPPED: Product description is missing or invalid. HTS codes will NOT be assigned to unknown goods per 19 CFR Part 152.";

      // Null, not a synthetic id: a failed write produced no AgentDecision row.
      let agentDecisionId: string | null = null;
      try {
        const agentDecision = await db.agentDecision.create({
          data: {
            accountId: input.accountId,
            shipmentId: input.shipmentId,
            documentId: input.documentId ?? null,
            agentName: "HTS Classification Agent",
            agentIcon: "BookOpen",
            status: "Needs Review",
            confidence: 0,
            decisionSummary:
              "HTS Classification Gating: Paused because product description is missing or unverified.",
            purpose: "HTS 10-digit classification and GRI ruling legal analysis",
            dataSources: ["HTS Classification Gate"],
            regulations: ["19 CFR Part 152", "General Rules of Interpretation (GRI 1-6)"],
            proposedDescription: "BLOCKED_MISSING_DESCRIPTION",
            rulesApplied: ["Product Description Validation Prerequisite Rule"],
          },
        });
        agentDecisionId = agentDecision.id;
      } catch (err) {
        debugError = logAgentError(
          "HTS Classification Agent",
          input.shipmentId,
          "DB agentDecision create (blocked path)",
          err
        );
      }

      return {
        shipmentId: input.shipmentId,
        status: "BLOCKED_MISSING_DESCRIPTION",
        classifications: [],
        overallConfidence: 0,
        reasoningChain,
        agentDecisionId,
        aiProviderUsed: aiProvider,
        debugError,
      };
    }

    const results: ClassificationResultItem[] = [];

    for (const item of input.productProfiles) {
      // Seed candidates from the real, ingested HTS Master Release data
      // (HtsNode/HtsDutyRate -- 29k+ classifiable nodes, 50k+ parsed duty
      // rate rows) instead of the near-empty legacy HTSCode table, and
      // include each candidate's real General duty rate so the LLM is
      // grounded in actual rate data rather than recalling one from memory.
      const keyword = (item.rawDescription || "").split(" ").find((w) => w.length > 3) || "";
      let htsCandidates: Awaited<ReturnType<typeof HtsNodeRepository.searchNodes>>["items"] = [];
      try {
        if (keyword) {
          const result = await HtsNodeRepository.searchNodes({ q: keyword, level: 10, limit: 3 });
          htsCandidates = result.items;
        }
      } catch (err) {
        debugError = logAgentError(
          "HTS Classification Agent",
          input.shipmentId,
          "HTS DB candidate lookup",
          err
        );
      }

      const candidateContext =
        htsCandidates.length > 0
          ? htsCandidates
              .map((c) => `${c.htsNumberDisplay}: ${c.description} (General duty rate: ${realGeneralDutyRate(c) ?? "not on file"})`)
              .join("\n")
          : "No DB candidates found.";

      // Try real Gemini call
      let htsResult: HtsModelResult | null = null;

      if (process.env.GEMINI_API_KEY) {
        try {
          const prompt = `${HTS_CLASSIFICATION_SYSTEM_PROMPT}

Product Description: "${item.rawDescription}"
${item.enrichedDescription ? `Enriched Description: "${item.enrichedDescription}"` : ""}
${item.essentialCharacter ? `Essential Character (GRI 3(b)): "${item.essentialCharacter}"` : ""}
${item.materialComposition ? `Material Composition: "${item.materialComposition}"` : ""}
${item.endUse ? `End Use: "${item.endUse}"` : ""}
${item.finish ? `Finish: "${item.finish}"` : ""}
${item.carbonContentPercentage != null ? `Carbon Content: ${item.carbonContentPercentage}%` : ""}
${item.casNumber ? `CAS Number: "${item.casNumber}"` : ""}
${input.countryOfOrigin ? `Country of Origin (from shipment context): "${input.countryOfOrigin}"` : ""}

DB Candidate HTS codes (use as reference, override if wrong):
${candidateContext}`;

          const response = await this.aiClient.models.generateContent({
            model: aiModel("hts-classification"),
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              responseMimeType: "application/json",
              responseSchema: htsSchema,
              temperature: 0.1,
            },
          });

          // Accounting only. Cannot refuse, cannot throw, does not touch the
          // response — classification behaves identically whether or not the
          // usage table exists. Inside the same try as the call, so a metering
          // failure would fall into the existing Gemini catch and the
          // deterministic path, but meterGeminiCall swallows its own errors so it
          // will not get there.
          await meterGeminiCall(
            "hts-classification",
            { accountId: input.accountId, userId: input.userId },
            response
          );

          const parsed = JSON.parse(response.text || "{}");
          if (parsed.htsCode) {
            htsResult = parsed;
            aiProvider = "Gemini 2.5 Flash HTS Classification Engine";

            // Ground the LLM's recalled duty rate in the real ingested HTS
            // data rather than trusting what it remembered. If the code it
            // returned resolves to a real node, override dutyRate with the
            // actual General column rate; if it doesn't resolve (wrong
            // format, hallucinated code), say so honestly instead of
            // presenting an ungrounded rate as if it were verified.
            try {
              const normalizedCode = String(parsed.htsCode).replace(/[^0-9]/g, "");
              const matchedNode = normalizedCode ? await HtsNodeRepository.findByNormalizedCode(normalizedCode) : null;
              const realRate = realGeneralDutyRate(matchedNode);
              parsed.dutyRate =
                realRate !== null ? realRate : "Duty rate unverified — code not found in HTS Master Release data";
            } catch (err) {
              debugError = logAgentError(
                "HTS Classification Agent",
                input.shipmentId,
                "HTS duty rate grounding lookup",
                err
              );
            }
          }
        } catch (err: unknown) {
          debugError = logAgentError(
            "HTS Classification Agent",
            input.shipmentId,
            "Gemini generateContent",
            err
          );
        }
      }

      // Fallback: use DB candidate with low confidence and clear labeling — NO fabricated rulings or codes
      if (!htsResult) {
        const dbCandidate = htsCandidates[0];
        const fallbackCode = dbCandidate?.htsNumberDisplay || "UNCLASSIFIABLE";
        const fallbackDesc = dbCandidate?.description || `No DB match for: ${item.rawDescription}`;
        const fallbackRate = realGeneralDutyRate(dbCandidate ?? null);
        const lowConfidence = htsCandidates.length > 0 ? 35 : 0;
        const rationaleReason = debugError
          ? `Gemini API call failed (${debugError}). `
          : "Gemini API unavailable. ";

        htsResult = {
          htsCode: fallbackCode,
          htsDescription: fallbackDesc,
          // The CODE itself is still an unverified low-confidence keyword
          // match, not a confirmed classification -- but if we are showing
          // this candidate code, its rate should be the real one on file
          // for it, not a placeholder string.
          dutyRate: fallbackRate ?? "Duty rate unverified — requires classification review",
          griCitations: [],
          crossRulings: [], // Never fabricate a citation
          confidence: lowConfidence,
          legalRationale: `${rationaleReason}DB candidate used as unverified low-confidence suggestion (${lowConfidence}% confidence). Requires human broker classification review before filing.`,
        };

        if (!process.env.GEMINI_API_KEY) {
          aiProvider = "Deterministic HTS DB Lookup (No API Key)";
        }
      }

      if (htsResult) {
        results.push({
          lineNumber: item.lineNumber,
          productDescription: item.rawDescription,
          htsCode: htsResult.htsCode,
          htsDescription: htsResult.htsDescription,
          dutyRate: htsResult.dutyRate,
          griCitations: htsResult.griCitations,
          crossRulings: htsResult.crossRulings,
          confidence: htsResult.confidence,
          evaluatorScore: htsResult.evaluatorScore ?? null,
          evaluatorCritique: htsResult.evaluatorScore
            ? "Evaluator-Optimizer Turn 2 confirmed."
            : "Single-pass classification. Evaluator refinement loop pending.",
          refinementTurns: 1,
          legalRationale: htsResult.legalRationale,
        });
      }
    }

    const overallConfidence =
      results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.confidence, 0) / results.length)
        : 0;
    const requiresReview = overallConfidence < 70;

    const reasoningChain = `Classified ${results.length} line item(s). Overall confidence: ${overallConfidence}%. AI provider: ${aiProvider}.${debugError ? " Note: fallback used due to extraction error." : ""}`;

    // One AgentDecision per line item, not one for the whole batch -- a
    // shipment with N line items used to get only line 1 into the review
    // queue (results[0]), so approving it could never touch lines 2+. Each
    // decision carries its own lineNumber so decisions/route.ts can target
    // the exact ShipmentLineItem it's about.
    let agentDecisionId: string | null = null;
    for (const result of results) {
      const lineRequiresReview = result.confidence < 70;
      try {
        const agentDecision = await db.agentDecision.create({
          data: {
            accountId: input.accountId,
            shipmentId: input.shipmentId,
            documentId: input.documentId ?? null,
            agentName: "HTS Classification Agent",
            agentIcon: "BookOpen",
            status: lineRequiresReview ? "Needs Review" : "Approved",
            confidence: result.confidence,
            lineNumber: result.lineNumber,
            decisionSummary: `Classification for line ${result.lineNumber} (${result.productDescription}): HTS ${result.htsCode} (Confidence: ${result.confidence}%).`,
            purpose: "10-Digit HTS code resolution via Gemini legal reasoning and CBP CROSS ruling lookup",
            dataSources: ["HTSUS 2026 Rev 1", "CBP CROSS Rulings Database", aiProvider],
            regulations: ["19 U.S.C. § 1202", "GRI 1-6"],
            // No existing classification is read here, so there is no current code.
            currentHtsCode: null,
            proposedHtsCode: result.htsCode,
            proposedDescription: result.htsDescription,
            rulesApplied: ["GRI 1-6 Legal Verification", "HTSUS Chapter/Section Note Analysis"],
            evidenceItems: { result, reasoningChain } as unknown as Prisma.InputJsonValue,
          },
        });
        agentDecisionId = agentDecisionId ?? agentDecision.id;

        await createAuditLog({
          accountId: input.accountId,
          userId: input.userId,
          action: "AGENT_EXECUTION_COMPLETED",
          entity: "AGENT_DECISION",
          entityId: agentDecision.id,
          metadata: { agentName: "HTS Classification Agent", lineNumber: result.lineNumber, confidence: result.confidence },
        }).catch((err) => {
          debugError = logAgentError("HTS Classification Agent", input.shipmentId, "createAuditLog", err);
        });
      } catch (err) {
        debugError = logAgentError(
          "HTS Classification Agent",
          input.shipmentId,
          `DB agentDecision create (line ${result.lineNumber})`,
          err
        );
      }
    }

    const output: HTSClassificationOutput = {
      shipmentId: input.shipmentId,
      status: requiresReview ? "Review Required" : "Completed",
      classifications: results,
      overallConfidence,
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
      debugError,
    };

    agentEventBus.emit("classification:completed", output);
    return output;
  }
}
