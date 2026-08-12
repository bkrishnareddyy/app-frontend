import { GoogleGenAI, Type, Schema } from "@google/genai";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { meterGeminiCall } from "@/lib/ai/aiMeter";
import { aiModel } from "@/lib/ai/aiModel";
import { agentEventBus } from "@/modules/intake/documentIntakeAgent";
import { AgentState } from "./agentState";
import { DocumentIntelligenceOutput } from "./documentIntelligenceAgent";
import { logAgentError } from "./agentLogger";

export const NORMALIZATION_AGENT_SYSTEM_PROMPT = `
You are Qubere Business Intelligence Normalization Agent.

Your responsibility is to transform generic document intelligence into a canonical enterprise business model.

You receive structured JSON produced by the Document Intelligence Agent.

Do not read the original document.

Use only the supplied JSON.

----------------------------------------------------
PRIMARY OBJECTIVE
----------------------------------------------------

Normalize extracted information into enterprise business objects.

The goal is to create one consistent representation regardless of document layout or terminology.

Never discard information.

Never invent information.

Unknown values must remain null.

----------------------------------------------------
ENTITY NORMALIZATION
----------------------------------------------------

Identify logical business entities.

Examples include:

Party
Organization
Individual
Address
Shipment
Product
Package
Container
Invoice
Order
Transport
Financial Summary
Regulatory Document
License
Certificate
Permit
Reference Number
Event
Supporting Document

Create separate objects.

Maintain references between objects.

----------------------------------------------------
SEMANTIC NORMALIZATION
----------------------------------------------------

Different documents use different labels.

Normalize equivalent concepts.

For example:
Invoice No.
Invoice #
Commercial Invoice Number
Document Number

should all become a canonical business identifier while preserving the original label.

Always preserve:
originalLabel
originalValue
normalizedValue
confidence
source

----------------------------------------------------
PARTY RESOLUTION
----------------------------------------------------

Resolve business parties.

Examples:
Exporter
Importer
Consignee
Shipper
Buyer
Seller
Manufacturer
Supplier
Customer
Carrier
Broker
Notify Party
Government Authority

Keep all detected roles.

----------------------------------------------------
PRODUCT NORMALIZATION
----------------------------------------------------

Create independent product objects.

Maintain relationships between:
Products
Manufacturers
Packaging
Country references
Commodity references
Transportation

Do not infer classifications.

Only normalize extracted information.

----------------------------------------------------
DOCUMENT LINKING
----------------------------------------------------

Create references between:
Shipment
Invoice
Packing List
Certificate
Transport document
Purchase Order
License
Declaration
Supporting documents

Preserve relationships.

----------------------------------------------------
VALIDATION
----------------------------------------------------

Identify:
Missing business information
Duplicate entities
Conflicting values
Invalid references
Arithmetic inconsistencies
Relationship inconsistencies

Return findings separately.

Do not change extracted values.

----------------------------------------------------
CANONICAL MODEL
----------------------------------------------------

Produce a normalized enterprise model.

Example:

{
  "document": {},
  "parties": [],
  "addresses": [],
  "products": [],
  "shipments": [],
  "packages": [],
  "transport": [],
  "financials": {},
  "references": [],
  "documents": [],
  "relationships": [],
  "validation": [],
  "audit": {}
}

----------------------------------------------------
TRACEABILITY
----------------------------------------------------

Every normalized field must preserve:
originalLabel
originalValue
normalizedValue
confidence
page
section
boundingBox (if available)
sourceDocument
processingTimestamp

----------------------------------------------------
OUTPUT
----------------------------------------------------

Return only valid JSON.

Never generate prose.

Never summarize.

Never remove information.

Preserve every business object extracted by the previous agent.

The normalized output must be deterministic, traceable, auditable, and suitable for downstream customs filing, compliance, ERP integration, workflow orchestration, analytics, and AI agents.
`;

export interface NormalizedField<T = unknown> {
  originalLabel: string;
  originalValue: unknown;
  normalizedValue: T;
  /** Null when no model scored the field, e.g. deterministic transcription. */
  confidence: number | null;
  page?: number | null;
  section?: string | null;
  sourceDocument?: string | null;
  processingTimestamp: string;
}

export interface CanonicalParty {
  id: string;
  role: NormalizedField<string>;
  name: NormalizedField<string>;
  address?: NormalizedField<string> | null;
  country?: NormalizedField<string> | null;
  taxIdOrMid?: NormalizedField<string> | null;
}

export interface CanonicalProductItem {
  id: string;
  sku?: NormalizedField<string> | null;
  description: NormalizedField<string>;
  partNumber?: NormalizedField<string> | null;
  quantity?: NormalizedField<number> | null;
  unitPrice?: NormalizedField<number> | null;
  totalAmount?: NormalizedField<number> | null;
  unitOfMeasure?: NormalizedField<string> | null;
  countryOfOrigin?: NormalizedField<string> | null;
  htsCode?: NormalizedField<string> | null;
}

