import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
import { z } from "zod";
import type { AccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveTeamMembers } from "@/lib/team";
// Lazy dynamic imports for route handlers to avoid compiling all routes on startup/first chat message
const getShipmentsRoute = () => import("@/app/api/shipments/route");
const getShipmentDetailRoute = () => import("@/app/api/shipments/[id]/route");
const getProductsRoute = () => import("@/app/api/products/route");
const getProductDetailRoute = () => import("@/app/api/products/[id]/route");
const getClassificationsRoute = () => import("@/app/api/products/[id]/classifications/route");
const getClassificationReviewRoute = () => import("@/app/api/products/[id]/classifications/[classificationId]/route");
const getPartiesRoute = () => import("@/app/api/parties/route");
const getDocumentsRoute = () => import("@/app/api/documents/route");
const getDocumentExtractionsRoute = () => import("@/app/api/documents/[id]/extractions/route");
const getDecisionsRoute = () => import("@/app/api/decisions/route");
const getExceptionsRoute = () => import("@/app/api/exceptions/[id]/route");
const getFilingRoute = () => import("@/app/api/filing/[id]/route");
import { ExceptionService } from "@/modules/exceptions/exception.service";
import { HtsSearchService } from "@/modules/hts/htsSearchService";
import { RulingService } from "@/modules/classification/rulingService";
import { calculateDutyStack, loadHtsCodesMap, type TariffLineInput } from "@/lib/tariff/dutyEngine";
import { ImpactAnalysisService } from "@/modules/regulatory/impactAnalysisService";
import { canUseTool } from "@/modules/copilot/copilotAccess";
import type { CopilotToolAccess } from "@/modules/copilot/copilotToolTypes";

/**
 * Helper to convert Zod Object Schema into Gemini-compatible Schema object
 */
export function zodToGeminiSchema(zodSchema: z.ZodObject<any>): Schema {
  const shape = zodSchema.shape;
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const [key, prop] of Object.entries(shape)) {
    let unwrapped: any = prop;
    let isOptional = false;
    let desc: string | undefined = (prop as any).description;

    while (unwrapped._def?.innerType || unwrapped._def?.schema) {
      if (unwrapped._def?.typeName === "ZodOptional" || unwrapped._def?.typeName === "ZodDefault") {
        if (unwrapped._def?.typeName === "ZodOptional") isOptional = true;
        unwrapped = unwrapped._def.innerType || unwrapped._def.schema;
      } else {
        break;
      }
    }

    if (!isOptional && (prop as any)._def?.typeName !== "ZodOptional" && (prop as any)._def?.typeName !== "ZodDefault") {
      required.push(key);
    }

    const typeName = unwrapped._def?.typeName;
    let type = Type.STRING;
    if (typeName === "ZodNumber") type = Type.NUMBER;
    else if (typeName === "ZodBoolean") type = Type.BOOLEAN;
    else if (typeName === "ZodArray") type = Type.ARRAY;
    else if (typeName === "ZodObject") type = Type.OBJECT;

    properties[key] = {
      type,
      ...(desc && { description: desc }),
    };
  }

  return {
    type: Type.OBJECT,
    properties,
    ...(required.length > 0 && { required }),
  };
}

export interface AssistantTool {
  declaration: FunctionDeclaration;
  schema: z.ZodObject<any>;
  access?: CopilotToolAccess;
  execute: (ctx: AccountContext, args: Record<string, unknown>) => Promise<unknown>;
}

// ---- shared shipment fetch (backs list_shipments and get_value_at_risk) ----

interface FetchedShipment {
  id: string;
  shipmentNumber: string;
  importerName: string;
  status: string;
  healthStatus: string | null;
  readinessScore: number | null;
  riskScore: number | null;
  assignedBrokerId: string | null;
  assignedBroker: { id: string; firstName: string | null; lastName: string | null } | null;
  clientId: string | null;
  client: { id: string; name: string } | null;
  estimatedArrival: string | null;
  lineItems: { totalValue: string | number }[];
  exceptionItems: { status: string; severity: string }[];
}

const SHIPMENT_FETCH_PAGE_SIZE = 100;
const SHIPMENT_FETCH_MAX_PAGES = 5;

async function fetchAllShipments(): Promise<FetchedShipment[]> {
  const all: FetchedShipment[] = [];
  const shipmentsGET = (await getShipmentsRoute()).GET;
  for (let page = 1; page <= SHIPMENT_FETCH_MAX_PAGES; page++) {
    const res = await shipmentsGET(
      new Request(`http://internal.local/api/shipments?pageSize=${SHIPMENT_FETCH_PAGE_SIZE}&page=${page}`)
    );
    if (!res.ok) break;
    const data = (await res.json()) as { shipments: FetchedShipment[] };
    all.push(...(data.shipments ?? []));
    if (!data.shipments || data.shipments.length < SHIPMENT_FETCH_PAGE_SIZE) break;
  }
  return all;
}

function shipmentValue(s: FetchedShipment): number {
  return s.lineItems.reduce((sum, li) => sum + Number(li.totalValue), 0);
}

