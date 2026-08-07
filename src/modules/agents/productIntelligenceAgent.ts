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
  lineItems: Array<{
    lineNumber: number;
    sku?: string;
    description: string;
  }>;
}

export interface ProductIntelligenceOutput {
  shipmentId: string;
  status: "Completed" | "Review Required" | "WAITING_FOR_EXTRACTION";
  profiles: EnrichedProductProfile[];
  confidence: number;
  reasoningChain: string;
  agentDecisionId: string;
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

      let agentDecisionId = "dec_fallback_product";
      try {
        const agentDecision = await db.agentDecision.create({
          data: {
            accountId: input.accountId,
            shipmentId: input.shipmentId,
            agentName: "Product Intelligence Agent",
            agentIcon: "Boxes",
            status: "Needs Review",
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
          const prompt = `You are Qubere's Product Intelligence Agent (Agent 3 of 10 in a Customs Compliance pipeline).
Analyze the following trade document line item and provide structured product enrichment for US customs classification.

Raw Description: "${desc}"

Instructions:
1. enrichedDescription: Expand the description with specific trade terms (material, grade, dimensions, finish) useful for HTS classification.
2. materialComposition: Identify primary materials (e.g. "304 Stainless Steel alloy", "100% Cotton woven fabric").
3. essentialCharacter: State what gives this product its essential character under GRI 3(b) (e.g. "Metal component — strength and hardness of steel alloy").
4. carbonContentPercentage: If steel/iron, estimate carbon % if determinable from description; otherwise null.
5. finish: Surface treatment if applicable (e.g. "Hot-dip galvanized", "Polished", null if unknown).
6. casNumber: CAS registry number if this is a chemical/material with a known CAS number; otherwise null.
7. endUse: Commercial end use (e.g. "Industrial fasteners for construction", "Consumer apparel retail").
8. confidence: 0-100 reflecting how certain you are about the enrichment given the input description.

If the description is too vague to enrich meaningfully, set confidence to 20 and note the ambiguity in enrichedDescription.`;

          const response = await this.aiClient.models.generateContent({
            model: "gemini-2.5-flash",
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
        } catch (err: any) {
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
          essentialCharacter: "Not determined — enrichment requires Gemini API",
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

    let agentDecisionId = "dec_fallback_product";
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          agentName: "Product Intelligence Agent",
          agentIcon: "Boxes",
          status: overallConfidence >= 50 ? "Approved" : "Needs Review",
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