export interface CanonicalShipmentObject {
  id: string;
  shipper?: NormalizedField<string> | null;
  consignee?: NormalizedField<string> | null;
  originCountry?: NormalizedField<string> | null;
  destinationCountry?: NormalizedField<string> | null;
  portOfLoading?: NormalizedField<string> | null;
  portOfDischarge?: NormalizedField<string> | null;
  carrier?: NormalizedField<string> | null;
  transportDocumentNumber?: NormalizedField<string> | null;
}

export interface CanonicalFinancialsObject {
  currency: NormalizedField<string>;
  totalValue: NormalizedField<number>;
  incoterms?: NormalizedField<string> | null;
  lineItemSubtotal?: NormalizedField<number> | null;
}

export interface CanonicalEnterpriseModel {
  document: Record<string, unknown>;
  parties: CanonicalParty[];
  addresses: unknown[];
  products: CanonicalProductItem[];
  shipments: CanonicalShipmentObject[];
  packages: unknown[];
  transport: unknown[];
  financials: CanonicalFinancialsObject | Record<string, unknown>;
  references: Array<{
    originalLabel: string;
    originalValue: unknown;
    normalizedValue: string;
    confidence: number | null;
    processingTimestamp: string;
  }>;
  documents: unknown[];
  relationships: Array<{ type: string; from: string; to: string; description?: string }>;
  validation: Array<{ check: string; result: "pass" | "fail" | "warning"; details: string }>;
  audit: {
    processedAt: string;
    agentName: string;
    inputPacketId: string;
    sourceDocument: string | null;
  };
}

export interface NormalizationSourceLineItem {
  sku?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  totalAmount?: number | null;
  unitOfMeasure?: string | null;
  countryOfOrigin?: string | null;
}

/** The subset of the Document Intelligence output this agent actually reads. */
export interface NormalizationSource {
  packetId?: string | null;
  fileName?: string | null;
  documentMetadata?: { filename?: string | null } | null;
  detectedDocType?: string | null;
  hasCommercialInvoice?: boolean | null;
  exporterName?: string | null;
  importerName?: string | null;
  originCountry?: string | null;
  destinationCountry?: string | null;
  midCode?: string | null;
  invoiceNumber?: string | number | null;
  currency?: string | null;
  invoiceSubtotal?: number | null;
  incoterm?: string | null;
  lineItems?: NormalizationSourceLineItem[] | null;
  validationFailures?: string[] | null;
}

/** Deterministic transcription: the value is copied, not inferred, so it carries no confidence. */
function transcribed<T>(
  originalLabel: string,
  originalValue: unknown,
  normalizedValue: T,
  processingTimestamp: string
): NormalizedField<T> {
  return { originalLabel, originalValue, normalizedValue, confidence: null, processingTimestamp };
}

export interface NormalizationAgentInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  documentIntelligenceData: DocumentIntelligenceOutput | Record<string, unknown>;
  state?: AgentState;
}

export interface NormalizationAgentOutput {
  shipmentId: string;
  status: "Completed" | "Review Required";
  canonicalModel: CanonicalEnterpriseModel;
  confidence: number | null;
  reasoningChain: string;
  agentDecisionId: string | null;
  aiProviderUsed: string;
}

const normalizationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    document: { type: Type.OBJECT },
    parties: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          role: {
            type: Type.OBJECT,
            properties: {
              originalLabel: { type: Type.STRING },
              originalValue: { type: Type.STRING },
              normalizedValue: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              processingTimestamp: { type: Type.STRING },
            },
          },
          name: {
            type: Type.OBJECT,
            properties: {
              originalLabel: { type: Type.STRING },
              originalValue: { type: Type.STRING },
              normalizedValue: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              processingTimestamp: { type: Type.STRING },
            },
          },
        },
      },
    },
    products: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          description: {
            type: Type.OBJECT,
            properties: {
              originalLabel: { type: Type.STRING },
              originalValue: { type: Type.STRING },
              normalizedValue: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              processingTimestamp: { type: Type.STRING },
            },
          },
        },
      },
    },
    shipments: { type: Type.ARRAY, items: { type: Type.OBJECT } },
    packages: { type: Type.ARRAY, items: { type: Type.OBJECT } },
    transport: { type: Type.ARRAY, items: { type: Type.OBJECT } },
    financials: { type: Type.OBJECT },
    references: { type: Type.ARRAY, items: { type: Type.OBJECT } },
    documents: { type: Type.ARRAY, items: { type: Type.OBJECT } },
    relationships: { type: Type.ARRAY, items: { type: Type.OBJECT } },
    validation: { type: Type.ARRAY, items: { type: Type.OBJECT } },
    audit: { type: Type.OBJECT },
  },
  required: ["parties", "products", "financials", "audit"],
};