const AT_RISK_READINESS_THRESHOLD = 85;
function isAtRisk(s: FetchedShipment): boolean {
  return (s.readinessScore ?? 100) < AT_RISK_READINESS_THRESHOLD;
}

function isOpenException(e: { status: string }): boolean {
  return e.status !== "RESOLVED" && e.status !== "WAIVED" && e.status !== "Resolved" && e.status !== "Waived";
}

function shipmentUrl(s: { id: string }): string {
  return `/app/shipments/${s.id}`;
}

// ---- deadline lookup ----

interface DeadlineInfo {
  deadlineType: string;
  dueAt: string;
  msRemaining: number;
  breached: boolean;
  estimated: boolean;
  exposureUsd: number | null;
}

const CRITICAL_WINDOW_MS = 24 * 60 * 60 * 1000;

async function fetchOpenDeadlinesByShipmentNumber(accountId: string): Promise<Map<string, DeadlineInfo>> {
  const rows = await db.complianceDeadline.findMany({
    where: { accountId, status: "OPEN", dueAt: { not: null } },
    select: {
      type: true,
      dueAt: true,
      estimated: true,
      penaltyEstimate: true,
      shipment: { select: { shipmentNumber: true } },
    },
    orderBy: { dueAt: "asc" },
  });

  const now = Date.now();
  const map = new Map<string, DeadlineInfo>();
  for (const d of rows) {
    const num = d.shipment?.shipmentNumber;
    if (!num || map.has(num) || !d.dueAt) continue;
    const msRemaining = d.dueAt.getTime() - now;
    map.set(num, {
      deadlineType: d.type,
      dueAt: d.dueAt.toISOString(),
      msRemaining,
      breached: msRemaining <= 0,
      estimated: d.estimated,
      exposureUsd: d.penaltyEstimate != null ? Number(d.penaltyEstimate) : null,
    });
  }
  return map;
}

function isCritical(info: DeadlineInfo | undefined): boolean {
  return info != null && info.msRemaining <= CRITICAL_WINDOW_MS;
}

// ---- tool: list_shipments ----

const listShipmentsSchema = z.object({
  unassigned: z.boolean().optional().describe("Only shipments with no assigned broker."),
  atRisk: z.boolean().optional().describe("Only shipments with a readiness score below 85."),
  critical: z.boolean().optional().describe("Only shipments with an open compliance deadline due within 24 hours."),
  clientId: z.string().optional().describe("Restrict to one client."),
  assignedToUserId: z.string().optional().describe("Restrict to one team member."),
});

const listShipments: AssistantTool = {
  schema: listShipmentsSchema,
  declaration: {
    name: "list_shipments",
    description: "List shipments, optionally filtered by assignment, risk, urgency, client, or assignee.",
    parameters: zodToGeminiSchema(listShipmentsSchema),
  },
  access: { navHref: "/app/shipments" },
  execute: async (ctx, rawArgs) => {
    const parsed = listShipmentsSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const args = parsed.data;

    const shipments = await fetchAllShipments();
    const deadlines = args.critical ? await fetchOpenDeadlinesByShipmentNumber(ctx.accountId) : null;

    const filtered = shipments.filter((s) => {
      if (args.unassigned && s.assignedBrokerId) return false;
      if (args.atRisk && !isAtRisk(s)) return false;
      if (args.critical && !isCritical(deadlines?.get(s.shipmentNumber))) return false;
      if (args.clientId && s.clientId !== args.clientId) return false;
      if (args.assignedToUserId && s.assignedBrokerId !== args.assignedToUserId) return false;
      return true;
    });

    return {
      count: filtered.length,
      shipments: filtered.map((s) => ({
        shipmentNumber: s.shipmentNumber,
        importerName: s.importerName,
        status: s.status,
        healthStatus: s.healthStatus,
        readinessScore: s.readinessScore,
        value: shipmentValue(s),
        assignedBroker: s.assignedBroker
          ? [s.assignedBroker.firstName, s.assignedBroker.lastName].filter(Boolean).join(" ") || null
          : null,
        client: s.client?.name ?? null,
        estimatedArrival: s.estimatedArrival,
        openExceptionCount: s.exceptionItems.filter(isOpenException).length,
        deadline: args.critical ? (deadlines?.get(s.shipmentNumber) ?? null) : undefined,
        url: shipmentUrl(s),
      })),
    };
  },
};

// ---- tool: get_value_at_risk ----

const getValueAtRiskSchema = z.object({});

const getValueAtRisk: AssistantTool = {
  schema: getValueAtRiskSchema,
  declaration: {
    name: "get_value_at_risk",
    description: "Total declared value across shipments currently at risk (readiness score below 85).",
    parameters: zodToGeminiSchema(getValueAtRiskSchema),
  },
  access: { navHref: "/app/shipments" },
  execute: async () => {
    const shipments = await fetchAllShipments();
    const atRisk = shipments.filter(isAtRisk);
    return {
      shipmentCount: atRisk.length,
      totalValueAtRisk: atRisk.reduce((sum, s) => sum + shipmentValue(s), 0),
      shipments: atRisk.map((s) => ({
        shipmentNumber: s.shipmentNumber,
        importerName: s.importerName,
        status: s.status,
        assignedBroker: s.assignedBroker
          ? [s.assignedBroker.firstName, s.assignedBroker.lastName].filter(Boolean).join(" ") || null
          : null,
        readinessScore: s.readinessScore,
        value: shipmentValue(s),
        url: shipmentUrl(s),
      })),
    };
  },
};

