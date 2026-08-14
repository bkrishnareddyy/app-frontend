import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { aiModel } from "@/lib/ai/aiModel";
import { meterGeminiCall } from "@/lib/ai/aiMeter";

const extractionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    type: {
      type: Type.STRING,
      enum: ["TARIFF_RATE_CHANGE", "HTS_REVISION", "AD_CVD_ORDER", "EXCLUSION_GRANTED", "QUOTA", "POLICY"],
    },
    affectedHtsCodes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    effectiveDate: { type: Type.STRING },
    summary: { type: Type.STRING },
    actionRequired: { type: Type.BOOLEAN },
  },
  required: ["type", "affectedHtsCodes", "effectiveDate", "summary", "actionRequired"],
};

export const POST = withCronRoute(async ({ req, requestId }) => {
  // 1. Fetch Federal Register documents for Customs and Border Protection
  const url = "https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=u-s-customs-and-border-protection&per_page=20&order=newest";
  
  let documents = [];
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return NextResponse.json(
        { error: "Federal Register API fetch failed", status: response.status, requestId },
        { status: 502 }
      );
    }
    const data = await response.json();
    documents = data.results || [];
  } catch (error) {
    console.error("Federal Register fetch failed:", error);
    return NextResponse.json(
      { error: "Federal Register API fetch failed", details: String(error), requestId },
      { status: 502 }
    );
  }

  const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  const createdUpdates = [];

  for (const doc of documents) {
    const docNum = doc.document_number;
    if (!docNum) continue;

    // Check duplicate
    const exists = await db.regulatoryUpdate.findUnique({
      where: { documentNumber: docNum },
    });

    if (exists) continue;

    // Fetch full document detail to acquire full legal notice text if available
    let fullNoticeText = `${doc.title || ""}\n\n${doc.abstract || ""}`;
    const docDetailUrl = `https://www.federalregister.gov/api/v1/documents/${docNum}.json`;
    try {
      const detailRes = await fetch(docDetailUrl);
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        if (detailData.body_html || detailData.abstract) {
          fullNoticeText = `${detailData.title || doc.title}\n\n${detailData.abstract || ""}\n\n${detailData.body_html || detailData.description || ""}`;
        }
      }
    } catch (fetchErr) {
      console.warn(`[Regulatory Ingest] Could not fetch detailed text for doc ${docNum}:`, fetchErr);
    }

    // AI Structured Extraction over full document text
    let extracted: any = {
      type: "POLICY",
      affectedHtsCodes: [],
      effectiveDate: new Date().toISOString(),
      summary: doc.abstract || doc.title,
      actionRequired: false,
      fullNoticeText: fullNoticeText.slice(0, 10000),
    };

    if (process.env.GEMINI_API_KEY) {
      try {
        const prompt = `Analyze the following Federal Register notice and perform structured extraction of policy updates:
Title: "${doc.title}"
Abstract: "${doc.abstract || ""}"
Publication Date: "${doc.publication_date}"
Full Content Snippet: "${fullNoticeText.slice(0, 4000)}"

Extract matching type, affected HTS codes, effective date, short summary, and if action is required.`;

        const aiResponse = await aiClient.models.generateContent({
          model: aiModel("hts-classification") || "gemini-3.6-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: extractionSchema,
            temperature: 0.1,
          },
        });

        await meterGeminiCall(
          "hts-classification",
          { accountId: "system", userId: "cron" },
          aiResponse
        );

        extracted = { ...JSON.parse(aiResponse.text || "{}"), fullNoticeText: fullNoticeText.slice(0, 10000) };
      } catch (err) {
        console.error("AI extraction failed, using heuristic fallback:", err);
      }
    } else {
      // Heuristic extraction for local/test runs
      const fullTextLower = fullNoticeText.toLowerCase();
      const matchedHts = Array.from(
        new Set(fullNoticeText.match(/\b\d{4}\.\d{2}\.\d{2,4}\b|\b\d{10}\b/g) || [])
      );
      extracted.affectedHtsCodes = matchedHts;

      if (fullTextLower.includes("exclusion")) {
        extracted.type = "EXCLUSION_GRANTED";
        extracted.actionRequired = true;
      } else if (fullTextLower.includes("rate") || fullTextLower.includes("tariff")) {
        extracted.type = "TARIFF_RATE_CHANGE";
        extracted.actionRequired = true;
      }
    }

    // Create Regulatory Update with full legal notice text stored
    const update = await db.regulatoryUpdate.create({
      data: {
        title: doc.title,
        description: doc.abstract || doc.title,
        jurisdiction: "United States",
        category: "Trade Policy",
        impactLevel: extracted.actionRequired ? "High" : "Medium",
        effectiveDate: new Date(extracted.effectiveDate || doc.publication_date),
        documentNumber: docNum,
        publishedText: doc.pdf_url || docDetailUrl,
        status: extracted.actionRequired ? "Action Required" : "Informational",
        metadata: extracted,
      },
    });

    createdUpdates.push(update);

    // Federal Register extraction is title/abstract-level only (no legal-text or
    // product-scope parsing), so it is informational-only: it must never auto-create
    // a RefundOpportunity. A notice matching "exclusion" affects an unknown, possibly
    // empty, set of HTS codes and products -- a human must confirm the match against
    // each filing before any refund claim is created.

    // Alert members with regulatory.review permissions that action may be required.
    if (extracted.actionRequired) {
      try {
        const { searchParams } = new URL(req.url);
        const accountId = searchParams.get("accountId");

        const whereClause: Prisma.AccountMembershipWhereInput = {
          status: "ACTIVE",
          deletedAt: null,
          roles: {
            some: {
              role: {
                OR: [
                  { name: { in: ["OWNER", "ADMIN"] } },
                  {
                    rolePermissions: {
                      some: {
                        permission: {
                          name: "regulatory.review",
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        };

        if (accountId) {
          whereClause.accountId = accountId;
        }

        const memberships = await db.accountMembership.findMany({
          where: whereClause,
        });

        for (const m of memberships) {
          await db.notification.create({
            data: {
              accountId: m.accountId,
              userId: m.userId,
              message: `Regulatory Action Required: ${update.title}. New CBP regulatory notice published affecting HTS codes: ${extracted.affectedHtsCodes.join(", ")}. Review required.`,
              type: "regulatory_alert",
            },
          }).catch((err) => {
            console.error(`[Regulatory Ingest Cron] Failed to create notification for account ${m.accountId}, user ${m.userId}:`, err);
          });
        }
      } catch (notifErr) {
        console.error("[Regulatory Ingest Cron] Notification processing error:", notifErr);
      }
    }
  }

  return NextResponse.json({
    status: "COMPLETE",
    requestId,
    ingestedCount: createdUpdates.length,
    updates: createdUpdates.map((u) => ({ id: u.id, title: u.title, status: u.status })),
  });
});
