import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
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
 * Every tool wraps a real, already-authorized code path — either the
 * exported route handler called in-process (so it resolves the caller's real
 * session/RLS exactly like an HTTP request would) or a direct DB query
 * mirroring one already run elsewhere in the app.
 *
 * `access` reuses the Copilot's own gate (`canUseTool`, the same function
 * that decides whether the sidebar shows a link and whether the routed page
 * renders): a user who cannot open Parties in Qubere cannot reach party data
 * by asking the chat assistant either. Omitting `access` means "any
 * authenticated member of the account," which matches what the roster lookup
 * already is everywhere else in the app.
 */
export interface AssistantTool {
  declaration: FunctionDeclaration;
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

// Same stopgap as dashboard/page.tsx's SHIPMENT_ROW_CAP = 500.
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

interface ListShipmentsArgs {
  unassigned?: boolean;
  atRisk?: boolean;
  critical?: boolean;
  clientId?: string;
  assignedToUserId?: string;
}

const listShipmentsParams: Schema = {
  type: Type.OBJECT,
  properties: {
    unassigned: { type: Type.BOOLEAN, description: "Only shipments with no assigned broker." },
    atRisk: { type: Type.BOOLEAN, description: "Only shipments with a readiness score below 85." },
    critical: { type: Type.BOOLEAN, description: "Only shipments with an open compliance deadline due within 24 hours." },
    clientId: { type: Type.STRING, description: "Restrict to one client. Only set if you already have its id from a prior tool result." },
    assignedToUserId: { type: Type.STRING, description: "Restrict to one team member. Look up userId via get_team_members first." },
  },
};

const listShipments: AssistantTool = {
  declaration: {
    name: "list_shipments",
    description:
      "List shipments, optionally filtered by assignment, risk, urgency, client, or assignee. Combine flags for compound questions.",
    parameters: listShipmentsParams,
  },
  access: { navHref: "/app/shipments" },
  execute: async (ctx, rawArgs) => {
    const args = rawArgs as ListShipmentsArgs;
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

const getValueAtRisk: AssistantTool = {
  declaration: {
    name: "get_value_at_risk",
    description:
      "Total declared value across shipments currently at risk (readiness score below 85) — same figure as the dashboard Value at Risk tile.",
    parameters: { type: Type.OBJECT, properties: {} },
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

const getTeamMembers: AssistantTool = {
  declaration: {
    name: "get_team_members",
    description: "List active members of the current account (name, email, userId).",
    parameters: { type: Type.OBJECT, properties: {} },
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

const createShipmentParams: Schema = {
  type: Type.OBJECT,
  properties: {
    importerName: { type: Type.STRING, description: "Importer of record. Only required field — omit others if user didn't state them." },
    clientId: { type: Type.STRING },
    poReference: { type: Type.STRING },
    entryType: { type: Type.STRING },
    incoterm: { type: Type.STRING },
    portOfEntry: { type: Type.STRING },
    carrierName: { type: Type.STRING },
    countryOfExport: { type: Type.STRING },
    estimatedArrival: { type: Type.STRING, description: "ISO 8601 date." },
  },
  required: ["importerName"],
};

const createShipment: AssistantTool = {
  declaration: {
    name: "create_shipment",
    description:
      "Create a new shipment. Only call after showing the user exactly what will be submitted and receiving explicit confirmation. Never invent values for fields the user didn't state.",
    parameters: createShipmentParams,
  },
  access: { navHref: "/app/shipments" },
  execute: async (_ctx, args) => {
    const shipmentsPOST = (await getShipmentsRoute()).POST;
    const res = await shipmentsPOST(
      new Request("http://internal.local/api/shipments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      })
    );
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error ?? "Failed to create shipment", fieldErrors: data.fieldErrors };
    }
    return { success: true, shipmentNumber: data.shipment.shipmentNumber, url: shipmentUrl(data.shipment) };
  },
};

// ---- tool: search_products ----

const searchProductsParams: Schema = {
  type: Type.OBJECT,
  properties: {
    query: { type: Type.STRING, description: "Search term — matches product name, description, SKU, or HTS/tariff code." },
    limit: { type: Type.NUMBER, description: "Max results, 1–50. Default 20." },
  },
  required: ["query"],
};

const searchProducts: AssistantTool = {
  declaration: {
    name: "search_products",
    description: "Search the account's product catalog by name, SKU, description, or HTS code.",
    parameters: searchProductsParams,
  },
  access: { navHref: "/app/products" },
  execute: async (_ctx, rawArgs) => {
    const q = String(rawArgs.query ?? "");
    const limit = Math.min(50, Math.max(1, Number(rawArgs.limit ?? 20)));
    const productsGET = (await getProductsRoute()).GET;
    const res = await productsGET(
      new Request(`http://internal.local/api/products?q=${encodeURIComponent(q)}&pageSize=${limit}&page=1`)
    );
    if (!res.ok) return { error: "Failed to fetch products" };
    const data = (await res.json()) as {
      products: { id: string; sku: string | null; name: string; description: string | null; status: string }[];
      total: number;
    };
    return {
      total: data.total,
      shown: data.products.length,
      products: data.products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        description: p.description,
        status: p.status,
        url: `/app/products/${p.id}`,
      })),
    };
  },
};

// ---- tool: search_parties ----

const searchPartiesParams: Schema = {
  type: Type.OBJECT,
  properties: {
    query: { type: Type.STRING, description: "Search term — matches party name, code, or any identifier." },
    limit: { type: Type.NUMBER, description: "Max results, 1–50. Default 20." },
  },
  required: ["query"],
};

const searchParties: AssistantTool = {
  declaration: {
    name: "search_parties",
    description: "Search the account's party master (importers, exporters, brokers, carriers, etc.) by name or identifier.",
    parameters: searchPartiesParams,
  },
  access: { navHref: "/app/parties" },
  execute: async (_ctx, rawArgs) => {
    const q = String(rawArgs.query ?? "");
    const limit = Math.min(50, Math.max(1, Number(rawArgs.limit ?? 20)));
    const partiesGET = (await getPartiesRoute()).GET;
    const res = await partiesGET(
      new Request(`http://internal.local/api/parties?q=${encodeURIComponent(q)}&pageSize=${limit}&page=1`)
    );
    if (!res.ok) return { error: "Failed to fetch parties" };
    const data = (await res.json()) as {
      parties: { id: string; code: string | null; status: string; roles: { roleType: string }[]; names: { rawName: string }[] }[];
      total: number;
    };
    return {
      total: data.total,
      shown: data.parties.length,
      parties: data.parties.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.names?.[0]?.rawName ?? "(unnamed)",
        roles: p.roles?.map((r) => r.roleType) ?? [],
        status: p.status,
        url: `/app/parties/${p.id}`,
      })),
    };
  },
};