// ---- tool: get_team_members ----

const getTeamMembersSchema = z.object({});

const getTeamMembers: AssistantTool = {
  schema: getTeamMembersSchema,
  declaration: {
    name: "get_team_members",
    description: "List active members of the current account (name, email, userId).",
    parameters: zodToGeminiSchema(getTeamMembersSchema),
  },
  execute: async (ctx) => {
    const members = await getActiveTeamMembers(ctx.accountId);
    return {
      count: members.length,
      members: members.map((m) => ({
        name: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email,
        email: m.email,
        userId: m.userId,
      })),
    };
  },
};

// ---- tool: create_shipment ----

const createShipmentSchema = z.object({
  importerName: z.string().describe("Importer of record. Only required field."),
  clientId: z.string().optional(),
  poReference: z.string().optional(),
  entryType: z.string().optional(),
  incoterm: z.string().optional(),
  portOfEntry: z.string().optional(),
  carrierName: z.string().optional(),
  countryOfExport: z.string().optional(),
  estimatedArrival: z.string().optional().describe("ISO 8601 date."),
});

const createShipment: AssistantTool = {
  schema: createShipmentSchema,
  declaration: {
    name: "create_shipment",
    description: "Create a new shipment. Only call after explicit confirmation.",
    parameters: zodToGeminiSchema(createShipmentSchema),
  },
  access: { navHref: "/app/shipments" },
  execute: async (_ctx, rawArgs) => {
    const parsed = createShipmentSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const shipmentsPOST = (await getShipmentsRoute()).POST;
    const res = await shipmentsPOST(
      new Request("http://internal.local/api/shipments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-qubere-source": "CHAT" },
        body: JSON.stringify(parsed.data),
      })
    );
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? "Failed to create shipment" };
    return {
      success: true,
      shipmentId: data.shipment.id,
      shipmentNumber: data.shipment.shipmentNumber,
      url: `/app/shipments/${data.shipment.id}`,
    };
  },
};

// ---- tool: search_products ----

const searchProductsSchema = z.object({
  query: z.string().optional().describe("Free-text query matched against productName, sku, or description."),
  status: z.string().optional().describe("Filter by product status e.g. ACTIVE."),
});

const searchProducts: AssistantTool = {
  schema: searchProductsSchema,
  declaration: {
    name: "search_products",
    description: "Search products by name, SKU, description, or status.",
    parameters: zodToGeminiSchema(searchProductsSchema),
  },
  access: { navHref: "/app/products" },
  execute: async (_ctx, rawArgs) => {
    const parsed = searchProductsSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { query, status } = parsed.data;

    const productsGET = (await getProductsRoute()).GET;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);

    const res = await productsGET(
      new Request(`http://internal.local/api/products?${params.toString()}`)
    );
    if (!res.ok) return { error: "Failed to fetch products" };
    const data = (await res.json()) as { products: { id: string; productName: string; sku: string | null; status: string }[]; total: number };
    return {
      total: data.total,
      products: (data.products ?? []).map((p) => ({
        id: p.id,
        name: p.productName,
        sku: p.sku,
        status: p.status,
        url: `/app/products/${p.id}`,
      })),
    };
  },
};

// ---- tool: search_parties ----

const searchPartiesSchema = z.object({
  query: z.string().optional().describe("Search query matched against legal name, party code, or tax identifier."),
  role: z.string().optional().describe("Role filter e.g. SUPPLIER, SELLER, IMPORTER."),
});

const searchParties: AssistantTool = {
  schema: searchPartiesSchema,
  declaration: {
    name: "search_parties",
    description: "Search trade parties by name, code, or role.",
    parameters: zodToGeminiSchema(searchPartiesSchema),
  },
  access: { navHref: "/app/parties" },
  execute: async (_ctx, rawArgs) => {
    const parsed = searchPartiesSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { query, role } = parsed.data;

    const partiesGET = (await getPartiesRoute()).GET;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (role) params.set("role", role);

    const res = await partiesGET(
      new Request(`http://internal.local/api/parties?${params.toString()}`)
    );
    if (!res.ok) return { error: "Failed to fetch parties" };
    const data = (await res.json()) as { parties: { id: string; legalName: string; partyCode: string | null; roles: string[]; status: string }[]; total: number };
    return {
      total: data.total,
      parties: (data.parties ?? []).map((p) => ({
        id: p.id,
        name: p.legalName,
        code: p.partyCode,
        roles: p.roles,
        status: p.status,
        url: `/app/parties/${p.id}`,
      })),
    };
  },
};

// ---- tool: search_documents ----

const searchDocumentsSchema = z.object({
  query: z.string().optional().describe("Search query matched against file name."),
  docType: z.string().optional().describe("Document type filter e.g. COMMERCIAL_INVOICE, PACKING_LIST."),
  shipmentId: z.string().optional().describe("Restrict search to a single shipment UUID."),
});

