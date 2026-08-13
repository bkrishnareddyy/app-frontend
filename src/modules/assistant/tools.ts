import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
import type { AccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveTeamMembers } from "@/lib/team";
import { GET as shipmentsGET, POST as shipmentsPOST } from "@/app/api/shipments/route";

/**
 * Every tool wraps a real, already-authorized code path — either the
 * exported route handler for /api/shipments (called in-process, so it
 * resolves the caller's real session/RLS exactly like an HTTP request
 * would) or a direct query mirroring one already run elsewhere in the app
 * (cited per tool below). Nothing here re-implements business logic or
 * invents data the underlying source doesn't have.
 */
export interface AssistantTool {
  declaration: FunctionDeclaration;
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

// Same stopgap as dashboard/page.tsx's SHIPMENT_ROW_CAP = 500: not real
// pagination, just a bound on the worst case until KPIs move server-side.
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

// Matches CommandCenterClient.tsx's Value-at-Risk / "at risk" threshold exactly.
const AT_RISK_READINESS_THRESHOLD = 85;
function isAtRisk(s: FetchedShipment): boolean {
  return (s.readinessScore ?? 100) < AT_RISK_READINESS_THRESHOLD;
}

// Same predicate dashboard/page.tsx uses to count "active" exceptions,
// defensively covering both status-casing variants seen in this codebase.
function isOpenException(e: { status: string }): boolean {
  return e.status !== "RESOLVED" && e.status !== "WAIVED" && e.status !== "Resolved" && e.status !== "Waived";
}

function shipmentUrl(s: { id: string }): string {
  return `/app/shipments/${s.id}`;
}

// ---- deadline lookup (backs the `critical` filter on list_shipments) ----

interface DeadlineInfo {
  deadlineType: string;
  dueAt: string;
  msRemaining: number;
  breached: boolean;
  estimated: boolean;
  exposureUsd: number | null;
}

// A deadline within 24h (or already past) forces "critical" — the exact
// rule src/app/app/actions/page.tsx:149-159 applies as a priority floor.
const CRITICAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Mirrors the ComplianceDeadline query in dashboard/page.tsx (lines ~211-224): one row per shipment, keeping the soonest open deadline. */
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
    atRisk: { type: Type.BOOLEAN, description: "Only shipments with a readiness score below 85 (the same threshold the dashboard's Value at Risk tile uses)." },
    critical: { type: Type.BOOLEAN, description: "Only shipments with an open compliance deadline due within 24 hours, or already overdue." },
    clientId: { type: Type.STRING, description: "Restrict to one client's shipments. Only set this if the user named a specific client and you already have its id from a prior tool result — never guess an id." },
    assignedToUserId: { type: Type.STRING, description: "Restrict to shipments assigned to one specific team member's userId. Look it up via get_team_members first if the user named a person." },
  },
};

const listShipments: AssistantTool = {
  declaration: {
    name: "list_shipments",
    description:
      "List shipments in the current account, optionally filtered by assignment, risk, urgency, client, or assignee. Combine flags to answer compound questions (e.g. critical AND unassigned).",
    parameters: listShipmentsParams,
  },
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
      "Total declared value across shipments currently at risk (readiness score below 85) — the same figure shown on the dashboard's Value at Risk tile.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  execute: async () => {
    const shipments = await fetchAllShipments();
    const atRisk = shipments.filter(isAtRisk);
    const totalValueAtRisk = atRisk.reduce((sum, s) => sum + shipmentValue(s), 0);

    return {
      shipmentCount: atRisk.length,
      totalValueAtRisk,
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
    description: "List active members of the current account (name, email).",
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
    importerName: { type: Type.STRING, description: "Importer of record name. The only required field — everything else must be omitted, not guessed, if the user didn't say it." },
    clientId: { type: Type.STRING, description: "Qubere client record id, only if the user named a specific existing client." },
    poReference: { type: Type.STRING, description: "Purchase order reference." },
    entryType: { type: Type.STRING, description: "CBP entry type." },
    incoterm: { type: Type.STRING },
    portOfEntry: { type: Type.STRING },
    carrierName: { type: Type.STRING },
    countryOfExport: { type: Type.STRING },
    estimatedArrival: { type: Type.STRING, description: "ISO 8601 date, only if the user gave an ETA." },
  },
  required: ["importerName"],
};

const createShipment: AssistantTool = {
  declaration: {
    name: "create_shipment",
    description:
      "Create a new shipment. Only call this after showing the user exactly which fields you're about to submit and getting explicit confirmation. Never invent a value for a field the user didn't state — omit it instead.",
    parameters: createShipmentParams,
  },
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
    return {
      success: true,
      shipmentNumber: data.shipment.shipmentNumber,
      url: shipmentUrl(data.shipment),
    };
  },
};

export const ASSISTANT_TOOLS: AssistantTool[] = [
  listShipments,
  getValueAtRisk,
  getTeamMembers,
  createShipment,
];

const TOOLS_BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.declaration.name, t]));

export function getToolByName(name: string): AssistantTool | undefined {
  return TOOLS_BY_NAME.get(name);
}