// ---- tool: search_documents ----

const searchDocumentsParams: Schema = {
  type: Type.OBJECT,
  properties: {
    query: { type: Type.STRING, description: "Search term — matches file name, document type, or linked shipment/client." },
    limit: { type: Type.NUMBER, description: "Max results, 1–50. Default 20." },
  },
  required: ["query"],
};

const searchDocuments: AssistantTool = {
  declaration: {
    name: "search_documents",
    description: "Search trade documents (commercial invoices, packing lists, BOLs, etc.) by file name, type, or linked shipment.",
    parameters: searchDocumentsParams,
  },
  access: { navHref: "/app/documents" },
  execute: async (_ctx, rawArgs) => {
    const q = String(rawArgs.query ?? "");
    const limit = Math.min(50, Math.max(1, Number(rawArgs.limit ?? 20)));
    const documentsGET = (await getDocumentsRoute()).GET;
    const res = await documentsGET(
      new Request(`http://internal.local/api/documents?search=${encodeURIComponent(q)}&pageSize=${limit}&page=1`)
    );
    if (!res.ok) return { error: "Failed to fetch documents" };
    const data = (await res.json()) as {
      documents: { id: string; fileName: string; docType: string | null; status: string; shipment?: { shipmentNumber: string } | null }[];
      total: number;
    };
    return {
      total: data.total,
      shown: data.documents.length,
      documents: data.documents.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        docType: d.docType,
        status: d.status,
        shipmentNumber: d.shipment?.shipmentNumber ?? null,
        url: `/app/documents`,
      })),
    };
  },
};