const searchDocuments: AssistantTool = {
  schema: searchDocumentsSchema,
  declaration: {
    name: "search_documents",
    description: "Search uploaded compliance documents by file name, docType, or shipmentId.",
    parameters: zodToGeminiSchema(searchDocumentsSchema),
  },
  access: { navHref: "/app/documents" },
  execute: async (_ctx, rawArgs) => {
    const parsed = searchDocumentsSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { query, docType, shipmentId } = parsed.data;

    const documentsGET = (await getDocumentsRoute()).GET;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (docType) params.set("docType", docType);
    if (shipmentId) params.set("shipmentId", shipmentId);

    const res = await documentsGET(
      new Request(`http://internal.local/api/documents?${params.toString()}`)
    );
    if (!res.ok) return { error: "Failed to fetch documents" };
    const data = (await res.json()) as { documents: { id: string; fileName: string; docType: string | null; status: string; shipment: { shipmentNumber: string } | null }[]; total: number };
    return {
      total: data.total,
      documents: (data.documents ?? []).map((d) => ({
        id: d.id,
        fileName: d.fileName,
        docType: d.docType,
        status: d.status,
        shipmentNumber: d.shipment?.shipmentNumber ?? null,
      })),
    };
  },
};

// ---- tool: generate_reasonable_care_record ----

const generateReasonableCareRecordSchema = z.object({
  shipmentId: z.string().describe("Shipment UUID."),
});

const generateReasonableCareRecord: AssistantTool = {
  schema: generateReasonableCareRecordSchema,
  declaration: {
    name: "generate_reasonable_care_record",
    description: "Generate a Reasonable Care audit checklist and defense package for a shipment.",
    parameters: zodToGeminiSchema(generateReasonableCareRecordSchema),
  },
  access: { permission: "documents.read" },
  execute: async (ctx, rawArgs) => {
    const parsed = generateReasonableCareRecordSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { shipmentId } = parsed.data;

    const pkgRoute = await import("@/app/api/audit/package/[shipmentId]/route");
    const res = await pkgRoute.GET(
      new Request(`http://internal.local/api/audit/package/${shipmentId}`),
      { params: Promise.resolve({ shipmentId }) }
    );
    if (!res.ok) return { error: "Shipment or audit package not found" };
    return res.json();
  },
};

// ---- tool: export_compliance_record ----

const exportComplianceRecordSchema = z.object({
  shipmentId: z.string().describe("Shipment UUID."),
});

const exportComplianceRecord: AssistantTool = {
  schema: exportComplianceRecordSchema,
  declaration: {
    name: "export_compliance_record",
    description: "Generate a signed ZIP archive export containing all compliance artifacts for a shipment.",
    parameters: zodToGeminiSchema(exportComplianceRecordSchema),
  },
  access: { navHref: "/app/documents" },
  execute: async (ctx, rawArgs) => {
    const parsed = exportComplianceRecordSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { shipmentId } = parsed.data;

    const exportRoute = await import("@/app/api/audit/export/route");
    const res = await exportRoute.POST(
      new Request("http://internal.local/api/audit/export", {
        method: "POST",
        headers: { "content-type": "application/json", "x-qubere-source": "CHAT" },
        body: JSON.stringify({ shipmentId }),
      })
    );
    if (!res.ok) return { error: "Failed to generate export archive" };
    return res.json();
  },
};

// ---- tool: get_shipment ----

const getShipmentSchema = z.object({
  shipmentId: z.string().describe("Shipment UUID or shipment number."),
});

const getShipment: AssistantTool = {
  schema: getShipmentSchema,
  declaration: {
    name: "get_shipment",
    description: "Fetch full details for one shipment by UUID or shipment number.",
    parameters: zodToGeminiSchema(getShipmentSchema),
  },
  access: { navHref: "/app/shipments" },
  execute: async (ctx, rawArgs) => {
    const parsed = getShipmentSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    let { shipmentId } = parsed.data;

    if (!shipmentId.includes("-")) {
      const match = await db.shipment.findFirst({
        where: { accountId: ctx.accountId, shipmentNumber: shipmentId },
        select: { id: true },
      });
      if (match) shipmentId = match.id;
    }

    const shipmentDetailGET = (await getShipmentDetailRoute()).GET;
    const res = await shipmentDetailGET(
      new Request(`http://internal.local/api/shipments/${shipmentId}`),
      { params: Promise.resolve({ id: shipmentId }) }
    );
    if (!res.ok) return { error: "Shipment not found" };
    return res.json();
  },
};

// ---- tool: list_exceptions ----

const listExceptionsSchema = z.object({
  shipmentId: z.string().optional().describe("Optional shipment UUID filter."),
});

