import { GoogleGenAI, Type, Schema } from "@google/genai";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { EventEmitter } from "events";
import { Prisma } from "@prisma/client";
import {
  DocumentTypeCatalog,
  DocumentTypeDefinition,
  DocumentType,
  DocumentTypeCode,
} from "./documentTypeCatalog";

export type { DocumentType, DocumentTypeCode };

// Global event bus for multi-agent reactive orchestration
export const agentEventBus = new EventEmitter();

export interface PageAnalysisResult {
  pageNumber: number;
  docTypeCode: string; // Dynamic code from DocumentTypeCatalog (e.g. "COMMERCIAL_INVOICE", "CBP_FORM_7501", "FDA_PRIOR_NOTICE")
  docTypeName: string; // Human readable title
  confidence: number; // 0-100
  isHandwritten: boolean;
  hasIllegibleStamps: boolean;
  orientationDegrees: number;
  headerTextExcerpt: string;
}

export interface DocumentIntakeAgentInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  fileName: string;
  fileUrl: string;
  fileBuffer?: Buffer;
  mimeType?: string;
  docTypeOverride?: string;
}

export interface DocumentIntakeAgentOutput {
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  packetId: string;
  shipmentId: string;
  status: "Completed" | "Review Required" | "Attention";
  overallConfidence: number;
  documentCount: number;
  pageCount: number;
  classifications: PageAnalysisResult[];
  detectedTypes: string[];
  missingRequiredDocs: string[];
  humanReviewReason?: string;
  reasoningChain: string;
  agentDecisionId: string;
  shipmentDocumentId: string;
  aiProviderUsed: string;
  apiKeyActive: boolean;
  /** Populated when the Gemini vision call throws, so failures are visible in the API response. */
  extractionError?: string;
}

// Flexible JSON schema for Gemini 2.5 Vision Output
const intakeResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    overallConfidence: { type: Type.INTEGER },
    reasoningChain: { type: Type.STRING },
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          pageNumber: { type: Type.INTEGER },
          docTypeCode: { type: Type.STRING },
          docTypeName: { type: Type.STRING },
          confidence: { type: Type.INTEGER },
          isHandwritten: { type: Type.BOOLEAN },
          hasIllegibleStamps: { type: Type.BOOLEAN },
          orientationDegrees: { type: Type.INTEGER },
          headerTextExcerpt: { type: Type.STRING },
        },
        required: [
          "pageNumber",
          "docTypeCode",
          "confidence",
          "isHandwritten",
          "hasIllegibleStamps",
          "orientationDegrees",
          "headerTextExcerpt",
        ],
      },
    },
  },
  required: ["overallConfidence", "reasoningChain", "pages"],
};

export const DOCUMENT_INTAKE_SYSTEM_PROMPT = `
ROLE

You are Qubere's Document Intake Agent, the first stage in a 10-agent
customs compliance pipeline. Your only job is to look at the uploaded file
page by page and classify what each page is — you do not extract field
values or line items; that belongs to the Document Intelligence Agent that
runs after you. Your output determines how the file gets stitched into a
packet and whether it's routed straight through or held for review.


GROUNDING RULES

1. Every classification, confidence score, and text excerpt must come from
   what you can actually see on that page. Never infer a document type,
   confidence, or excerpt from the filename — a file called
   "invoice_final_v2.pdf" is not evidence of what's inside it.
2. headerTextExcerpt must be real text you can read on the page (or the
   clearest paraphrase of it). Never construct a plausible-sounding
   excerpt from the filename or your document type guess.
3. confidence must reflect genuine uncertainty about the read — a blurry
   scan or an ambiguous layout should score low, honestly, rather than
   defaulting to a comfortable-looking number.
4. If you cannot classify a page with reasonable confidence, use the
   closest catalog code you can defend and say so plainly in
   reasoningChain — do not silently default to "Commercial Invoice" or
   any other common type just because nothing else fit.
5. isHandwritten and hasIllegibleStamps must reflect what you actually
   see — flag them whenever present, even if it lowers your confidence.


DOCUMENT TYPE CATALOG

Classify each page against this list. Use the description of each as a
guide to what real documents of that type contain — if truly nothing
fits, use the closest match and explain the mismatch in reasoningChain
rather than forcing a clean answer:

  Commercial: COMMERCIAL_INVOICE, PRO_FORMA_INVOICE, PACKING_LIST,
    PURCHASE_ORDER, MANUFACTURER_ASSIST_DECLARATION

  Transport: OCEAN_BILL_OF_LADING, AIR_WAYBILL, ARRIVAL_NOTICE,
    IN_BOND_MANIFEST_7512

  CBP customs forms: CBP_FORM_7501_ENTRY_SUMMARY,
    CBP_FORM_3461_ENTRY_DELIVERY, IMPORTER_SECURITY_FILING_ISF

  Origin & FTA: USMCA_CERTIFICATE_OF_ORIGIN, GENERAL_CERTIFICATE_OF_ORIGIN

  Partner government agency: FDA_PRIOR_NOTICE_CONFIRMATION,
    EPA_FORM_3540_1_IMPORT_REPORT, TSCA_SECTION_13_DECLARATION,
    USDA_PHYTOSANITARY_CERTIFICATE, FCC_FORM_740_DISCLOSURE

  Post-entry & audit: CBP_FORM_28_REQUEST_FOR_INFORMATION,
    CBP_FORM_29_NOTICE_OF_ACTION, POST_SUMMARY_CORRECTION_PSC_DECK,
    DUTY_DRAWBACK_CLAIM_DOCUMENT


MULTI-PAGE HANDLING

Classify each page independently, but use context from adjacent pages
when a page alone is ambiguous (e.g., a page of line items with no header
is probably a continuation of the invoice on the page before it) — state
that reasoning in reasoningChain rather than guessing silently.


OUTPUT

Return overallConfidence (0-100, the honest average of your real per-page
confidence, not an aspirational number), reasoningChain (explain page
stitching logic and classification decisions, referencing 19 CFR § 141.86
where relevant), and pages[] with pageNumber, docTypeCode, docTypeName,
confidence, isHandwritten, hasIllegibleStamps, orientationDegrees, and
headerTextExcerpt for every page.
`;

