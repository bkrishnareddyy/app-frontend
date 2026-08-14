import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
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

export const POST = withPublicRoute(async ({ req, requestId }) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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

    // AI Structured Extraction
    let extracted: any = {
      type: "POLICY",
      affectedHtsCodes: [],
      effectiveDate: new Date().toISOString(),
      summary: doc.abstract || doc.title,
      actionRequired: false,
    };

    if (process.env.GEMINI_API_KEY) {
      try {
        const prompt = `Analyze the following Federal Register notice and perform structured extraction of policy updates:
Title: "${doc.title}"
Abstract: "${doc.abstract || ""}"
Publication Date: "${doc.publication_date}"

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

        extracted = JSON.parse(aiResponse.text || "{}");
      } catch (err) {
        console.error("AI extraction failed, using heuristic fallback:", err);
      }
    } else {
      // Heuristic extraction for local/test runs
      const fullText = `${doc.title || ""} ${doc.abstract || ""}`;
      const textLower = fullText.toLowerCase();
      const matchedHts = Array.from(
        new Set(fullText.match(/\b\d{4}\.\d{2}\.\d{2,4}\b|\b\d{10}\b/g) || [])
      );
      extracted.affectedHtsCodes = matchedHts;

      if (textLower.includes("exclusion")) {
        extracted.type = "EXCLUSION_GRANTED";
        extracted.actionRequired = true;
      } else if (textLower.includes("rate") || textLower.includes("tariff")) {
        extracted.type = "TARIFF_RATE_CHANGE";
        extracted.actionRequired = true;
      }
    }

    // Create Regulatory Update
    const update = await db.regulatoryUpdate.create({
      data: {
        title: doc.title,
        description: doc.abstract || doc.title,
        jurisdiction: "United States",
        category: "Trade Policy",
        impactLevel: extracted.actionRequired ? "High" : "Medium",
        effectiveDate: new Date(extracted.effectiveDate || doc.publication_date),
        documentNumber: docNum,
        publishedText: doc.pdf_url,
        status: extracted.actionRequired ? "Action Required" : "Informational",
        metadata: extracted,
      },
    });

    createdUpdates.push(update);

    // Task C-3: Auto-create RefundOpportunity when exclusion is granted via Federal Register cron
    if (extracted.type === "EXCLUSION_GRANTED" || doc.title.toLowerCase().includes("exclusion")) {
      const acceptedFilings = await db.customsFiling.findMany({
        where: { filingStatus: { in: ["Accepted", "Closed"] } },
        include: { shipment: { include: { lineItems: true } } },
      });

      for (const filing of acceptedFilings) {
        for (const item of filing.shipment.lineItems) {
          const isChina = item.countryOfOrigin?.toUpperCase() === "CN";
          if (!isChina || !item.htsCode) continue;

          const oppExists = await db.refundOpportunity.findFirst({
            where: { accountId: filing.accountId, filingId: filing.id, opportunityType: "SECTION_301_EXCLUSION" },
          });

          if (!oppExists) {
            await db.refundOpportunity.create({
              data: {
                accountId: filing.accountId,
                filingId: filing.id,
                opportunityType: "SECTION_301_EXCLUSION",
                estimatedRefundAmount: null, // Null until confirmed per spec
                confidence: 95,
                basis: {
                  reason: `Federal Register notice ${docNum} granted Section 301 retroactive exclusion.`,
                  regulatoryUpdateId: update.id,
                  lineItemId: item.id,
                  htsCode: item.htsCode,
                },
                status: "Identified",
              },
            });
          }
        }
      }
    }

    // Create notifications for members with regulatory.review permissions
    if (extracted.actionRequired) {
      const { searchParams } = new URL(req.url);
      const accountId = searchParams.get("accountId");

      // Fetch account users via memberships
      const memberships = await db.accountMembership.findMany({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          ...(accountId ? { accountId } : {}),
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
        },
      });

      for (const m of memberships) {
        await db.notification.create({
          data: {
            accountId: m.accountId,
            userId: m.userId,
            message: `Regulatory Action Required: ${update.title}. New CBP regulatory notice published affecting HTS codes: ${extracted.affectedHtsCodes.join(", ")}. Review required.`,
            type: "regulatory_alert",
          },
        });
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