const listExceptions: AssistantTool = {
  schema: listExceptionsSchema,
  declaration: {
    name: "list_exceptions",
    description: "List unresolved compliance exceptions for the account or for a specific shipment.",
    parameters: zodToGeminiSchema(listExceptionsSchema),
  },
  access: { navHref: "/app/exceptions" },
  execute: async (ctx, rawArgs) => {
    const parsed = listExceptionsSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { shipmentId } = parsed.data;

    const { exceptions: items } = await ExceptionService.listExceptions(ctx.accountId, ctx.userId, {
      ...(shipmentId && { shipmentId }),
      status: "OPEN",
    });
    return {
      count: items.length,
      exceptions: items.map((e) => ({
        id: e.id,
        category: e.category,
        title: e.description,
        severity: e.severity,
        status: e.status,
        shipmentNumber: e.shipment?.shipmentNumber ?? null,
        url: `/app/exceptions/${e.id}`,
      })),
    };
  },
};

// ---- tool: get_document ----

const getDocumentSchema = z.object({
  documentId: z.string().describe("Document UUID."),
});

const getDocument: AssistantTool = {
  schema: getDocumentSchema,
  declaration: {
    name: "get_document",
    description: "Fetch metadata and extracted fields for a document.",
    parameters: zodToGeminiSchema(getDocumentSchema),
  },
  access: { navHref: "/app/documents" },
  execute: async (_ctx, rawArgs) => {
    const parsed = getDocumentSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { documentId } = parsed.data;

    const extractionsGET = (await getDocumentExtractionsRoute()).GET;
    const res = await extractionsGET(
      new Request(`http://internal.local/api/documents/${documentId}/extractions`),
      { params: Promise.resolve({ id: documentId }) }
    );
    if (!res.ok) return { error: "Document not found" };
    return res.json();
  },
};

// ---- tool: list_decisions ----

const listDecisionsSchema = z.object({
  shipmentId: z.string().optional().describe("Optional shipment UUID filter."),
});

const listDecisions: AssistantTool = {
  schema: listDecisionsSchema,
  declaration: {
    name: "list_decisions",
    description: "List pending AI-proposed decisions awaiting human review.",
    parameters: zodToGeminiSchema(listDecisionsSchema),
  },
  access: { navHref: "/app/decisions" },
  execute: async (_ctx, rawArgs) => {
    const parsed = listDecisionsSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { shipmentId } = parsed.data;

    const decisionsGET = (await getDecisionsRoute()).GET;
    const params = new URLSearchParams();
    if (shipmentId) params.set("shipmentId", shipmentId);

    const res = await decisionsGET(
      new Request(`http://internal.local/api/decisions?${params.toString()}`)
    );
    if (!res.ok) return { error: "Failed to fetch decisions" };
    return res.json();
  },
};

// ---- tool: get_product ----

const getProductSchema = z.object({
  productId: z.string().describe("Product UUID."),
});

const getProduct: AssistantTool = {
  schema: getProductSchema,
  declaration: {
    name: "get_product",
    description: "Fetch full product master record, classifications, and value history.",
    parameters: zodToGeminiSchema(getProductSchema),
  },
  access: { navHref: "/app/products" },
  execute: async (_ctx, rawArgs) => {
    const parsed = getProductSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { productId } = parsed.data;

    const productDetailGET = (await getProductDetailRoute()).GET;
    const res = await productDetailGET(
      new Request(`http://internal.local/api/products/${productId}`),
      { params: Promise.resolve({ id: productId }) }
    );
    if (!res.ok) return { error: "Product not found" };
    return res.json();
  },
};

// ---- tool: search_hts ----

const searchHtsSchema = z.object({
  query: z.string().describe("HTS code or keyword search query."),
});

const searchHts: AssistantTool = {
  schema: searchHtsSchema,
  declaration: {
    name: "search_hts",
    description: "Search the Harmonized Tariff Schedule (HTSUS) by code or keyword.",
    parameters: zodToGeminiSchema(searchHtsSchema),
  },
  access: { navHref: "/app/hts" },
  execute: async (_ctx, rawArgs) => {
    const parsed = searchHtsSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { query } = parsed.data;

    return HtsSearchService.search({ q: query, limit: 10 });
  },
};

// ---- tool: search_rulings ----

const searchRulingsSchema = z.object({
  query: z.string().describe("Keyword query for CBP rulings."),
});

const searchRulings: AssistantTool = {
  schema: searchRulingsSchema,
  declaration: {
    name: "search_rulings",
    description: "Search CBP CROSS administrative rulings database.",
    parameters: zodToGeminiSchema(searchRulingsSchema),
  },
  access: { navHref: "/app/rulings" },
  execute: async (_ctx, rawArgs) => {
    const parsed = searchRulingsSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { query } = parsed.data;

    return RulingService.searchRulings({ query, limit: 10 });
  },
};

// ---- tool: get_duty_stack ----

const getDutyStackSchema = z.object({
  htsCode: z.string().describe("HTS classification code."),
  countryOfOrigin: z.string().optional().describe("2-letter ISO country code."),
  enteredValueUsd: z.number().optional().describe("Entered value in USD."),
});