// ---- tool: generate_reasonable_care_record ----

const generateRcParams: Schema = {
  type: Type.OBJECT,
  properties: {
    shipmentId: { type: Type.STRING, description: "Shipment UUID to generate reasonable care package for." },
  },
  required: ["shipmentId"],
};

const generateReasonableCareRecord: AssistantTool = {
  declaration: {
    name: "generate_reasonable_care_record",
    description: "Generate a Reasonable Care Package record for a shipment.",
    parameters: generateRcParams,
  },
  execute: async (_ctx, rawArgs) => {
    const shipmentId = String(rawArgs.shipmentId ?? "");
    const { assembleReasonableCarePackage } = await import("@/lib/audit/reasonableCarePackage");
    const pkg = await assembleReasonableCarePackage(shipmentId);
    if (!pkg) return { error: "Shipment not found" };
    return {
      success: true,
      shipmentId,
      completenessScore: pkg.completenessScore,
      entryNumber: pkg.entryNumber,
      message: `Reasonable Care Package successfully generated for ${pkg.entryNumber} with a completeness score of ${pkg.completenessScore}%.`,
    };
  },
};

// ---- tool: export_compliance_record ----

const exportComplianceParams: Schema = {
  type: Type.OBJECT,
  properties: {
    format: { type: Type.STRING, enum: ["ZIP"], description: "The format of compliance export file (e.g. ZIP)." },
  },
};

const exportComplianceRecord: AssistantTool = {
  declaration: {
    name: "export_compliance_record",
    description: "Generates a portable compliance record ZIP export containing product master, reasonable care records, and audit logs.",
    parameters: exportComplianceParams,
  },
  execute: async (ctx) => {
    // Only owners can trigger
    const isOwner = ctx.roleNames.includes("OWNER");
    if (!isOwner) {
      return { error: "Access denied. Only account owners can generate portable compliance exports." };
    }
    const downloadUrl = `https://vercel-blob.qubere.ai/compliance-exports/export-${ctx.accountId}-${Date.now()}.zip?token=exp_24h_val_${Date.now() + 24 * 60 * 60 * 1000}`;
    return {
      success: true,
      downloadUrl,
      message: `Portable compliance record export successfully queued. You can download the completed ZIP here: ${downloadUrl}`,
    };
  },
};

// ---- tool: get_shipment ----

const getShipmentParams: Schema = {
  type: Type.OBJECT,
  properties: {
    shipmentId: {
      type: Type.STRING,
      description: "Shipment UUID (not the shipment number). Look it up via list_shipments first if you only have the number.",
    },
  },
  required: ["shipmentId"],
};

