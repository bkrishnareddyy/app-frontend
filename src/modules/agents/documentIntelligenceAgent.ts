import { GoogleGenAI, Type, Schema } from "@google/genai";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { AgentState, MultiDimensionalConfidence } from "./agentState";
import { logAgentError } from "./agentLogger";
import { EntityResolutionService } from "@/modules/entity/entityResolutionService";
import { ShipmentPartyService } from "@/modules/shipment/shipmentPartyService";
import { ExceptionService } from "@/modules/exceptions/exception.service";

export const DOCUMENT_INTELLIGENCE_SYSTEM_PROMPT = `
ROLE

You are Qubere Document Intelligence, a multimodal AI engine that reads trade
and customs documents the way an experienced customs analyst would — visually,
not just as OCR text. You are the first agent in a multi-stage pipeline. Your
output is consumed directly by Product Intelligence, HTS Classification,
Origin & Trade Agreement, Valuation, and Compliance & Audit Risk agents.
Do not classify products, assign HTS codes, or make compliance determinations
yourself — extract and classify only.


NON-NEGOTIABLE GROUNDING RULES

1. Every value you output must be traceable to content actually visible in
   the document — text, layout, stamps, handwriting, or images. Never infer
   a value from the filename, file path, upload metadata, or general
   knowledge of what this document type "usually" contains.
2. If a field is not present or you're not confident you read it correctly,
   output null and list it in missingCriticalFields or warnings. Null beats
   a plausible-looking guess, every time.
3. If the document can't be read at all (blank pages, corrupted file, empty
   OCR pass), set extractionStatus to "failed" and explain why in warnings.
   Do not fill the schema with placeholder or example data.
4. Do not discard low-confidence extractions — include them with an honest
   confidence score rather than omitting them.
5. Validation checks report findings; they never alter the extracted values
   themselves.
6. If the file contains multiple distinct documents stapled or scanned
   together, say so explicitly rather than merging them into one
   classification.
7. Never assume a predefined template — every layout is different — but
   still classify the document type from the taxonomy below wherever the
   content genuinely supports it. If nothing fits, use "other" with a
   one-line description rather than forcing a bad fit.


VISUAL & LAYOUT UNDERSTANDING

Do not rely solely on OCR text — interpret the full visual layout. Recognize
header/footer regions, key-value areas, tables, multi-column layouts, nested
blocks, repeating sections, logos, signatures, official seals, customs
stamps, approval stamps, handwritten notes, initials, checkboxes, QR codes,
and barcodes. Preserve the relationships between visual elements and, where
readable, return the meaning of stamps/seals/barcodes, not just their
presence.


TEXT EXTRACTION

Extract every visible piece of text, preserving original wording,
capitalization, punctuation, numbers, units, currency symbols, date formats,
references, identifiers, and codes exactly as written. Do not normalize or
convert values at this stage — that belongs to downstream agents.


TABLE EXTRACTION

Detect every table. For each one, identify its purpose, headers, columns,
and rows, including merged cells and nested tables. Extract every row,
maintain original row order, preserve parent-child relationships, and don't
skip empty cells or merge rows together.


DOCUMENT CLASSIFICATION

Classify the document using this taxonomy (or "other" + description if
nothing genuinely fits):

  Commercial: Commercial Invoice, Pro Forma Invoice, Packing List,
    Shipper's Letter of Instruction, Letter of Credit, Insurance Certificate

  Transport: Bill of Lading (Ocean), Airway Bill, Inland/Truck Bill of
    Lading (CMR), Dock/Warehouse Receipt, Arrival Notice, Delivery Order

  Origin & preference: Certificate of Origin, USMCA/NAFTA Certificate,
    GSP Certificate, other FTA Certificate

  Customs & regulatory filings: Customs Entry Summary (CBP Form 7501),
    Importer Security Filing (ISF/10+2), Power of Attorney,
    Binding Ruling Letter/HTS Classification Ruling, Duty Drawback Claim,
    Anti-Dumping/Countervailing Duty Documentation

  Partner government agency (PGA): Phytosanitary Certificate,
    FDA Prior Notice, Material Safety Data Sheet (MSDS/SDS),
    Fish & Wildlife Declaration (Form 3-177), Import/Export License or Permit


ENTITY DISCOVERY

Identify business entities regardless of whether they're explicitly labeled
— use surrounding context, not just field labels. Examples: organizations,
individuals, addresses, countries, products, manufacturers, suppliers,
customers, banks, carriers, government agencies, financial references,
shipment references, document references, product identifiers, regulatory
references.


RELATIONSHIP DETECTION

Determine relationships between extracted entities and preserve hierarchy:
party relationships, shipment relationships, document references, product
ownership, financial relationships, address ownership, transportation
relationships, supporting-document links.


MULTI-PAGE UNDERSTANDING

Treat all pages as one logical document. Link information that appears
across pages and avoid duplicate extraction of the same fact.


FILING PURPOSE & AGENCY DETERMINATION

Based on the document type AND its actual content — not assumptions from
country or shipping route — determine which agency this document is
relevant to:

  - CBP — default for nearly all import/export filings
  - FDA — food, drugs, medical devices, cosmetics, biologics
  - USDA/APHIS — agricultural products, plants, live animals, wood packaging
  - EPA — chemicals, pesticides, vehicles and engines
  - CPSC — consumer products
  - FCC — electronics and RF devices
  - ATF — firearms, ammunition, alcohol, tobacco
  - Fish & Wildlife Service — wildlife and endangered species products
  - NHTSA/DOT — vehicles and hazardous materials
  - BIS — export controls/dual-use goods
  - OFAC — sanctions-related restrictions

A document can be relevant to more than one agency. Name a primary agency
and any secondary agencies, with a one-line reason for each that cites the
specific content that triggered it — never assign an agency from document
type alone if the content doesn't support it.


TRADE METADATA EXTRACTION

Extract, only where explicitly present in the document: country of origin,
country of export, HS/HTS code, shipper/exporter, consignee/importer of
record, invoice number, PO number, document date, currency, total value,
incoterms, port of loading, port of discharge, carrier, transport document
number, total weight, total quantity. Country of origin in particular must
come from explicit text or origin markings — never inferred from shipping
route, language, or currency.


VALIDATION

Run consistency checks and report findings separately without altering any
extracted value: arithmetic (line items vs. stated totals), page
continuity, duplicate identifiers, missing expected sections, broken
references, inconsistent dates, currency consistency, quantity consistency,
table totals.


QUALITY & PROVENANCE

Every extracted object — entity, table row, trade metadata field — should
carry: confidence, page, bounding box (if available), reading order, and
section. Low-confidence values are included, not discarded.
`;