const getDutyStack: AssistantTool = {
  schema: getDutyStackSchema,
  declaration: {
    name: "get_duty_stack",
    description: "Calculate full duty stack (Chapter 1-97, Section 301, AD/CVD, MPF, HMF).",
    parameters: zodToGeminiSchema(getDutyStackSchema),
  },
  access: { navHref: "/app/duty-calculator" },
  execute: async (_ctx, rawArgs) => {
    const parsed = getDutyStackSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { htsCode, countryOfOrigin, enteredValueUsd } = parsed.data;

    const line: TariffLineInput = {
      htsCode,
      countryOfOrigin: countryOfOrigin ?? "CN",
      totalValue: enteredValueUsd ?? 10000,
    };
    const htsMap = await loadHtsCodesMap([line]);
    return calculateDutyStack(line, htsMap[htsCode ?? ""] ?? null);
  },
};

// ---- tool: get_regulatory_updates ----

const getRegulatoryUpdatesSchema = z.object({
  limit: z.number().optional().default(5).describe("Max updates to return."),
});

const getRegulatoryUpdates: AssistantTool = {
  schema: getRegulatoryUpdatesSchema,
  declaration: {
    name: "get_regulatory_updates",
    description: "Fetch recent trade regulatory updates and Federal Register notices.",
    parameters: zodToGeminiSchema(getRegulatoryUpdatesSchema),
  },
  access: { navHref: "/app/regulatory" },
  execute: async (_ctx, rawArgs) => {
    const parsed = getRegulatoryUpdatesSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const limit = parsed.data.limit ?? 5;

    const updates = await db.regulatoryUpdate.findMany({
      orderBy: { effectiveDate: "desc" },
      take: limit,
    });
    return { count: updates.length, updates };
  },
};

// ---- tool: get_filing_status ----

const getFilingStatusSchema = z.object({
  shipmentId: z.string().optional().describe("Shipment UUID."),
  filingId: z.string().optional().describe("Filing UUID."),
});

const getFilingStatus: AssistantTool = {
  schema: getFilingStatusSchema,
  declaration: {
    name: "get_filing_status",
    description: "Get CBP Form 7501 filing status and entry summary details.",
    parameters: zodToGeminiSchema(getFilingStatusSchema),
  },
  access: { navHref: "/app/filing" },
  execute: async (ctx, rawArgs) => {
    const parsed = getFilingStatusSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    let { filingId, shipmentId } = parsed.data;

    if (!filingId && shipmentId) {
      const match = await db.customsFiling.findFirst({
        where: { accountId: ctx.accountId, shipmentId },
        select: { id: true },
      });
      if (match) filingId = match.id;
    }
    if (!filingId) return { error: "Filing not found for shipment" };

    const filingGET = (await getFilingRoute()).GET;
    const res = await filingGET(
      new Request(`http://internal.local/api/filing/${filingId}`),
      { params: Promise.resolve({ id: filingId }) }
    );
    if (!res.ok) return { error: "Filing not found" };
    return res.json();
  },
};

// ---- tool: run_impact_analysis ----

const runImpactAnalysisSchema = z.object({});

const runImpactAnalysis: AssistantTool = {
  schema: runImpactAnalysisSchema,
  declaration: {
    name: "run_impact_analysis",
    description: "Run portfolio-wide regulatory impact analysis across shipments and products.",
    parameters: zodToGeminiSchema(runImpactAnalysisSchema),
  },
  access: { permission: "regulatory.review" },
  execute: async (ctx) => {
    return ImpactAnalysisService.analyzePortfolioImpact({ accountId: ctx.accountId });
  },
};

// ---- tool: approve_decision ----

const approveDecisionSchema = z.object({
  decisionId: z.string().describe("AgentDecision UUID."),
  humanNotes: z.string().optional().describe("Optional note explaining the approval."),
});

const approveDecision: AssistantTool = {
  schema: approveDecisionSchema,
  declaration: {
    name: "approve_decision",
    description: "Approve a proposed decision, applying its classification/value to the shipment.",
    parameters: zodToGeminiSchema(approveDecisionSchema),
  },
  access: { permission: "decisions.approve" },
  execute: async (_ctx, rawArgs) => {
    const parsed = approveDecisionSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { decisionId, humanNotes } = parsed.data;

    const decisionsPOST = (await getDecisionsRoute()).POST;
    const res = await decisionsPOST(
      new Request("http://internal.local/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-qubere-source": "CHAT" },
        body: JSON.stringify({ decisionId, action: "APPROVE", humanNotes, source: "CHAT" }),
      })
    );
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? "Failed to approve decision" };
    return { success: true, decision: data.decision, classificationApplied: data.classificationApplied };
  },
};

// ---- tool: reject_decision ----

const rejectDecisionSchema = z.object({
  decisionId: z.string().describe("AgentDecision UUID."),
  humanNotes: z.string().describe("Required reason for rejection."),
});

const rejectDecision: AssistantTool = {
  schema: rejectDecisionSchema,
  declaration: {
    name: "reject_decision",
    description: "Reject a proposed decision, flagging the line for re-review.",
    parameters: zodToGeminiSchema(rejectDecisionSchema),
  },
  access: { permission: "decisions.reject" },
  execute: async (_ctx, rawArgs) => {
    const parsed = rejectDecisionSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { decisionId, humanNotes } = parsed.data;

    const decisionsPOST = (await getDecisionsRoute()).POST;
    const res = await decisionsPOST(
      new Request("http://internal.local/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-qubere-source": "CHAT" },
        body: JSON.stringify({ decisionId, action: "REJECT", humanNotes, source: "CHAT" }),
      })
    );
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? "Failed to reject decision" };
    return { success: true, decision: data.decision };
  },
};

