import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { aiQuotaGate } from "@/lib/ai/aiQuotaGate";
import { aiModel } from "@/lib/ai/aiModel";
import { meterGeminiCall } from "@/lib/ai/aiMeter";
import { computeAnalyticsMetrics } from "@/lib/analytics/metricComputer";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

// Same client pattern as src/modules/agents/htsClassificationAgent.ts and
// src/modules/assistant/orchestrator.ts — same env var, same "no key
// configured" story, no new vendor setup.
const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// D-5: a bare HTS code is an exact-lookup question, not an advisory one —
// answer it directly from reference data so it costs no LLM tokens and no
// quota, and route everything else to the full reasoning path below.
const BARE_HTS_CODE = /^\d{4}(\.\d{2,4})+$/;

const advisorySchema: Schema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING },
    citations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["answer", "citations"],
};

function templateFallback(query: string, updates: { title: string }[]): { answer: string; citations: string[] } {
  const answer = `Based on current U.S. International Trade Commission (USITC) and CBP regulations:
- ${query.toLowerCase().includes("china") || query.toLowerCase().includes("301") ? "Section 301 tariffs apply an additional 7.5% - 25% duty rate on items of Chinese origin unless covered by an active exclusion." : "General HTS duty rates apply with preferential tariffs available under active Free Trade Agreements (USMCA, KORUS)."}
- Importers must exercise Reasonable Care under 19 U.S.C. 1508 by maintaining commercial invoices, packing lists, and origin certificates for 5 years.`;

  return {
    answer,
    citations: [
      "19 U.S.C. 1508 - Recordkeeping Requirements",
      "General Rules of Interpretation (GRI 1 & 6)",
      "19 CFR Part 102 - Rules of Origin",
      ...updates.map((u) => u.title),
    ],
  };
}

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = await req.json();
  const { query } = body;

  if (!query || typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "Query prompt is required" });
  }
  const trimmed = query.trim();

  const updates = await db.regulatoryUpdate.findMany({
    orderBy: { effectiveDate: "desc" },
    take: 5,
});

  // D-5: bare HTS code — direct reference lookup, no LLM call.
  if (BARE_HTS_CODE.test(trimmed)) {
    const result = await HtsSearchService.search({ q: trimmed, limit: 5 });
    return NextResponse.json({
      answer:
        result.items.length > 0
          ? `HTS ${trimmed}: ${result.items.map((r) => `${r.htsNumberDisplay} — ${r.description}`).join("; ")}`
          : `No HTS reference entry found for "${trimmed}".`,
      citations: result.items.map((r) => `HTSUS ${r.htsNumberDisplay}`),
      regulatoryUpdates: updates,
    });
  }

  const quotaResponse = await aiQuotaGate({
    accountId: ctx.accountId,
    userId: ctx.userId,
    surface: "advisory",
    requestId,
  });
  if (quotaResponse) return quotaResponse;

  if (!process.env.GEMINI_API_KEY) {
    const fallback = templateFallback(trimmed, updates);
    return NextResponse.json({ ...fallback, regulatoryUpdates: updates });
  }

  try {
    const metrics = await computeAnalyticsMetrics(ctx.accountId);

    const prompt = `You are Qubere's trade compliance advisory assistant. Answer the user's
question using ONLY the account data and regulatory updates provided below —
never invent a citation, a dollar figure, or a specific product/shipment
detail that isn't in this context. If the question is about a specific
product's classification rationale or a specific shipment's filing
readiness and that detail isn't in the context below, say so plainly and
tell the user to ask the interactive Chat Assistant instead, which can look
up that specific record.

ACCOUNT METRICS (real, from this account):
- Open exceptions: ${metrics.openExceptions}
- Filed entries: ${metrics.filedEntries}
- Average duty per entry: $${metrics.dutyPerEntry.toFixed(2)}
- First-pass rate: ${(metrics.firstPassRate * 100).toFixed(1)}%
- Median cycle time: ${metrics.cyclTimeMedianHours.toFixed(1)} hours
- Post-summary corrections (PSC) count: ${metrics.pscCount}

RECENT REGULATORY UPDATES:
${updates.map((u) => `- [${u.jurisdiction}/${u.category}] ${u.title} (effective ${u.effectiveDate.toISOString().slice(0, 10)}, impact: ${u.impactLevel})`).join("\n") || "(none on file)"}

USER QUESTION: ${trimmed}

Respond with a concise answer and a citations array. Citations must be
either a regulatory update title from the list above, or a well-known
citable authority (statute, CFR part, GRI rule) — never a fabricated
document number.`;

    const response = await aiClient.models.generateContent({
      model: aiModel("advisory"),
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: advisorySchema,
        temperature: 0.1,
      },
    });

    await meterGeminiCall("advisory", { accountId: ctx.accountId, userId: ctx.userId }, response);

    const parsed = JSON.parse(response.text || "{}") as { answer?: string; citations?: string[] };
    if (parsed.answer) {
      return NextResponse.json({
        answer: parsed.answer,
        citations: parsed.citations ?? [],
        regulatoryUpdates: updates,
      });
    }
  } catch (err) {
    console.error("[advisory/query] Gemini call failed, falling back to template:", err);
  }

  const fallback = templateFallback(trimmed, updates);
  return NextResponse.json({ ...fallback, regulatoryUpdates: updates });

}, { permission: "ai.use", write: true });