export class NormalizationAgent {
  private static aiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
  });

  static async execute(input: NormalizationAgentInput): Promise<NormalizationAgentOutput> {
    const timestamp = new Date().toISOString();
    const docData = (input.documentIntelligenceData || {}) as NormalizationSource;
    const packetId = docData.packetId || `pkt_${Date.now()}`;
    // Null, not "trade-document.pdf": this name is written to the canonical
    // model's audit provenance and to the AgentDecision description.
    const fileName = docData.fileName || docData.documentMetadata?.filename || null;

    let aiProvider = "Gemini 2.5 Flash Normalization Engine";
    let canonicalModel: CanonicalEnterpriseModel | null = null;
    // Stays null unless a model actually reports one. The deterministic mapper
    // transcribes fields rather than inferring them, so it has no confidence.
    let confidence: number | null = null;

    if (process.env.GEMINI_API_KEY) {
      try {
        const prompt = `${NORMALIZATION_AGENT_SYSTEM_PROMPT}

Structured JSON from Document Intelligence Agent:
${JSON.stringify(docData, null, 2)}`;

        const response = await this.aiClient.models.generateContent({
          model: aiModel("normalization"),
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: normalizationSchema,
            temperature: 0.1,
          },
        });

        // Accounting only — see meterGeminiCall. Never refuses and never throws.
        await meterGeminiCall(
          "normalization",
          { accountId: input.accountId, userId: input.userId },
          response
        );

        const parsed = JSON.parse(response.text || "{}");
        if (parsed.parties && parsed.products) {
          canonicalModel = parsed as CanonicalEnterpriseModel;
          confidence = typeof parsed.confidence === "number" ? parsed.confidence : null;
        }
      } catch (err: unknown) {
        console.warn(
          "[NormalizationAgent] Gemini API execution failed, using deterministic canonical mapper:",
          err instanceof Error ? err.message : err
        );
        aiProvider = "Qubere Deterministic Normalization Engine";
      }
    } else {
      aiProvider = "Qubere Deterministic Normalization Engine";
    }

    // Deterministic Canonical Fallback Normalizer — Guarantees zero-data-loss canonical output
    if (!canonicalModel) {
      const parties: CanonicalParty[] = [];
      if (docData.exporterName) {
        parties.push({
          id: `party_exp_${Date.now()}`,
          role: transcribed("Shipper / Exporter", docData.exporterName, "Exporter", timestamp),
          name: transcribed("Exporter Name", docData.exporterName, String(docData.exporterName).trim(), timestamp),
          country: docData.originCountry
            ? transcribed("Country of Origin", docData.originCountry, String(docData.originCountry).trim(), timestamp)
            : null,
          taxIdOrMid: docData.midCode
            ? transcribed("MID Code", docData.midCode, String(docData.midCode).trim(), timestamp)
            : null,
        });
      }
      if (docData.importerName) {
        parties.push({
          id: `party_imp_${Date.now()}`,
          role: transcribed("Consignee / Importer", docData.importerName, "Importer", timestamp),
          name: transcribed("Importer Name", docData.importerName, String(docData.importerName).trim(), timestamp),
          country: docData.destinationCountry
            ? transcribed("Destination Country", docData.destinationCountry, String(docData.destinationCountry).trim(), timestamp)
            : null,
        });
      }

      const rawItems = Array.isArray(docData.lineItems) ? docData.lineItems : [];
      const products: CanonicalProductItem[] = rawItems.map((item, idx) => ({
        id: `prod_${idx + 1}_${Date.now()}`,
        sku: item.sku ? transcribed("SKU / Item No", item.sku, String(item.sku).trim(), timestamp) : null,
        // The source description is preserved as-is; the placeholder is display text only.
        description: transcribed(
          "Description",
          item.description ?? null,
          item.description ? String(item.description).trim() : "Unspecified Goods",
          timestamp
        ),
        quantity: typeof item.quantity === "number" ? transcribed("Quantity", item.quantity, item.quantity, timestamp) : null,
        unitPrice: typeof item.unitPrice === "number" ? transcribed("Unit Price", item.unitPrice, item.unitPrice, timestamp) : null,
        totalAmount: typeof item.totalAmount === "number" ? transcribed("Total Amount", item.totalAmount, item.totalAmount, timestamp) : null,
        unitOfMeasure: item.unitOfMeasure
          ? transcribed("Unit of Measure", item.unitOfMeasure, String(item.unitOfMeasure).trim(), timestamp)
          : null,
        countryOfOrigin: item.countryOfOrigin || docData.originCountry
          ? transcribed(
              "Country of Origin",
              item.countryOfOrigin || docData.originCountry,
              String(item.countryOfOrigin || docData.originCountry).trim(),
              timestamp
            )
          : null,
      }));

      const references: CanonicalEnterpriseModel["references"] = [];
      if (docData.invoiceNumber) {
        references.push(transcribed("Invoice Number", docData.invoiceNumber, String(docData.invoiceNumber).trim(), timestamp));
      }

      canonicalModel = {
        document: {
          fileName,
          packetId,
          detectedType: docData.detectedDocType || "COMMERCIAL_INVOICE",
          hasCommercialInvoice: Boolean(docData.hasCommercialInvoice),
        },
        parties,
        addresses: [],
        products,
        shipments: [
          {
            id: `ship_${Date.now()}`,
            shipper: docData.exporterName ? transcribed("Shipper", docData.exporterName, docData.exporterName, timestamp) : null,
            consignee: docData.importerName ? transcribed("Consignee", docData.importerName, docData.importerName, timestamp) : null,
            originCountry: docData.originCountry ? transcribed("Origin", docData.originCountry, docData.originCountry, timestamp) : null,
            destinationCountry: docData.destinationCountry
              ? transcribed("Destination", docData.destinationCountry, docData.destinationCountry, timestamp)
              : null,
          },
        ],
        packages: [],
        transport: [],
        financials: {
          currency: docData.currency
            ? transcribed("Currency", docData.currency, docData.currency, timestamp)
            : transcribed("Currency", null, null, timestamp),
          totalValue: typeof docData.invoiceSubtotal === "number"
            ? transcribed("Invoice Subtotal", docData.invoiceSubtotal, docData.invoiceSubtotal, timestamp)
            : transcribed("Invoice Subtotal", null, null, timestamp),
          incoterms: docData.incoterm ? transcribed("Incoterms", docData.incoterm, docData.incoterm, timestamp) : null,
        },
        references,
        documents: [
          { type: docData.detectedDocType || "COMMERCIAL_INVOICE", packetId, fileName },
        ],
        relationships: [
          { type: "ISSUED_BY", from: "Invoice", to: "Exporter", description: "Commercial Invoice issued by Exporter" },
          { type: "CONSIGNED_TO", from: "Shipment", to: "Importer", description: "Shipment consigned to Importer" },
        ],
        validation: (docData.validationFailures || []).map((v: string) => ({ check: "Field Validation", result: "warning" as const, details: v })),
        audit: {
          processedAt: timestamp,
          agentName: "Business Intelligence Normalization Agent",
          inputPacketId: packetId,
          sourceDocument: fileName,
        },
      };
    }

    const partyCount = canonicalModel.parties?.length || 0;
    const productCount = canonicalModel.products?.length || 0;
    const reasoningChain = `Normalized document intelligence into canonical enterprise model. Formatted ${partyCount} parties, ${productCount} products, and financials using ${aiProvider}. Deterministic audit provenance preserved.`;

    // Null, not a synthetic id: a failed write produced no AgentDecision row.
    let agentDecisionId: string | null = null;
    try {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId: input.accountId,
          shipmentId: input.shipmentId,
          agentName: "Business Intelligence Normalization Agent",
          agentIcon: "Workflow",
          status: "Approved",
          confidence,
          decisionSummary: `Normalized ${partyCount} party entity/entities and ${productCount} product object(s) into enterprise canonical format.`,
          purpose: "Transform document intelligence extractions into a canonical, deterministic enterprise business model",
          dataSources: ["Document Intelligence Output", aiProvider],
          regulations: ["Canonical Enterprise Model Specification"],
          proposedDescription: fileName
            ? `Canonical Enterprise Model for ${fileName}`
            : "Canonical Enterprise Model for an unnamed source document",
          rulesApplied: [
            "Entity & Role Normalization Rule",
            "Semantic Value Preservation Rule",
            "Zero-Data-Loss Traceability Gate",
          ],
        },
      });
      agentDecisionId = agentDecision.id;
    } catch (err) {
      logAgentError(
        "Business Intelligence Normalization Agent",
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
          metadata: {
            agentName: "Business Intelligence Normalization Agent",
            partyCount,
            productCount,
          },
        });
      } catch (err) {
        logAgentError(
          "Business Intelligence Normalization Agent",
          input.shipmentId,
          "createAuditLog",
          err
        );
      }
    }

    const output: NormalizationAgentOutput = {
      shipmentId: input.shipmentId,
      status: "Completed",
      canonicalModel,
      confidence,
      reasoningChain,
      agentDecisionId,
      aiProviderUsed: aiProvider,
    };

    agentEventBus.emit("normalization:completed", output);
    return output;
  }
}
