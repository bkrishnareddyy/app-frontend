import { GoogleGenAI, Type, Schema } from "@google/genai";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { agentEventBus } from "@/modules/intake/documentIntakeAgent";
import { Prisma } from "@prisma/client";
import { logAgentError } from "./agentLogger";

export interface EnrichedProductProfile {
  sku: string;
  rawDescription: string;
  enrichedDescription: string;
  materialComposition: string;
  essentialCharacter: string;
  carbonContentPercentage?: number | null;
  finish?: string | null;
  casNumber?: string | null;
  endUse: string;
  confidence: number;
}

export interface ProductIntelligenceInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  documentId?: string | null;
  lineItems: Array<{
    lineNumber: number;
    sku?: string;
    description: string;
    /** From the shipment's accumulated context, when known -- manufacturing conventions vary enough by country to sharpen material/finish inference. */
    countryOfOrigin?: string | null;
  }>;
}

export interface ProductIntelligenceOutput {
  shipmentId: string;
  status: "Completed" | "Review Required" | "WAITING_FOR_EXTRACTION";
  profiles: EnrichedProductProfile[];
  confidence: number;
  reasoningChain: string;
  agentDecisionId: string | null;
  aiProviderUsed: string;
  debugError?: string;
}

const productSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    enrichedDescription: { type: Type.STRING },
    materialComposition: { type: Type.STRING },
    essentialCharacter: { type: Type.STRING },
    carbonContentPercentage: { type: Type.NUMBER, nullable: true },
    finish: { type: Type.STRING, nullable: true },
    casNumber: { type: Type.STRING, nullable: true },
    endUse: { type: Type.STRING },
    confidence: { type: Type.INTEGER },
  },
  required: ["enrichedDescription", "materialComposition", "essentialCharacter", "endUse", "confidence"],
};

export const PRODUCT_INTELLIGENCE_SYSTEM_PROMPT = `
ROLE

You are Qubere's Product Intelligence Agent, stage 3 of the customs
compliance pipeline. You receive a single line-item description already
extracted from a trade document — no image, no additional context beyond
what's given — and your job is to enrich it with the material and
commercial detail an HTS classifier needs. You do not assign an HTS code
yourself; that's the next agent's job.


GROUNDING RULES

1. Base every field on what the description actually says, or what can be
   reasonably and defensibly inferred from standard trade terminology for
   that exact product — never default to a generic guess (e.g. assuming
   "steel" or "metal" for a vague description) just to fill the field.
2. If the description is too vague to support a specific material,
   finish, or end-use, say so honestly in the relevant field ("Material
   not specified in description") and set confidence low — do not
   substitute a plausible-sounding default.
3. carbonContentPercentage and casNumber are almost always unknown from a
   line-item description alone — leave them null unless the description
   itself states or clearly implies a specific grade or chemical
   identity.
4. confidence must reflect genuine certainty about the enrichment given
   only the input description — a one-line description like "parts" or
   "general cargo" should score very low, not a comfortable middle value.


ENRICHMENT FIELDS

1. enrichedDescription — expand with specific trade terms (material,
   grade, dimensions, finish) useful for HTS classification, staying
   within what the input actually supports.
2. materialComposition — primary material(s), e.g. "304 stainless steel
   alloy" or "100% cotton woven fabric" — only if determinable.
3. essentialCharacter — what gives this product its essential character
   under GRI 3(b), grounded in the specific product, not a generic
   category. Composite or unclear items should say so explicitly rather
   than picking one material to feature.
4. carbonContentPercentage — only if steel/iron and a grade or spec is
   stated or clearly implied; otherwise null.
5. finish — surface treatment if stated (e.g. "hot-dip galvanized",
   "polished"); otherwise null.
6. casNumber — only if this is a named chemical with a well-known CAS
   number; otherwise null.
7. endUse — commercial end use if determinable from the description;
   otherwise "Not determined from description".
8. confidence — 0-100, reflecting real certainty given only the input
   description. Vague or generic descriptions should score low.
`;

