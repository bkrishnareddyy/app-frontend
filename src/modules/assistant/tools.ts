import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
import type { AccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveTeamMembers } from "@/lib/team";
import { GET as shipmentsGET, POST as shipmentsPOST } from "@/app/api/shipments/route";
import { GET as productsGET } from "@/app/api/products/route";
import { GET as partiesGET } from "@/app/api/parties/route";
import { GET as documentsGET } from "@/app/api/documents/route";
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

export const ASSISTANT_TOOLS: AssistantTool[] = [
  listShipments,
  getValueAtRisk,
  getTeamMembers,
  createShipment,
  searchProducts,
  searchParties,
  searchDocuments,
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