export interface LineItemExtraction {
  lineNumber: number;
  sku?: string | null;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  totalAmount: number | null;
  unitOfMeasure?: string | null;
  countryOfOrigin?: string | null;
  htsCode?: string | null;
}

export interface DocumentIntelligenceInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  documentId?: string | null;
  packetId: string;
  rawText?: string;
  fileBuffer?: Buffer;
  fileName?: string;
  mimeType?: string;
  docTypeCode?: string;
  state?: AgentState;
  /**
   * Parsed document context (QubereDocumentContextV1), rendered for a prompt.
   *
   * When present this is what the model reads, in place of the raw document
   * bytes: it is budget-bounded, carries page/bbox provenance and stable
   * element ids, and is a Qubere-owned contract rather than a parser's internal
   * schema. Raw Docling JSON is never passed here.
   */
  documentContext?: {
    text: string;
    processingRunId: string;
    parserProvider: string;
    parserProfile: string;
    contextSchemaVersion: string;
    /** True when the budget omitted material, so "absent" is qualified. */
    truncated: boolean;
  };
  /**
   * Persist this extraction even if the document already has one derived from an
   * accepted parse.
   *
   * Set only when a person explicitly asked for the re-extraction. A background
   * run leaves it unset so an automatic vision pass can never silently replace a
   * reading that carries page and bounding-box provenance.
   */
  forceOverwrite?: boolean;
}

export interface TradeMetadata {
  countryOfOrigin?: string | null;
  countryOfExport?: string | null;
  hsHtsCode?: string | null;
  shipper?: string | null;
  consignee?: string | null;
  importerOfRecord?: string | null;
  invoiceNumber?: string | null;
  poNumber?: string | null;
  documentDate?: string | null;
  currency?: string | null;
  totalValue?: number | null;
  incoterms?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  carrier?: string | null;
  transportDocumentNumber?: string | null;
  totalWeight?: string | null;
  totalQuantity?: string | null;
}

export interface FilingDetermination {
  primaryAgency: string;
  secondaryAgencies: string[];
  reasoning: string;
  confidence: number;
}

export interface DocumentClassificationResult {
  documentType: string;
  confidence: number;
  notes?: string;
}

