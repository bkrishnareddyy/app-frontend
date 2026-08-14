import { PrismaClient } from "@prisma/client";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import fetch from "node-fetch";

const db = new PrismaClient();

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

async function run() {
  console.log("Fetching CBP notices from Federal Register API...");
  const url = "https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=customs-border-protection&per_page=20&order=newest";
  
  const response = await fetch(url);
  const data: any = await response.json();
  const documents = data.results || [];
  
  console.log(`Retrieved ${documents.length} notices.`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required to run this script.");
  }
  const aiClient = new GoogleGenAI({ apiKey });

  let count = 0;

  for (const doc of documents) {
    const docNum = doc.document_number;
    if (!docNum) continue;

    const exists = await db.regulatoryUpdate.findUnique({
      where: { documentNumber: docNum },
    });

    if (exists) {
      console.log(`Document ${docNum} already exists, skipping.`);
      continue;
    }

    console.log(`Extracting metadata for Document ${docNum}...`);

    let fullNoticeText = `${doc.title || ""}\n\n${doc.abstract || ""}`;
    const docDetailUrl = `https://www.federalregister.gov/api/v1/documents/${docNum}.json`;
    try {
      const detailRes = await fetch(docDetailUrl);
      if (detailRes.ok) {
        const detailData = (await detailRes.json()) as any;
        if (detailData.body_html || detailData.abstract) {
          fullNoticeText = `${detailData.title || doc.title}\n\n${detailData.abstract || ""}\n\n${detailData.body_html || detailData.description || ""}`;
        }
      }
    } catch (fetchErr) {
      console.warn(`Could not fetch detailed text for doc ${docNum}:`, fetchErr);
    }

    let extracted: any = {
      type: "POLICY",
      affectedHtsCodes: [],
      effectiveDate: new Date().toISOString(),
      summary: doc.abstract || doc.title,
      actionRequired: false,
      fullNoticeText: fullNoticeText.slice(0, 10000),
    };

    try {
      const prompt = `Analyze the following Federal Register notice and perform structured extraction of policy updates:
Title: "${doc.title}"
Abstract: "${doc.abstract || ""}"
Publication Date: "${doc.publication_date}"
Full Content Snippet: "${fullNoticeText.slice(0, 4000)}"

Extract matching type, affected HTS codes, effective date, short summary, and if action is required.`;

      const aiResponse = await aiClient.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: extractionSchema,
          temperature: 0.1,
        },
      });

      extracted = { ...JSON.parse(aiResponse.text || "{}"), fullNoticeText: fullNoticeText.slice(0, 10000) };
    } catch (err) {
      console.warn("AI extraction failed, using default values:", err);
    }

    await db.regulatoryUpdate.create({
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

    console.log(`Successfully ingested update: ${doc.title}`);
    count++;
  }

  console.log(`Successfully finished database refresh. Ingested ${count} updates.`);
  await db.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