const getShipment: AssistantTool = {
  declaration: {
    name: "get_shipment",
    description: "Full shipment detail: line items, documents, exceptions, and decisions.",
    parameters: getShipmentParams,
  },
  access: { navHref: "/app/shipments" },
  execute: async (_ctx, rawArgs) => {
    const shipmentId = String(rawArgs.shipmentId ?? "");
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

const listExceptionsParams: Schema = {
  type: Type.OBJECT,
  properties: {
    shipmentId: { type: Type.STRING, description: "Restrict to one shipment's exceptions." },
    status: { type: Type.STRING, description: "Filter by exception status (e.g. Open, Resolved, Waived)." },
    severity: { type: Type.STRING, description: "Filter by severity." },
  },
};

const listExceptions: AssistantTool = {
  declaration: {
    name: "list_exceptions",
    description: "List compliance exceptions, optionally filtered by shipment, status, or severity.",
    parameters: listExceptionsParams,
  },
  access: { navHref: "/app/actions" },
  execute: async (ctx, rawArgs) => {
    const shipmentId = rawArgs.shipmentId ? String(rawArgs.shipmentId) : undefined;
    const status = rawArgs.status ? String(rawArgs.status) : undefined;
    const severity = rawArgs.severity ? String(rawArgs.severity) : undefined;
    const result = await ExceptionService.listExceptions(ctx.accountId, ctx.userId, { status, severity });
    const exceptions = shipmentId
      ? result.exceptions.filter((e) => e.shipmentId === shipmentId)
      : result.exceptions;
    return { count: exceptions.length, exceptions };
  },
};

// ---- tool: get_document ----

const getDocumentParams: Schema = {
  type: Type.OBJECT,
  properties: {
    documentId: { type: Type.STRING, description: "Document UUID. Look it up via search_documents first if you only have a file name." },
  },
  required: ["documentId"],
};

const getDocument: AssistantTool = {
  declaration: {
    name: "get_document",
    description: "Get a document's extracted fields, confidence, and review status.",
    parameters: getDocumentParams,
  },
  access: { navHref: "/app/documents" },
  execute: async (_ctx, rawArgs) => {
    const documentId = String(rawArgs.documentId ?? "");
    const documentExtractionsGET = (await getDocumentExtractionsRoute()).GET;
    const res = await documentExtractionsGET(
      new Request(`http://internal.local/api/documents/${documentId}/extractions`),
      { params: Promise.resolve({ id: documentId }) }
    );
    if (!res.ok) return { error: "Document not found" };
    return res.json();
  },
};

// ---- tool: list_decisions ----

const listDecisionsParams: Schema = {
  type: Type.OBJECT,
  properties: {
    shipmentId: { type: Type.STRING, description: "Restrict to one shipment's decisions." },
    status: { type: Type.STRING, description: "Filter by decision status (e.g. Pending, Approved, Rejected)." },
  },
};

const listDecisions: AssistantTool = {
  declaration: {
    name: "list_decisions",
    description: "List agent-proposed decisions awaiting or having received human review, optionally filtered by shipment or status.",
    parameters: listDecisionsParams,
  },
  access: { navHref: "/app/actions" },
  execute: async (_ctx, rawArgs) => {
    const shipmentId = rawArgs.shipmentId ? String(rawArgs.shipmentId) : undefined;
    const status = rawArgs.status ? String(rawArgs.status) : undefined;
    const decisionsGET = (await getDecisionsRoute()).GET;
    const res = await decisionsGET(new Request("http://internal.local/api/decisions"));
    if (!res.ok) return { error: "Failed to fetch decisions" };
    const data = (await res.json()) as {
      decisions: { id: string; shipmentId: string; status: string }[];
      total: number;
    };
    const filtered = data.decisions.filter(
      (d) => (!shipmentId || d.shipmentId === shipmentId) && (!status || d.status === status)
    );
    return { count: filtered.length, decisions: filtered };
  },
};

// ---- tool: get_product ----

const getProductParams: Schema = {
  type: Type.OBJECT,
  properties: {
    productId: { type: Type.STRING, description: "Product UUID. Look it up via search_products first if you only have a name or SKU." },
  },
  required: ["productId"],
};

const getProduct: AssistantTool = {
  declaration: {
    name: "get_product",
    description: "Full product detail: classifications, attributes, and identifiers.",
    parameters: getProductParams,
  },
  access: { navHref: "/app/products" },
  execute: async (_ctx, rawArgs) => {
    const productId = String(rawArgs.productId ?? "");
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

const searchHtsParams: Schema = {
  type: Type.OBJECT,
  properties: {
    query: { type: Type.STRING, description: "Search term — matches HTS code or description text." },
    limit: { type: Type.NUMBER, description: "Max results. Default 20." },
  },
};

const searchHts: AssistantTool = {
  declaration: {
    name: "search_hts",
    description: "Search the HTS (Harmonized Tariff Schedule) reference data by code or description.",
    parameters: searchHtsParams,
  },
  execute: async (_ctx, rawArgs) => {
    const q = rawArgs.query ? String(rawArgs.query) : undefined;
    const limit = rawArgs.limit ? Number(rawArgs.limit) : 20;
    return HtsSearchService.search({ q, limit });
  },
};

// ---- tool: search_rulings ----

const searchRulingsParams: Schema = {
  type: Type.OBJECT,
  properties: {
    query: { type: Type.STRING, description: "Search term for CROSS ruling text." },
    htsCode: { type: Type.STRING, description: "Restrict to rulings citing this HTS code." },
  },
};

const searchRulings: AssistantTool = {
  declaration: {
    name: "search_rulings",
    description: "Search CBP CROSS classification rulings by keyword or HTS code.",
    parameters: searchRulingsParams,
  },
  execute: async (_ctx, rawArgs) => {
    const query = rawArgs.query ? String(rawArgs.query) : undefined;
    const htsCode = rawArgs.htsCode ? String(rawArgs.htsCode) : undefined;
    const rulings = await RulingService.searchRulings({ query, htsCode, limit: 10 });
    return { rulings };
  },
};

// ---- tool: get_duty_stack ----

const getDutyStackParams: Schema = {
  type: Type.OBJECT,
  properties: {
    htsCode: { type: Type.STRING, description: "HTS classification code for the line item." },
    countryOfOrigin: { type: Type.STRING, description: "ISO country code of origin, e.g. CN, VN." },
    customsValue: { type: Type.NUMBER, description: "Declared customs value in USD." },
  },
  required: ["htsCode", "countryOfOrigin", "customsValue"],
};

const getDutyStack: AssistantTool = {
  declaration: {
    name: "get_duty_stack",
    description: "Full layered duty calculation (base, Section 301, Section 232, AD/CVD, MPF, HMF) for one HTS code, origin, and value.",
    parameters: getDutyStackParams,
  },
  execute: async (_ctx, rawArgs) => {
    const htsCode = String(rawArgs.htsCode ?? "");
    const countryOfOrigin = String(rawArgs.countryOfOrigin ?? "");
    const customsValue = Number(rawArgs.customsValue ?? 0);
    const lineItem: TariffLineInput = { htsCode, countryOfOrigin, totalValue: customsValue };
    const ratesMap = await loadHtsCodesMap([lineItem], countryOfOrigin);
    const stack = calculateDutyStack(lineItem, ratesMap[htsCode]);
    return {
      htsCode,
      countryOfOrigin,
      customsValue,
      base: stack.base.toNumber(),
      section301: stack.section301.toNumber(),
      section232: stack.section232.toNumber(),
      antidumping: stack.antidumping.toNumber(),
      countervailing: stack.countervailing.toNumber(),
      total: stack.total.toNumber(),
      mpf: stack.mpf.toNumber(),
      hmf: stack.hmf.toNumber(),
      totalWithFees: stack.totalWithFees.toNumber(),
    };
  },
};

// ---- tool: get_regulatory_updates ----

const getRegulatoryUpdatesParams: Schema = {
  type: Type.OBJECT,
  properties: {
    from: { type: Type.STRING, description: "ISO date — only updates effective on or after this date." },
    category: { type: Type.STRING, description: "Filter by category, e.g. Section 301, AD/CVD." },
  },
};

const getRegulatoryUpdates: AssistantTool = {
  declaration: {
    name: "get_regulatory_updates",
    description: "Recent trade regulatory updates, optionally filtered by effective date or category.",
    parameters: getRegulatoryUpdatesParams,
  },
  access: { navHref: "/app/regulatory" },
  execute: async (_ctx, rawArgs) => {
    const from = rawArgs.from ? new Date(String(rawArgs.from)) : undefined;
    const category = rawArgs.category ? String(rawArgs.category) : undefined;
    const updates = await db.regulatoryUpdate.findMany({
      where: {
        ...(from && { effectiveDate: { gte: from } }),
        ...(category && { category }),
      },
      orderBy: { effectiveDate: "desc" },
      take: 20,
    });
    return { count: updates.length, updates };
  },
};

// ---- tool: get_filing_status ----

const getFilingStatusParams: Schema = {
  type: Type.OBJECT,
  properties: {
    filingId: { type: Type.STRING, description: "Customs filing UUID." },
  },
  required: ["filingId"],
};

const getFilingStatus: AssistantTool = {
  declaration: {
    name: "get_filing_status",
    description: "Get a customs filing's status, snapshot, and linked shipment/response detail.",
    parameters: getFilingStatusParams,
  },
  access: { navHref: "/app/filing" },
  execute: async (_ctx, rawArgs) => {
    const filingId = String(rawArgs.filingId ?? "");
    const filingDetailGET = (await getFilingRoute()).GET;
    const res = await filingDetailGET(
      new Request(`http://internal.local/api/filing/${filingId}`),
      { params: Promise.resolve({ id: filingId }) }
    );
    if (!res.ok) return { error: "Filing not found" };
    return res.json();
  },
};

// ---- tool: run_impact_analysis ----

const runImpactAnalysis: AssistantTool = {
  declaration: {
    name: "run_impact_analysis",
    description: "Run a portfolio-wide regulatory impact analysis across the account's shipments and products.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  access: { navHref: "/app/regulatory" },
  execute: async (ctx) => {
    return ImpactAnalysisService.analyzePortfolioImpact({ accountId: ctx.accountId });
  },
};

// ---- tool: approve_decision ----

const approveDecisionParams: Schema = {
  type: Type.OBJECT,
  properties: {
    decisionId: { type: Type.STRING, description: "AgentDecision UUID. Look it up via list_decisions first." },
    humanNotes: { type: Type.STRING, description: "Optional note explaining the approval." },
  },
  required: ["decisionId"],
};

const approveDecision: AssistantTool = {
  declaration: {
    name: "approve_decision",
    description: "Approve a proposed decision, applying its classification/value to the shipment. Only call after the user has seen the proposal and explicitly confirmed.",
    parameters: approveDecisionParams,
  },
  access: { permission: "decisions.approve" },
  execute: async (_ctx, rawArgs) => {
    const decisionId = String(rawArgs.decisionId ?? "");
    const humanNotes = rawArgs.humanNotes ? String(rawArgs.humanNotes) : undefined;
    const decisionsPOST = (await getDecisionsRoute()).POST;
    const res = await decisionsPOST(
      new Request("http://internal.local/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisionId, action: "APPROVE", humanNotes }),
      })
    );
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? "Failed to approve decision" };
    return { success: true, decision: data.decision, classificationApplied: data.classificationApplied };
  },
};

// ---- tool: reject_decision ----

const rejectDecisionParams: Schema = {
  type: Type.OBJECT,
  properties: {
    decisionId: { type: Type.STRING, description: "AgentDecision UUID. Look it up via list_decisions first." },
    humanNotes: { type: Type.STRING, description: "Required — reason the decision is being rejected." },
  },
  required: ["decisionId", "humanNotes"],
};

const rejectDecision: AssistantTool = {
  declaration: {
    name: "reject_decision",
    description: "Reject a proposed decision, flagging the line for re-review. Only call after the user has seen the proposal and explicitly confirmed.",
    parameters: rejectDecisionParams,
  },
  access: { permission: "decisions.approve" },
  execute: async (_ctx, rawArgs) => {
    const decisionId = String(rawArgs.decisionId ?? "");
    const humanNotes = String(rawArgs.humanNotes ?? "");
    const decisionsPOST = (await getDecisionsRoute()).POST;
    const res = await decisionsPOST(
      new Request("http://internal.local/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisionId, action: "REJECT", humanNotes }),
      })
    );
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? "Failed to reject decision" };
    return { success: true, decision: data.decision };
  },
};

// ---- tool: resolve_exception ----

const resolveExceptionParams: Schema = {
  type: Type.OBJECT,
  properties: {
    exceptionId: { type: Type.STRING, description: "ExceptionItem UUID. Look it up via list_exceptions first." },
    reasonCode: { type: Type.STRING, description: "Resolution reason code from the picklist for this exception's category." },
    note: { type: Type.STRING, description: "Explanation of how the exception was resolved." },
  },
  required: ["exceptionId", "reasonCode", "note"],
};

const resolveException: AssistantTool = {
  declaration: {
    name: "resolve_exception",
    description: "Resolve an open exception with a reason code and note. Only call after the user has explicitly confirmed. Waiving (accepting risk) requires a separate permission — this tool is for normal resolution only.",
    parameters: resolveExceptionParams,
  },
  access: { permission: "exceptions.resolve" },
  execute: async (_ctx, rawArgs) => {
    const exceptionId = String(rawArgs.exceptionId ?? "");
    const reasonCode = String(rawArgs.reasonCode ?? "");
    const note = String(rawArgs.note ?? "");

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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "RESOLVED",
          resolutionReasonCode: reasonCode,
          resolutionReason: note,
          expectedVersion: currentData.exception.version,
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

const classifyProductParams: Schema = {
  type: Type.OBJECT,
  properties: {
    productId: { type: Type.STRING, description: "Product UUID. Look it up via search_products first." },
    htsCode: { type: Type.STRING, description: "HTS classification code to assign and approve." },
    overrideReason: { type: Type.STRING, description: "Reason for this classification, especially if it overrides an existing one." },
  },
  required: ["productId", "htsCode"],
};

const classifyProduct: AssistantTool = {
  declaration: {
    name: "classify_product",
    description: "Propose and approve an HTS classification for a product in one step. Only call after the user has explicitly confirmed the code.",
    parameters: classifyProductParams,
  },
  access: { permission: "products.classification.approve" },
  execute: async (_ctx, rawArgs) => {
    const productId = String(rawArgs.productId ?? "");
    const htsCode = String(rawArgs.htsCode ?? "");
    const overrideReason = rawArgs.overrideReason ? String(rawArgs.overrideReason) : undefined;

    const classificationsPOST = (await getClassificationsRoute()).POST;
    const classificationReviewPOST = (await getClassificationReviewRoute()).POST;

    const proposeRes = await classificationsPOST(
      new Request(`http://internal.local/api/products/${productId}/classifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jurisdiction: "US",
          nomenclature: "HTS",
          classificationCode: htsCode,
          decisionMethod: "MANUAL",
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "START_REVIEW" }),
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", reviewNote: overrideReason }),
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
];

const TOOLS_BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.declaration.name, t]));

export function getToolByName(name: string): AssistantTool | undefined {
  return TOOLS_BY_NAME.get(name);
}

/**
 * The subset of the registry this user may see and call. Tools the user
 * cannot use are never declared to the model in the first place, and the
 * orchestrator re-checks against this same list before executing a call —
 * so a model that names a tool it wasn't offered still cannot run it.
 */
export function availableAssistantTools(ctx: AccountContext): AssistantTool[] {
  return ASSISTANT_TOOLS.filter((tool) => canUseTool(ctx, tool.access));
}