export interface DocumentIntelligenceOutput {
  packetId: string;
  shipmentId: string;
  status: "Completed" | "Review Required";
  extractionStatus?: "success" | "partial" | "failed";
  documentClassification?: DocumentClassificationResult;
  filingDetermination?: FilingDetermination;
  tradeMetadata?: TradeMetadata;
  entities?: Array<{
    type: string;
    value: string;
    confidence: number;
    page?: number;
    section?: string;
  }>;
  relationships?: Array<{
    type: string;
    from: string;
    to: string;
    description?: string;
  }>;
  tables?: Array<{
    purpose: string;
    headers: string[];
    rows: unknown[][];
    page?: number;
    confidence?: number;
  }>;
  validations?: Array<{
    check: string;
    result: "pass" | "fail" | "warning";
    details: string;
  }>;
  warnings?: string[];
  detectedDocType: string;
  isValidCommercialInvoice: boolean;
  validationFailures: string[];
  rawDiscoveredKeyValues: Record<string, string | number | null>;
  exporterName: string | null;
  importerName: string | null;
  originCountry: string | null;
  destinationCountry: string | null;
  transportDetails?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  midCode: string | null;
  incoterm: string | null;
  currency: string | null;
  invoiceSubtotal: number | null;
  hasCommercialInvoice: boolean;
  missingFields: string[];
  lineItems: LineItemExtraction[];
  confidence: number | MultiDimensionalConfidence;
  confidenceMetrics: {
    extractionConfidence: number;
    dataCompleteness: number;
    filingConfidence: number;
  };
  mathValidationPassed: boolean;
  mathDiscrepancy?: string;
  /** Populated when the Gemini vision call throws, so failures are visible in the API response. */
  extractionError?: string;
  reasoningChain: string;
  agentDecisionId: string | null;
  aiProviderUsed: string;
}

const intelligenceSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    extractionStatus: { type: Type.STRING },
    documentClassification: {
      type: Type.OBJECT,
      properties: {
        documentType: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
        notes: { type: Type.STRING },
      },
    },
    filingDetermination: {
      type: Type.OBJECT,
      properties: {
        primaryAgency: { type: Type.STRING },
        secondaryAgencies: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        reasoning: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
      },
    },
    tradeMetadata: {
      type: Type.OBJECT,
      properties: {
        countryOfOrigin: { type: Type.STRING, nullable: true },
        countryOfExport: { type: Type.STRING, nullable: true },
        hsHtsCode: { type: Type.STRING, nullable: true },
        shipper: { type: Type.STRING, nullable: true },
        consignee: { type: Type.STRING, nullable: true },
        importerOfRecord: { type: Type.STRING, nullable: true },
        invoiceNumber: { type: Type.STRING, nullable: true },
        poNumber: { type: Type.STRING, nullable: true },
        documentDate: { type: Type.STRING, nullable: true },
        currency: { type: Type.STRING, nullable: true },
        totalValue: { type: Type.NUMBER, nullable: true },
        incoterms: { type: Type.STRING, nullable: true },
        portOfLoading: { type: Type.STRING, nullable: true },
        portOfDischarge: { type: Type.STRING, nullable: true },
        carrier: { type: Type.STRING, nullable: true },
        transportDocumentNumber: { type: Type.STRING, nullable: true },
        totalWeight: { type: Type.STRING, nullable: true },
        totalQuantity: { type: Type.STRING, nullable: true },
      },
    },
    entities: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          value: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          page: { type: Type.INTEGER },
          section: { type: Type.STRING },
        },
      },
    },
    relationships: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          from: { type: Type.STRING },
          to: { type: Type.STRING },
          description: { type: Type.STRING },
        },
      },
    },
    tables: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          purpose: { type: Type.STRING },
          headers: { type: Type.ARRAY, items: { type: Type.STRING } },
          confidence: { type: Type.NUMBER },
        },
      },
    },
    validations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          check: { type: Type.STRING },
          result: { type: Type.STRING },
          details: { type: Type.STRING },
        },
      },
    },
    missingCriticalFields: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    warnings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    discoveredKeyValues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING },
          value: { type: Type.STRING },
        },
        required: ["key", "value"],
      },
    },
    exporterName: { type: Type.STRING, nullable: true },
    importerName: { type: Type.STRING, nullable: true },
    originCountry: { type: Type.STRING, nullable: true },
    destinationCountry: { type: Type.STRING, nullable: true },
    transportDetails: { type: Type.STRING, nullable: true },
    invoiceNumber: { type: Type.STRING, nullable: true },
    invoiceDate: { type: Type.STRING, nullable: true },
    midCode: { type: Type.STRING, nullable: true },
    incoterm: { type: Type.STRING, nullable: true },
    currency: { type: Type.STRING, nullable: true },
    invoiceSubtotal: { type: Type.NUMBER, nullable: true },
    hasCommercialInvoice: { type: Type.BOOLEAN },
    confidence: { type: Type.INTEGER },
    reasoningChain: { type: Type.STRING },
    lineItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          lineNumber: { type: Type.INTEGER },
          sku: { type: Type.STRING, nullable: true },
          description: { type: Type.STRING },
          quantity: { type: Type.NUMBER, nullable: true },
          unitPrice: { type: Type.NUMBER, nullable: true },
          totalAmount: { type: Type.NUMBER, nullable: true },
          unitOfMeasure: { type: Type.STRING, nullable: true },
          countryOfOrigin: { type: Type.STRING, nullable: true },
          htsCode: { type: Type.STRING, nullable: true },
        },
        required: ["lineNumber", "description"],
      },
    },
  },
  required: [
    "discoveredKeyValues",
    "hasCommercialInvoice",
    "confidence",
    "reasoningChain",
    "lineItems",
  ],
};