// ---- tool: resolve_exception ----

const resolveExceptionSchema = z.object({
  exceptionId: z.string().describe("ExceptionItem UUID."),
  reasonCode: z.string().describe("Resolution reason code."),
  note: z.string().describe("Explanation note."),
});

const resolveException: AssistantTool = {
  schema: resolveExceptionSchema,
  declaration: {
    name: "resolve_exception",
    description: "Resolve an open exception with a reason code and note.",
    parameters: zodToGeminiSchema(resolveExceptionSchema),
  },
  access: { permission: "exceptions.resolve" },
  execute: async (_ctx, rawArgs) => {
    const parsed = resolveExceptionSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { exceptionId, reasonCode, note } = parsed.data;

    const exceptionDetailGET = (await getExceptionsRoute()).GET;
    const exceptionPATCH = (await getExceptionsRoute()).PATCH;

    const current = await exceptionDetailGET(
      new Request(`http://internal.local/api/exceptions/${exceptionId}`),
      { params: Promise.resolve({ id: exceptionId }) }
    );
    if (!current.ok) return { success: false, error: "Exception not found" };
    const currentData = (await current.json()) as { exception: { version: number } };

    const res = await exceptionPATCH(
      new Request(`http://internal.local/api/exceptions/${exceptionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-qubere-source": "CHAT" },
        body: JSON.stringify({
          status: "RESOLVED",
          resolutionReasonCode: reasonCode,
          resolutionReason: note,
          expectedVersion: currentData.exception.version,
          source: "CHAT",
        }),
      }),
      { params: Promise.resolve({ id: exceptionId }) }
    );
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? "Failed to resolve exception" };
    return { success: true, exception: data.exception };
  },
};

// ---- tool: classify_product ----

const classifyProductSchema = z.object({
  productId: z.string().describe("Product UUID."),
  htsCode: z.string().describe("HTS classification code."),
  overrideReason: z.string().optional().describe("Reason for classification."),
});

const classifyProduct: AssistantTool = {
  schema: classifyProductSchema,
  declaration: {
    name: "classify_product",
    description: "Propose and approve an HTS classification for a product in one step.",
    parameters: zodToGeminiSchema(classifyProductSchema),
  },
  access: { permission: "products.classification.approve" },
  execute: async (_ctx, rawArgs) => {
    const parsed = classifyProductSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { productId, htsCode, overrideReason } = parsed.data;

    const classificationsPOST = (await getClassificationsRoute()).POST;
    const classificationReviewPOST = (await getClassificationReviewRoute()).POST;

    const proposeRes = await classificationsPOST(
      new Request(`http://internal.local/api/products/${productId}/classifications`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qubere-source": "CHAT" },
        body: JSON.stringify({
          jurisdiction: "US",
          nomenclature: "HTS",
          classificationCode: htsCode,
          decisionMethod: "MANUAL",
          source: "CHAT",
        }),
      }),
      { params: Promise.resolve({ id: productId }) }
    );
    const proposeData = await proposeRes.json();
    if (!proposeRes.ok) {
      return { success: false, step: "propose", error: proposeData.error ?? "Failed to propose classification" };
    }
    const classificationId = proposeData.classification.id as string;

    const startReviewRes = await classificationReviewPOST(
      new Request(`http://internal.local/api/products/${productId}/classifications/${classificationId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qubere-source": "CHAT" },
        body: JSON.stringify({ action: "START_REVIEW", source: "CHAT" }),
      }),
      { params: Promise.resolve({ id: productId, classificationId }) }
    );
    const startReviewData = await startReviewRes.json();
    if (!startReviewRes.ok) {
      return { success: false, step: "start_review", error: startReviewData.error ?? "Failed to start review" };
    }

    const approveRes = await classificationReviewPOST(
      new Request(`http://internal.local/api/products/${productId}/classifications/${classificationId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qubere-source": "CHAT" },
        body: JSON.stringify({ action: "APPROVE", reviewNote: overrideReason, source: "CHAT" }),
      }),
      { params: Promise.resolve({ id: productId, classificationId }) }
    );
    const approveData = await approveRes.json();
    if (!approveRes.ok) {
      return { success: false, step: "approve", error: approveData.error ?? "Failed to approve classification" };
    }
    return { success: true, classification: approveData.classification };
  },
};

// ---- tool: get_classification_rationale (Task D-2) ----

const getClassificationRationaleSchema = z.object({
  productId: z.string().describe("Product UUID."),
});

const getClassificationRationale: AssistantTool = {
  schema: getClassificationRationaleSchema,
  declaration: {
    name: "get_classification_rationale",
    description: "Get full GRI classification rationale, evidence items, and ruling citations for a product.",
    parameters: zodToGeminiSchema(getClassificationRationaleSchema),
  },
  access: { permission: "products.read" },
  execute: async (_ctx, rawArgs) => {
    const parsed = getClassificationRationaleSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { productId } = parsed.data;

    const rationaleRoute = await import("@/app/api/products/[id]/classification-rationale/route");
    const res = await rationaleRoute.GET(
      new Request(`http://internal.local/api/products/${productId}/classification-rationale`),
      { params: Promise.resolve({ id: productId }) }
    );
    if (!res.ok) return { error: "Classification rationale not found for product" };
    return res.json();
  },
};

