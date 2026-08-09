import { GoogleGenAI, Type, Schema } from "@google/genai";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { agentEventBus } from "@/modules/intake/documentIntakeAgent";
import { Prisma } from "@prisma/client";
import { logAgentError } from "./agentLogger";

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

/** The HTS reference row fields this agent reads. */
interface HtsCandidate {
  htsCode10?: string | null;
  htsNumberDisplay?: string | null;
  description?: string | null;
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
  productProfiles: Array<{
    lineNumber: number;
    rawDescription: string;
    enrichedDescription?: string;
    essentialCharacter?: string;
  }>;
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
      // Seed DB candidates: query on first meaningful word of description for context
      const keyword = (item.rawDescription || "").split(" ").find((w) => w.length > 3) || "";
      let htsCandidates: HtsCandidate[] = [];
      try {
        if (keyword) {
          htsCandidates = await db.hTSCode.findMany({
            where: { description: { contains: keyword, mode: "insensitive" } },
            take: 3,
          });
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
              .map((c) => `${c.htsCode10}: ${c.description}`)
              .join("\n")
          : "No DB candidates found.";

      // Try real Gemini call
      let htsResult: HtsModelResult | null = null;

      if (process.env.GEMINI_API_KEY) {
        try {
          const prompt = `${HTS_CLASSIFICATION_SYSTEM_PROMPT}

Product Description: "${item.rawDescription}"
${item.enrichedDescription ? `Enriched Description: "${item.enrichedDescription}"` : ""}
${item.essentialCharacter ? `Essential Character: "${item.essentialCharacter}"` : ""}

DB Candidate HTS codes (use as reference, override if wrong):
${candidateContext}`;

          const response = await this.aiClient.models.generateContent({
            model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              responseMimeType: "application/json",
              responseSchema: htsSchema,
              temperature: 0.1,
            },
          });

          const parsed = JSON.parse(response.text || "{}");
          if (parsed.htsCode) {
            htsResult = parsed;
            aiProvider = "Gemini 2.5 Flash HTS Classification Engine";
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
        const fallbackCode = dbCandidate?.htsCode10 || dbCandidate?.htsNumberDisplay || "UNCLASSIFIABLE";
        const fallbackDesc = dbCandidate?.description || `No DB match for: ${item.rawDescription}`;
        const lowConfidence = htsCandidates.length > 0 ? 35 : 0;
        const rationaleReason = debugError
          ? `Gemini API call failed (${debugError}). `
          : "Gemini API unavailable. ";

        htsResult = {
          htsCode: fallbackCode,
          htsDescription: fallbackDesc,
          dutyRate: "Duty rate unverified — requires classification review",
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

    let agentDecisionId: string | null = null;
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          agentName: "HTS Classification Agent",
          agentIcon: "BookOpen",
          status: requiresReview ? "Needs Review" : "Approved",
          confidence: overallConfidence,
          decisionSummary: `Classification for ${input.productProfiles[0]?.rawDescription}: HTS ${results[0]?.htsCode} (Confidence: ${overallConfidence}%).`,
          purpose: "10-Digit HTS code resolution via Gemini legal reasoning and CBP CROSS ruling lookup",
          dataSources: ["HTSUS 2026 Rev 1", "CBP CROSS Rulings Database", aiProvider],
          regulations: ["19 U.S.C. § 1202", "GRI 1-6"],
          // No existing classification is read here, so there is no current code.
          currentHtsCode: null,
          proposedHtsCode: results[0]?.htsCode,
          proposedDescription: results[0]?.htsDescription,
          rulesApplied: ["GRI 1-6 Legal Verification", "HTSUS Chapter/Section Note Analysis"],
          evidenceItems: { results, reasoningChain } as unknown as Prisma.InputJsonValue,
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      debugError = logAgentError(
        "HTS Classification Agent",
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
          metadata: { agentName: "HTS Classification Agent", classificationsCount: results.length, overallConfidence },
        });
      } catch (err) {
        debugError = logAgentError(
          "HTS Classification Agent",
          input.shipmentId,
          "createAuditLog",
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