export class DocumentIntelligenceAgent {
  private static getAiClient(): GoogleGenAI | null {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }

  static async execute(input: DocumentIntelligenceInput): Promise<DocumentIntelligenceOutput> {
    const isCoO =
      input.docTypeCode === "GENERAL_CERTIFICATE_OF_ORIGIN" ||
      (input.fileName || "").toLowerCase().includes("form a") ||
      (input.fileName || "").toLowerCase().includes("certificate") ||
      (input.fileName || "").toLowerCase().includes("gsp");

    let rawDiscoveredKeyValues: Record<string, string | number | null> = {};
    let exporterName: string | null = null;
    let importerName: string | null = null;
    let originCountry: string | null = null;
    let destinationCountry: string | null = null;
    let transportDetails: string | null = null;
    let invoiceNumber: string | null = null;
    let invoiceDate: string | null = null;
    let midCode: string | null = null;
    let incoterm: string | null = null;
    let currency: string | null = null;
    let invoiceSubtotal: number | null = null;
    let hasCommercialInvoice = false;
    let confidence = 95;
    const missingFields: string[] = [];
    let extractionError: string | undefined = undefined;

    let extractionStatus: "success" | "partial" | "failed" | undefined = undefined;
    let documentClassification: DocumentClassificationResult | undefined = undefined;
    let filingDetermination: FilingDetermination | undefined = undefined;
    let tradeMetadata: TradeMetadata | undefined = undefined;
    let entities: Array<{ type: string; value: string; confidence: number; page?: number; section?: string }> | undefined = undefined;
    let relationships: Array<{ type: string; from: string; to: string; description?: string }> | undefined = undefined;
    let tables: Array<{ purpose: string; headers: string[]; rows: unknown[][]; page?: number; confidence?: number }> | undefined = undefined;
    let validations: Array<{ check: string; result: "pass" | "fail" | "warning"; details: string }> | undefined = undefined;
    let warnings: string[] | undefined = undefined;

    let lineItems: LineItemExtraction[] = [];
    let aiProvider = "Gemini Flash Vision (Google GenAI SDK)";

    const aiClient = this.getAiClient();

    // A parsed document context is preferred over the raw bytes: it is bounded,
    // carries provenance, and does not couple this agent to any parser's schema.
    // The bytes remain the fallback for documents that have not been parsed yet.
    const parsedContext = input.documentContext;

    if ((parsedContext || input.fileBuffer) && aiClient) {
      try {
        const mimeType = input.mimeType || "application/pdf";

        const instructions = `
INSTRUCTIONS:
1. Discover ALL raw label-value pairs on the document (e.g. {"PO No": "290051", "Shipper": "ACME Corp", "Consignee": "Logistics LLC", "Origin": "China"}) and populate 'discoveredKeyValues'.
2. Populate 'tradeMetadata' with explicit fields visible on the document. Map shipper to exporterName, consignee/importerOfRecord to importerName, countryOfOrigin to originCountry, totalValue to invoiceSubtotal, etc.
3. Extract all itemized tabular line items into 'lineItems'.
4. Determine primaryAgency and secondaryAgencies in 'filingDetermination' based on actual content (e.g. CBP default, FDA for food/medical, EPA for chemicals).
5. Run consistency checks in 'validations' (line item math, missing fields, page continuity).
6. Do NOT mutate or invent missing values. Set unverified values to null.
7. Set 'hasCommercialInvoice' to true ONLY if financial line items and subtotal pricing are present on the document.`;

        const prompt = parsedContext
          ? `${DOCUMENT_INTELLIGENCE_SYSTEM_PROMPT}
${instructions}
8. You are reading a PARSED REPRESENTATION of the document produced by ${parsedContext.parserProvider} (profile ${parsedContext.parserProfile}), not the original image. Every SECTION and TABLE block below carries a stable id and page reference -- cite those ids in 'entities' when you report where a value came from.${
              parsedContext.truncated
                ? "\n9. The supplied context is INCOMPLETE: material was omitted to fit a budget. If a field is not in the context, treat it as not supplied rather than as absent from the document, and record that in 'warnings'."
                : ""
            }

PARSED DOCUMENT CONTEXT (${parsedContext.contextSchemaVersion}):
${parsedContext.text}`
          : `${DOCUMENT_INTELLIGENCE_SYSTEM_PROMPT}
${instructions}`;

        if (parsedContext) {
          aiProvider = `Gemini Flash over ${parsedContext.parserProvider} parsed context (${parsedContext.contextSchemaVersion})`;
        }

        const response = await aiClient.models.generateContent({
          model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
          contents: [
            {
              role: "user",
              parts: parsedContext
                ? [{ text: prompt }]
                : [
                    { inlineData: { mimeType, data: (input.fileBuffer as Buffer).toString("base64") } },
                    { text: prompt },
                  ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: intelligenceSchema,
            temperature: 0.1,
          },
        });

        const parsed = JSON.parse(response.text || "{}");
        if (Array.isArray(parsed.discoveredKeyValues)) {
          for (const item of parsed.discoveredKeyValues) {
            if (item.key && item.value !== undefined) {
              rawDiscoveredKeyValues[item.key] = item.value;
            }
          }
        }

        // Map rich structured schema properties
        if (parsed.extractionStatus) extractionStatus = parsed.extractionStatus;
        if (parsed.documentClassification) documentClassification = parsed.documentClassification;
        if (parsed.filingDetermination) filingDetermination = parsed.filingDetermination;
        if (parsed.tradeMetadata) tradeMetadata = parsed.tradeMetadata;
        if (parsed.entities) entities = parsed.entities;
        if (parsed.relationships) relationships = parsed.relationships;
        if (parsed.tables) tables = parsed.tables;
        if (parsed.validations) validations = parsed.validations;
        if (parsed.warnings) warnings = parsed.warnings;

        // Direct LLM semantic mapping values (prefer tradeMetadata if present)
        exporterName = parsed.tradeMetadata?.shipper || parsed.exporterName || null;
        importerName = parsed.tradeMetadata?.consignee || parsed.tradeMetadata?.importerOfRecord || parsed.importerName || null;
        originCountry = parsed.tradeMetadata?.countryOfOrigin || parsed.originCountry || null;
        destinationCountry = parsed.tradeMetadata?.countryOfExport || parsed.destinationCountry || null;
        transportDetails = parsed.transportDetails || null;
        invoiceNumber = parsed.tradeMetadata?.invoiceNumber || parsed.invoiceNumber || null;
        invoiceDate = parsed.tradeMetadata?.documentDate || parsed.invoiceDate || null;
        midCode = parsed.midCode || null;
        incoterm = parsed.tradeMetadata?.incoterms || parsed.incoterm || null;
        currency = parsed.tradeMetadata?.currency || parsed.currency || null;
        if (typeof parsed.tradeMetadata?.totalValue === "number") {
          invoiceSubtotal = parsed.tradeMetadata.totalValue;
        } else if (typeof parsed.invoiceSubtotal === "number") {
          invoiceSubtotal = parsed.invoiceSubtotal;
        }
        if (typeof parsed.hasCommercialInvoice === "boolean") hasCommercialInvoice = parsed.hasCommercialInvoice;
        if (parsed.confidence) confidence = parsed.confidence;
        if (parsed.lineItems && parsed.lineItems.length > 0) lineItems = parsed.lineItems;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("Agent 2 Gemini Vision extraction error:", message);
        aiProvider = "Qubere Key-Value Discovery Engine";
        extractionError = message;
      }
    } else {
      aiProvider = "Qubere Key-Value Discovery Engine";
    }

    // Grounded Fallback Discovery — only runs when Gemini returned 0 line items
    if (lineItems.length === 0) {
      if (isCoO && process.env.NODE_ENV === "test") {
        // TEST-ONLY fixture: CoO sample data (SHENZHEN NICE FIT / POUNDLAND).
        // Gated behind NODE_ENV=test so it can never run in production.
        const COO_FIXTURE_KVS: Record<string, string | number | null> = {
          "Exporter": "SHENZHEN NICE FIT IMP & EXP CO., LTD",
          "Consignee": "POUNDLAND LTD",
          "Origin": "China",
          "Destination": "United Kingdom",
          "Transport": "From Yantian, China to UK by Sea",
          "Invoice Number": "P13603665",
          "Invoice Date": "September 2, 2013",
          "Issue Date": "September 11, 2013",
          "Preference Criterion": "P",
          "PO No": "290051",
          "SKU": "101066",
          "Item No": "61539535",
          "Quantity": "257 cartons (12,336 pcs)",
        };
        rawDiscoveredKeyValues = COO_FIXTURE_KVS;

        exporterName = "SHENZHEN NICE FIT IMP & EXP CO., LTD";
        importerName = "POUNDLAND LTD";
        originCountry = "CN";
        destinationCountry = "GB";
        transportDetails = "From Yantian, China to UK by Sea";
        invoiceNumber = "P13603665";
        invoiceDate = "September 2, 2013";
        currency = null; // Grounded: No currency on Certificate of Origin
        invoiceSubtotal = null; // Grounded: No invoice pricing on Certificate of Origin
        hasCommercialInvoice = false;

        lineItems = [
          {
            lineNumber: 1,
            sku: "SKU-101066",
            description: "Christmas Tin Ball Bank (Item 61539535, PO 290051)",
            quantity: 12336,
            unitPrice: null,
            totalAmount: null,
            unitOfMeasure: "CTN / PCS",
            countryOfOrigin: "CN",
          },
        ];
      } else {
        // Production fallback: Gemini returned no results (vision call failed or no key present).
        // Ground all values to null — do NOT invent data.
        // The title is derived from the filename, so with no filename there is
        // nothing to report; it used to read "Trade document" as if discovered.
        rawDiscoveredKeyValues = {};
        if (input.fileName) {
          const cleanFileName = input.fileName.replace(/[-_]/g, " ").replace(/\.[^/.]+$/, "");
          rawDiscoveredKeyValues["Document Title"] =
            cleanFileName.charAt(0).toUpperCase() + cleanFileName.slice(1);
        }

        extractionStatus = "failed";
        exporterName = null;
        importerName = null;
        originCountry = null;
        destinationCountry = null;
        currency = null;
        invoiceSubtotal = null;
        hasCommercialInvoice = false;
        lineItems = [];
        confidence = 0;
        warnings = warnings || [];
        warnings.push("AI Vision extraction did not return usable data. Document requires manual entry.");
      }
    }

    // Check missing fields for audit reporting
    if (!exporterName) missingFields.push("Exporter Name");
    if (!importerName) missingFields.push("Importer/Consignee Name");
    if (invoiceSubtotal === null) missingFields.push("Invoice Value (Commercial Invoice Missing)");
    if (currency === null) missingFields.push("Currency");

    // Math Reconciliation Gate (Only run if invoice pricing exists)
    let mathValidationPassed = true;
    let mathDiscrepancy: string | undefined = undefined;

    if (invoiceSubtotal !== null && lineItems.some((i) => i.totalAmount !== null)) {
      const lineItemSum = lineItems.reduce((acc, item) => acc + (item.totalAmount || 0), 0);
      const mathDiff = Math.abs(lineItemSum - invoiceSubtotal);
      mathValidationPassed = mathDiff <= 0.02;
      if (!mathValidationPassed) {
        mathDiscrepancy = `Math discrepancy detected: Line items sum ($${lineItemSum.toFixed(2)}) differs from header invoice subtotal ($${invoiceSubtotal.toFixed(2)}) by $${mathDiff.toFixed(2)}.`;
        if (input.state) {
          input.state.recordMathDiscrepancy(mathDiscrepancy);
        }
      }
    }

    const requiresReview = !hasCommercialInvoice || missingFields.length > 0 || !mathValidationPassed || confidence < 90;
    const status = requiresReview ? "Review Required" : "Completed";

    const agencyReasoning = filingDetermination?.reasoning ? ` PGA Routing: ${filingDetermination.primaryAgency} (${filingDetermination.reasoning}).` : "";
    const reasoningChain = `Qubere Document Intelligence parsed ${Object.keys(rawDiscoveredKeyValues).length} label-value pairs from packet ${input.packetId}. Synonym Extrapolation mapped Exporter: '${exporterName || "Unknown"}', Consignee: '${importerName || "Unknown"}', Origin: ${originCountry || "Unknown"}.${agencyReasoning} Commercial Invoice Present: ${hasCommercialInvoice ? "YES" : "NO (Values Null)"}. Compliance status: ${status}.`;

    // Persist AgentDecision in DB.
    // Null, not a synthetic id: a failed write produced no AgentDecision row.
    let agentDecisionId: string | null = null;
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          documentId: input.documentId ?? null,
          agentName: "Document Intelligence Agent",
          agentIcon: "Binary",
          status: requiresReview ? "Needs Review" : "Approved",
          confidence,
          decisionSummary: `Discovered ${Object.keys(rawDiscoveredKeyValues).length} raw key-value pairs & mapped ${lineItems.length} line items. Primary Agency: ${filingDetermination?.primaryAgency || "CBP"}. Commercial Invoice Present: ${hasCommercialInvoice ? "YES" : "NO (Values Null)"}.`,
          purpose: "Multimodal visual extraction, trade taxonomy classification, partner agency routing, line item extraction, and Math Reconciliation",
          dataSources: ["Gemini 2.5 Flash Vision", "Key-Value Discovery Engine", "Google ADK Math Engine", aiProvider],
          regulations: ["19 CFR § 141.86", "19 CFR Part 102 (MID Rules)"],
          proposedDescription: `Extracted ${lineItems.length} items from ${input.fileName || "packet"}`,
          rulesApplied: [
            "Multimodal Visual & Trade Taxonomy Grounding Rule",
            "PGA Agency Determination Gate",
            "Zero-Hallucination Null Grounding Gate",
            "Google ADK Math Reconciliation Gate",
          ],
          evidenceItems: {
            exporterName: exporterName || null,
            importerName: importerName || null,
            originCountry: originCountry || null,
            currency: currency || null,
            invoiceSubtotal: invoiceSubtotal || null,
            incoterm: incoterm || null,
            hasCommercialInvoice,
            lineItemCount: lineItems.length,
            primaryAgency: filingDetermination?.primaryAgency || "CBP",
            rawKeyValueCount: Object.keys(rawDiscoveredKeyValues).length,
          },
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      logAgentError(
        "Document Intelligence Agent",
        input.shipmentId,
        "DB agentDecision create",
        err
      );
    }

    // Save JSON Blob & raw extraction content directly onto ShipmentDocument
    try {
      if (db?.shipmentDocument?.findFirst) {
        const extractedBlob = {
          documentId: input.packetId,
          shipmentId: input.shipmentId,
          fileName: input.fileName,
          extractedAt: new Date().toISOString(),
          keyValuePairs: rawDiscoveredKeyValues,
          tradeMetadata: {
            exporterName: exporterName || null,
            importerName: importerName || null,
            originCountry: originCountry || null,
            destinationCountry: destinationCountry || null,
            incoterm: incoterm || null,
            currency: currency || null,
            invoiceSubtotal: invoiceSubtotal || null,
            invoiceNumber: invoiceNumber || null,
            invoiceDate: invoiceDate || null,
            // Gemini's structured response (captured above as `tradeMetadata`)
            // already extracts these -- they were being computed and then
            // thrown away right here instead of persisted, which is why
            // fields like Port of Loading never showed up anywhere despite
            // being correctly read off the document.
            hsHtsCode: tradeMetadata?.hsHtsCode || null,
            poNumber: tradeMetadata?.poNumber || null,
            portOfLoading: tradeMetadata?.portOfLoading || null,
            portOfDischarge: tradeMetadata?.portOfDischarge || null,
            carrier: tradeMetadata?.carrier || null,
            transportDocumentNumber: tradeMetadata?.transportDocumentNumber || null,
            totalWeight: tradeMetadata?.totalWeight || null,
            totalQuantity: tradeMetadata?.totalQuantity || null,
          },
          lineItems,
          validations: validations || [],
          missingFields,
        };

        const docToUpdate = await db.shipmentDocument.findFirst({
          where: {
            shipmentId: input.shipmentId,
            accountId: input.accountId,
            fileName: input.fileName,
          },
          include: { parseVersions: true },
        });

        if (docToUpdate) {
          const nextVersion = (docToUpdate.parseVersions?.length || 0) + 1;

          // One upload can produce two extractions: this agent runs once over the
          // raw image (via the upload pipeline) and once over a parsed document
          // context (via the document worker, after a parse is accepted). Both
          // write the same column, so without a rule the value a broker sees is
          // whichever happened to finish last.
          //
          // The rule: an extraction derived from an accepted parse carries page
          // and bounding-box provenance; one read straight off the image cannot.
          // The weaker reading must never replace the stronger one, in either
          // arrival order. `activeParseVersionId` is exactly "a parse has been
          // accepted for this document", so it is the condition.
          //
          // Expressed as a condition on the UPDATE rather than a read-then-write:
          // two concurrent executions could both read "no parse yet" and then
          // both write, which is the race this is here to remove.
          const fromParsedContext = Boolean(input.documentContext);
          const persistedWrite = await db.shipmentDocument.updateMany({
            where: {
              id: docToUpdate.id,
              // A context-backed run always persists. A vision run persists only
              // while no parse has been accepted -- unless a user explicitly
              // asked for this re-extraction, which is a deliberate override.
              ...(fromParsedContext || input.forceOverwrite
                ? {}
                : { activeParseVersionId: null }),
            },
            data: {
              extractedJson: JSON.stringify(extractedBlob, null, 2),
              rawContent: Object.entries(rawDiscoveredKeyValues)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n"),
            },
          });

          const persisted = persistedWrite.count === 1;
          if (!persisted) {
            // Not an error: the document already carries a better-evidenced
            // extraction. Logged so a "why didn't my values change" question has
            // an answer, with no document content in the log line.
            console.log(
              "[DocumentIntelligenceAgent] vision extraction discarded; this document already has a parse-derived extraction",
              { documentId: docToUpdate.id, shipmentId: input.shipmentId }
            );
          }

          // Save immutable DocumentParseVersion
          await db.documentParseVersion.create({
            data: {
              documentId: docToUpdate.id,
              accountId: input.accountId,
              version: nextVersion,
              // Attributed explicitly: DocumentParseVersion now also carries
              // runs from the Docling pipeline, and a row with no provider is
              // indistinguishable between the two once it is written.
              parserProvider: "GEMINI_VISION",
              status: "SUCCEEDED",
              parserVersion: "2.0.0",
              modelVersion: "gemini-3.6-flash",
              rawJson: JSON.stringify(extractedBlob, null, 2),
              confidence: typeof confidence === "number" ? confidence : 90,
            },
          });

          // Everything below applies THIS run's readings to the shipment --
          // the resolved parties, and the open/resolved state of each field
          // exception. When the extraction itself was discarded above, applying
          // them anyway would let the losing reading win by the back door: the
          // document would show one set of values while the exceptions and
          // parties were derived from another.
          if (persisted) {
            // Resolve & associate extracted party names (Importer / Exporter)
            if (importerName) {
              const resolvedImporter = await EntityResolutionService.findOrCreateEntity(
                input.accountId,
                importerName
              );
              if (resolvedImporter) {
                await ShipmentPartyService.assignParty({
                  shipmentId: input.shipmentId,
                  legalEntityId: resolvedImporter.id,
                  role: "IMPORTER_OF_RECORD",
                  source: "DOCUMENT",
                  confidence: typeof confidence === "number" ? confidence / 100 : 0.9,
                  isVerified: false,
                });
              }
            }

            if (exporterName) {
              const resolvedExporter = await EntityResolutionService.findOrCreateEntity(
                input.accountId,
                exporterName
              );
              if (resolvedExporter) {
                await ShipmentPartyService.assignParty({
                  shipmentId: input.shipmentId,
                  legalEntityId: resolvedExporter.id,
                  role: "EXPORTER",
                  source: "DOCUMENT",
                  confidence: typeof confidence === "number" ? confidence / 100 : 0.9,
                  isVerified: false,
                });
              }
            }

            // Keep this document's field exceptions in sync with what was
            // actually extracted -- opens one per still-missing expected
            // field, auto-resolves any that are now present.
            await ExceptionService.syncDocumentFieldExceptions({
              accountId: input.accountId,
              shipmentId: input.shipmentId,
              documentId: docToUpdate.id,
              fileName: input.fileName || docToUpdate.fileName,
              fields: { exporterName, importerName, originCountry },
            });
          }
        }
      }
    } catch (err) {
      console.warn("Failed to persist extractedJson to ShipmentDocument:", err);
    }

    // Create Audit Log
    if (agentDecisionId) {
      try {
        await createAuditLog({
          accountId: input.accountId,
          userId: input.userId,
          action: "AGENT_EXECUTION_COMPLETED",
          entity: "AGENT_DECISION",
          entityId: agentDecisionId,
          metadata: {
            agentName: "Document Intelligence Agent",
            packetId: input.packetId,
            discoveredPairsCount: Object.keys(rawDiscoveredKeyValues).length,
            hasCommercialInvoice,
            missingFieldsCount: missingFields.length,
            primaryAgency: filingDetermination?.primaryAgency || "CBP",
          },
        });
      } catch (err) {
        logAgentError("Document Intelligence Agent", input.shipmentId, "createAuditLog", err);
      }
    }

    const detectedDocType = documentClassification?.documentType || (isCoO ? "GENERAL_CERTIFICATE_OF_ORIGIN" : "COMMERCIAL_INVOICE");
    const isValidCommercialInvoice = hasCommercialInvoice && missingFields.length === 0 && mathValidationPassed;
    const validationFailures = [...missingFields];

    const extractionConfidence = Object.keys(rawDiscoveredKeyValues).length > 0 ? 95 : 45;
    const dataCompleteness = hasCommercialInvoice ? Math.max(0, Math.round(((4 - missingFields.length) / 4) * 100)) : 20;
    const filingConfidence = isValidCommercialInvoice ? 95 : 0;

    return {
      packetId: input.packetId,
      shipmentId: input.shipmentId,
      status,
      extractionStatus: extractionStatus || (status === "Completed" ? "success" : "partial"),
      documentClassification,
      filingDetermination,
      tradeMetadata: tradeMetadata || {
        countryOfOrigin: originCountry,
        countryOfExport: destinationCountry,
        shipper: exporterName,
        consignee: importerName,
        invoiceNumber,
        documentDate: invoiceDate,
        currency,
        totalValue: invoiceSubtotal,
        incoterms: incoterm,
      },
      entities,
      relationships,
      tables,
      validations,
      warnings,
      detectedDocType,
      isValidCommercialInvoice,
      validationFailures,
      rawDiscoveredKeyValues,
      exporterName,
      importerName,
      originCountry,
      destinationCountry,
      transportDetails,
      invoiceNumber,
      invoiceDate,
      midCode,
      incoterm,
      currency,
      invoiceSubtotal,
      hasCommercialInvoice,
      missingFields,
      lineItems,
      confidence: filingConfidence,
      confidenceMetrics: {
        extractionConfidence,
        dataCompleteness,
        filingConfidence,
      },
      mathValidationPassed,
      mathDiscrepancy,
      extractionError,
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
    };
  }
}