// ---- tool: get_duty_exposure_risks (Task D-3) ----

const getDutyExposureRisksSchema = z.object({
  limit: z.number().optional().default(3).describe("Number of top duty risk items to return."),
});

const getDutyExposureRisks: AssistantTool = {
  schema: getDutyExposureRisksSchema,
  declaration: {
    name: "get_duty_exposure_risks",
    description: "Retrieve top duty exposure risks aggregated across portfolio line items by dollar value.",
    parameters: zodToGeminiSchema(getDutyExposureRisksSchema),
  },
  access: { permission: "analytics.read" },
  execute: async (ctx, rawArgs) => {
    const parsed = getDutyExposureRisksSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const limit = parsed.data.limit ?? 3;

    const lineItems = await db.shipmentLineItem.findMany({
      where: { accountId: ctx.accountId, shipment: { status: { notIn: ["FILED", "ARCHIVED", "CANCELLED"] } } },
      include: { shipment: { select: { shipmentNumber: true, importerName: true } } },
      take: 200,
    });

    const htsMap = await loadHtsCodesMap(lineItems);
    const risks = lineItems.map((li) => {
      const value = Number(li.totalValue ?? 0);
      const hts = li.htsCode ? htsMap[li.htsCode] : null;
      const rate = hts ? Number(hts.generalDutyRate ?? 0.05) : 0.05;
      const estimatedDuty = value * rate;
      return {
        lineItemId: li.id,
        shipmentNumber: li.shipment?.shipmentNumber ?? "Unknown",
        importerName: li.shipment?.importerName ?? "Unknown",
        description: li.description || "Unclassified line item",
        htsCode: li.htsCode ?? "UNCLASSIFIED",
        enteredValue: value,
        dutyRate: rate,
        estimatedDuty,
        riskFactor: !li.htsCode ? "MISSING_CLASSIFICATION" : value > 50000 ? "HIGH_VALUE" : "STANDARD_DUTY",
      };
    });

    risks.sort((a, b) => b.estimatedDuty - a.estimatedDuty);
    const topRisks = risks.slice(0, limit);
    const totalExposure = risks.reduce((sum, r) => sum + r.estimatedDuty, 0);

    return {
      topRisks,
      totalExposure,
      itemCount: risks.length,
    };
  },
};

// ---- tool: validate_shipment_filing (Task D-4) ----

const validateShipmentFilingSchema = z.object({
  shipmentId: z.string().optional().describe("Shipment UUID."),
  filingId: z.string().optional().describe("CustomsFiling UUID."),
});

const validateShipmentFiling: AssistantTool = {
  schema: validateShipmentFilingSchema,
  declaration: {
    name: "validate_shipment_filing",
    description: "Run pre-filing validation on a shipment and return plain-English readiness score and blocker explanations.",
    parameters: zodToGeminiSchema(validateShipmentFilingSchema),
  },
  access: { permission: "filing.validate" },
  execute: async (ctx, rawArgs) => {
    const parsed = validateShipmentFilingSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: parsed.error.message };
    const { shipmentId, filingId } = parsed.data;

    let targetFilingId = filingId;
    if (!targetFilingId && shipmentId) {
      const filing = await db.customsFiling.findFirst({
        where: { shipmentId, accountId: ctx.accountId },
        select: { id: true },
      });
      if (filing) targetFilingId = filing.id;
    }

    if (!targetFilingId) {
      return { error: "No customs filing record found for the specified shipment." };
    }

    const validateRoute = await import("@/app/api/filing/[id]/validate/route");
    const res = await validateRoute.POST(
      new Request(`http://internal.local/api/filing/${targetFilingId}/validate`, { method: "POST" }),
      { params: Promise.resolve({ id: targetFilingId }) }
    );
    if (!res.ok) return { error: "Failed to validate filing readiness" };
    return res.json();
  },
};

export const ASSISTANT_TOOLS: AssistantTool[] = [
  listShipments,
  getValueAtRisk,
  getTeamMembers,
  createShipment,
  searchProducts,
  searchParties,
  searchDocuments,
  generateReasonableCareRecord,
  exportComplianceRecord,
  getShipment,
  listExceptions,
  getDocument,
  listDecisions,
  getProduct,
  searchHts,
  searchRulings,
  getDutyStack,
  getRegulatoryUpdates,
  getFilingStatus,
  runImpactAnalysis,
  approveDecision,
  rejectDecision,
  resolveException,
  classifyProduct,
  getClassificationRationale,
  getDutyExposureRisks,
  validateShipmentFiling,
];

const TOOLS_BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.declaration.name, t]));

export function getToolByName(name: string): AssistantTool | undefined {
  return TOOLS_BY_NAME.get(name);
}

export function availableAssistantTools(ctx: AccountContext): AssistantTool[] {
  return ASSISTANT_TOOLS.filter((tool) => canUseTool(ctx, tool.access));
}