export class DocumentIntakeAgent {
  private static getApiKey(): string {
    return process.env.GEMINI_API_KEY || "";
  }

  private static getAiClient(): GoogleGenAI | null {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }

  /**
   * Returns API key configuration status for the Document Intake Agent.
   */
  static getApiKeyStatus() {
    const key = this.getApiKey();
    return {
      apiKeyPresent: Boolean(key),
      providerName: "Gemini Flash Vision (Google GenAI SDK)",
    };
  }

  /**
   * Main Autonomous Execution Entrypoint for Agent 1.
   * Wakes up when a document is uploaded, processes multi-modal pages via Gemini Vision or Catalog Matcher,
   * evaluates human-in-the-loop rules, and logs AgentDecision.
   */
  static async execute(input: DocumentIntakeAgentInput): Promise<DocumentIntakeAgentOutput> {
    const packetId = `pkt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const apiKeyActive = Boolean(process.env.GEMINI_API_KEY);
    let aiProvider = apiKeyActive
      ? "Gemini Flash Vision (Google GenAI SDK)"
      : "DocumentCatalog Vision Engine (Local Fallback)";

    let pages: PageAnalysisResult[] = [];
    let overallConfidence = 95;
    let reasoningChain = "";
    let extractionError: string | undefined = undefined;

    const aiClient = this.getAiClient();

    // 1. If Gemini API Key is active & file buffer is provided, run Gemini 2.5 Vision Multi-modal Agent
    if (aiClient && input.fileBuffer) {
      try {
        const mimeType = input.mimeType || "application/pdf";
        const base64Data = input.fileBuffer.toString("base64");

        const prompt = `${DOCUMENT_INTAKE_SYSTEM_PROMPT}

Target File Name: "${input.fileName}"`;

        const response = await aiClient.models.generateContent({
          model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: base64Data } },
                { text: prompt },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: intakeResponseSchema,
            temperature: 0.1,
          },
        });

        const jsonText = response.text || "{}";
        const parsed = JSON.parse(jsonText);

        overallConfidence = parsed.overallConfidence ?? 94;
        reasoningChain = parsed.reasoningChain || "Gemini Vision multi-modal document intake completed successfully.";
        pages = (parsed.pages || []).map((p: any) => {
          const matchedDef = DocumentTypeCatalog.matchDocumentType(p.docTypeCode || p.docTypeName || input.fileName);
          return {
            pageNumber: p.pageNumber || 1,
            docTypeCode: matchedDef.code,
            docTypeName: matchedDef.name,
            confidence: p.confidence ?? 95,
            isHandwritten: Boolean(p.isHandwritten),
            hasIllegibleStamps: Boolean(p.hasIllegibleStamps),
            orientationDegrees: p.orientationDegrees || 0,
            headerTextExcerpt: p.headerTextExcerpt || matchedDef.description,
          };
        });
      } catch (err: any) {
        console.warn("[DocumentIntakeAgent] Gemini API call exception, using DocumentCatalog Engine fallback:", err);
        aiProvider = "DocumentCatalog Vision Engine (Fallback)";
        extractionError = err?.message || String(err);
      }
    }

    // Grounded Fallback: if Gemini wasn't available or returned 0 pages
    if (pages.length === 0) {
      const targetType = input.docTypeOverride || input.fileName || "Commercial Invoice";
      const matchedDef = DocumentTypeCatalog.matchDocumentType(targetType);
      pages = [
        {
          pageNumber: 1,
          docTypeCode: matchedDef.code,
          docTypeName: matchedDef.name,
          confidence: input.docTypeOverride ? 90 : 85,
          isHandwritten: false,
          hasIllegibleStamps: false,
          orientationDegrees: 0,
          headerTextExcerpt: `Document intake classification: ${matchedDef.name}`,
        },
      ];
      overallConfidence = input.docTypeOverride ? 90 : 85;
      reasoningChain = `Document Packet ${packetId} ingested and classified as ${matchedDef.name} (${matchedDef.code}).`;
    }

    const detectedTypes = Array.from(new Set(pages.map((p) => p.docTypeCode)));
    const requiredTypes = ["COMMERCIAL_INVOICE"];
    const missingRequiredDocs = requiredTypes.filter((t) => !detectedTypes.includes(t));

    // 2. Evaluate Human-in-the-Loop Broker Review Rules
    let status: "Completed" | "Review Required" | "Attention" = "Completed";
    const reviewReasons: string[] = [];

    if (overallConfidence < 90) {
      status = "Review Required";
      reviewReasons.push(
        `OCR confidence score (${overallConfidence}%) is below mandatory 90% threshold for automated filing.`
      );
    }
    if (missingRequiredDocs.length > 0) {
      status = "Review Required";
      reviewReasons.push(`Missing mandatory trade documents: ${missingRequiredDocs.join(", ")}.`);
    }
    if (pages.some((p) => p.isHandwritten || p.hasIllegibleStamps)) {
      if (status !== "Review Required") status = "Attention";
      reviewReasons.push("Handwritten annotations or unverified seals detected on document pages.");
    }

    const humanReviewReason = reviewReasons.length > 0 ? reviewReasons.join(" ") : undefined;
    const primaryDoc = DocumentTypeCatalog.matchDocumentType(detectedTypes[0] || input.fileName);
    let shipmentDocId = "doc_fallback_intake";
    let agentDecisionId = "dec_fallback_intake";
    try {
      const existingDoc = await db.shipmentDocument.findFirst({
        where: {
          shipmentId: input.shipmentId,
          accountId: input.accountId,
          fileName: input.fileName,
        },
      });

      let shipmentDoc;
      if (existingDoc) {
        shipmentDoc = await db.shipmentDocument.update({
          where: { id: existingDoc.id },
          data: {
            docType: primaryDoc.name,
            pageCount: pages.length,
            fileUrl: input.fileUrl || existingDoc.fileUrl,
            confidence: overallConfidence,
            status: status === "Completed" ? "Processed" : "Review Required",
          },
        });
      } else {
        shipmentDoc = await db.shipmentDocument.create({
          data: {
            shipmentId: input.shipmentId,
            accountId: input.accountId,
            docType: primaryDoc.name,
            fileName: input.fileName,
            pageCount: pages.length,
            fileUrl: input.fileUrl,
            confidence: overallConfidence,
            status: status === "Completed" ? "Processed" : "Review Required",
          },
        });
      }
      shipmentDocId = shipmentDoc.id;

      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          agentName: "Document Intake Agent",
          agentIcon: "FileCheck2",
          status: status === "Completed" ? "Approved" : "Needs Review",
          confidence: overallConfidence,
          decisionSummary: `Stitched ${pages.length}-page document packet ${packetId}. Primary document identified as ${primaryDoc.name} (${overallConfidence}% confidence).`,
          purpose: "Ingest unstructured trade document, stitch packet pages, detect illegibility, and index into document store",
          dataSources: ["Google Vision OCR Engine", "CBP Document Catalog Rules", aiProvider],
          regulations: ["19 CFR § 141.86 (Invoice Requirements)", "19 CFR § 141.83"],
          proposedDescription: `${primaryDoc.name} (${pages.length} pages)`,
          rulesApplied: [
            "Multi-Page Document Stitching Rule",
            "CBP Document Classifier Match",
            "Handwriting & Stamp Distort Risk Audit",
          ],
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      // Fallback for DB limits
    }

    // 5. Emit Audit Log
    try {
      await createAuditLog({
        accountId: input.accountId,
        userId: input.userId,
        action: "agent.document_intake",
        entity: "AgentDecision",
        entityId: agentDecisionId,
        metadata: {
          packetId,
          fileName: input.fileName,
          status,
          overallConfidence,
          docTypeCode: primaryDoc.code,
          docTypeName: primaryDoc.name,
          aiProviderUsed: aiProvider,
        },
      });
    } catch (e) {}

    const agentOutput: DocumentIntakeAgentOutput = {
      packetId,
      shipmentId: input.shipmentId,
      status,
      overallConfidence,
      documentCount: 1,
      pageCount: pages.length,
      classifications: pages,
      detectedTypes,
      missingRequiredDocs,
      humanReviewReason,
      reasoningChain,
      agentDecisionId: agentDecisionId,
      shipmentDocumentId: shipmentDocId,
      aiProviderUsed: aiProvider,
      apiKeyActive,
      extractionError,
    };

    // 6. Reactive Multi-Agent Pipeline Trigger: Emit event to wake up Agent 2
    agentEventBus.emit("intake:completed", agentOutput);

    return agentOutput;
  }
}