export class ProductIntelligenceAgent {
  private static aiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
  });

  static async execute(input: ProductIntelligenceInput): Promise<ProductIntelligenceOutput> {
    let aiProvider = process.env.GEMINI_API_KEY
      ? "Gemini 2.5 Flash Product Intelligence Engine"
      : "Deterministic Product Parser (No API Key)";
    let debugError: string | undefined = undefined;

    const hasValidDescription = input.lineItems.some((item) => {
      const d = (item.description || "").toLowerCase();
      return (
        d.length > 5 &&
        !d.startsWith("screenshot") &&
        !d.includes("needs classification") &&
        !d.includes("general cargo")
      );
    });

    if (!hasValidDescription) {
      const reasoningChain =
        "Product Intelligence Gating STOPPED: No valid product description present. Status set to WAITING_FOR_EXTRACTION.";

      // Null, not a synthetic id: a failed write produced no AgentDecision row.
      let agentDecisionId: string | null = null;
      try {
        const agentDecision = await db.agentDecision.create({
          data: {
            accountId: input.accountId,
            shipmentId: input.shipmentId,
            documentId: input.documentId ?? null,
            agentName: "Product Intelligence Agent",
            agentIcon: "Boxes",
            status: "Needs Review",
            triageState: "BLOCKED",
            blockedReason: "WAITING_FOR_EXTRACTION",
            confidence: 0,
            decisionSummary:
              "Product Intelligence Gating: Missing valid product description. Pipeline paused.",
            purpose: "SKU catalog enrichment and essential character analysis",
            dataSources: ["Product Intelligence Gate"],
            regulations: ["GRI 3(b) Essential Character"],
            proposedDescription: "WAITING_FOR_EXTRACTION",
            rulesApplied: ["Product Description Validation Prerequisite Rule"],
          },
        });
        agentDecisionId = agentDecision.id;
      } catch (err) {
        debugError = logAgentError(
          "Product Intelligence Agent",
          input.shipmentId,
          "DB agentDecision create (blocked path)",
          err
        );
      }

      return {
        shipmentId: input.shipmentId,
        status: "WAITING_FOR_EXTRACTION",
        profiles: [],
        confidence: 0,
        reasoningChain,
        agentDecisionId,
        aiProviderUsed: aiProvider,
        debugError,
      };
    }

    const profiles: EnrichedProductProfile[] = [];

    for (const item of input.lineItems) {
      const desc = item.description || "Unspecified Item";
      let enriched: Partial<EnrichedProductProfile> | null = null;

      if (process.env.GEMINI_API_KEY) {
        try {
          const prompt = `${PRODUCT_INTELLIGENCE_SYSTEM_PROMPT}

Raw Description: "${desc}"
${item.countryOfOrigin ? `Country of Origin (from shipment context, if it informs typical material/finish conventions): "${item.countryOfOrigin}"` : ""}`;

          const response = await this.aiClient.models.generateContent({
            model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              responseMimeType: "application/json",
              responseSchema: productSchema,
              temperature: 0.2,
            },
          });

          const parsed = JSON.parse(response.text || "{}");
          if (parsed.enrichedDescription) {
            enriched = parsed;
            aiProvider = "Gemini 2.5 Flash Product Intelligence Engine";
          }
        } catch (err: unknown) {
          debugError = logAgentError(
            "Product Intelligence Agent",
            input.shipmentId,
            "Gemini generateContent",
            err
          );
        }
      }

      // Fallback: return raw description unchanged — do not fabricate enrichment
      if (!enriched) {
        enriched = {
          enrichedDescription: desc,
          materialComposition: "Not determined — enrichment requires Gemini API",
          essentialCharacter: "Not determined — requires Gemini enrichment or manual classification review",
          carbonContentPercentage: null,
          finish: null,
          casNumber: null,
          endUse: "Not determined",
          confidence: 10,
        };
        if (!process.env.GEMINI_API_KEY) {
          aiProvider = "Deterministic Product Parser (No API Key)";
        }
      }

      profiles.push({
        sku: item.sku || `SKU-${Date.now().toString().slice(-4)}`,
        rawDescription: desc,
        enrichedDescription: enriched.enrichedDescription || desc,
        materialComposition: enriched.materialComposition || "Not determined",
        essentialCharacter: enriched.essentialCharacter || "Not determined",
        carbonContentPercentage: enriched.carbonContentPercentage ?? null,
        finish: enriched.finish ?? null,
        casNumber: enriched.casNumber ?? null,
        endUse: enriched.endUse || "Not determined",
        confidence: enriched.confidence ?? 10,
      });
    }

    const overallConfidence =
      profiles.length > 0
        ? Math.round(profiles.reduce((sum, p) => sum + p.confidence, 0) / profiles.length)
        : 0;

    const reasoningChain = `Enriched ${profiles.length} product profile(s) using ${aiProvider}. Overall confidence: ${overallConfidence}%.${debugError ? " Note: Gemini enrichment failed; raw descriptions used." : ""}`;

    let agentDecisionId: string | null = null;
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          documentId: input.documentId ?? null,
          agentName: "Product Intelligence Agent",
          agentIcon: "Boxes",
          status: overallConfidence >= 50 ? "AUTO_VERIFIED" : "Needs Review",
          triageState: overallConfidence >= 50 ? "AUTO_VERIFIED" : "NEEDS_REVIEW",
          ...(overallConfidence >= 50 ? { autoApprovalPolicy: "product-intelligence-v1" } : {}),
          confidence: overallConfidence,
          decisionSummary: `Enriched ${profiles.length} product SKU profile(s). Confidence: ${overallConfidence}%.`,
          purpose: "SKU catalog enrichment, material composition breakdown, and essential character analysis",
          dataSources: [aiProvider],
          regulations: ["General Rules of Interpretation (GRI 1 & GRI 3)"],
          proposedDescription: `Enriched ${profiles[0]?.rawDescription || "Product SKU"}`,
          rulesApplied: ["GRI 3(b) Essential Character Analysis", "Material Breakdown Rule"],
          evidenceItems: { profiles, reasoningChain } as unknown as Prisma.InputJsonValue,
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      debugError = logAgentError(
        "Product Intelligence Agent",
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
          metadata: { agentName: "Product Intelligence Agent", profilesCount: profiles.length, overallConfidence },
        });
      } catch (err) {
        debugError = logAgentError(
          "Product Intelligence Agent",
          input.shipmentId,
          "createAuditLog",
          err
        );
      }
    }

    const output: ProductIntelligenceOutput = {
      shipmentId: input.shipmentId,
      status: overallConfidence >= 50 ? "Completed" : "Review Required",
      profiles,
      confidence: overallConfidence,
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
      debugError,
    };

    agentEventBus.emit("product:enriched", output);
    return output;
  }
}
