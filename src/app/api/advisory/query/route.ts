import { GoogleGenAI, Type, type Schema } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { aiQuotaGate } from "@/lib/ai/aiQuotaGate";
import { aiModel } from "@/lib/ai/aiModel";
import { meterGeminiCall } from "@/lib/ai/aiMeter";
import { computeAnalyticsMetrics } from "@/lib/analytics/metricComputer";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const BARE_HTS_CODE = /^\d{4}(\.\d{2,4})+$/;

const advisorySchema: Schema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING },
    citations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["answer", "citations"],
};

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = await req.json();
  const { query } = body;

  if (!query || typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "Query prompt is required" }, { status: 400 });
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

  const useAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const useGemini = Boolean(process.env.GEMINI_API_KEY);

  if (!useAnthropic && !useGemini) {
    return NextResponse.json({
      answer: "No AI provider is configured for advisory queries (ANTHROPIC_API_KEY or GEMINI_API_KEY is missing).",
      citations: [],
      regulatoryUpdates: updates,
    });
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
- Average duty per entry: ${metrics.dutyPerEntry === null ? "no filings with duty data yet" : `$${metrics.dutyPerEntry.toFixed(2)}`}
- First-pass rate: ${metrics.firstPassRate === null ? "no filings submitted yet" : `${metrics.firstPassRate.toFixed(1)}%`}
- Median cycle time: ${metrics.cyclTimeMedianHours === null ? "no terminal filings yet" : `${metrics.cyclTimeMedianHours.toFixed(1)} hours`}
- Post-summary corrections (PSC) count: ${metrics.pscCount}

RECENT REGULATORY UPDATES:
${updates.map((u) => `- [${u.jurisdiction}/${u.category}] ${u.title} (effective ${u.effectiveDate.toISOString().slice(0, 10)}, impact: ${u.impactLevel})`).join("\n") || "(none on file)"}

USER QUESTION: ${trimmed}

Respond with a JSON object in this exact format:
{
  "answer": "Concise summary answer based strictly on real context above",
  "citations": ["citation 1", "citation 2"]
}`;

    if (useAnthropic) {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const model = process.env.ADVISORY_MODEL || process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022";
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((c) => c.type === "text")?.text ?? "{}";
      const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : textBlock) as { answer?: string; citations?: string[] };
      if (parsed.answer) {
        return NextResponse.json({
          answer: parsed.answer,
          citations: parsed.citations ?? [],
          regulatoryUpdates: updates,
        });
      }
    } else {
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
    }
  } catch (err) {
    console.error("[advisory/query] AI model call failed:", err);
  }

  return NextResponse.json({
    answer: "Advisory analysis is temporarily unavailable due to a service error.",
    citations: [],
    regulatoryUpdates: updates,
  });

}, { permission: "ai.use", write: true });
