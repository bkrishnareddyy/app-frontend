/**
 * Pure, database-free query construction for the shipment console.
 *
 * Kept separate from the page so the tenant scoping, search, sort and paging
 * behaviour can be asserted without a database.
 */

import {
  type SortSpec,
  type TableQuery,
  buildOrderBy,
  parseTableQuery,
  tableSkip,
} from "@/modules/tables/tableQuery";

export const SHIPMENT_LIST_LIMIT = 200;
export const SHIPMENT_PAGE_SIZE_DEFAULT = 25;
export const SHIPMENT_PAGE_SIZE_MAX = 100;

export const SHIPMENT_SORT_COLUMNS = [
  "shipmentNumber",
  "importerName",
  "portOfEntry",
  "status",
  "readinessScore",
  "createdAt",
  "updatedAt",
] as const;

export type ShipmentSortColumn = (typeof SHIPMENT_SORT_COLUMNS)[number];

const SHIPMENT_SORT: SortSpec<ShipmentSortColumn> = {
  columns: SHIPMENT_SORT_COLUMNS,
  fallback: "createdAt",
  fallbackDirection: "desc",
};

export interface ShipmentQuery extends TableQuery<ShipmentSortColumn> {
  status: string | null;
  health: string | null;
  /** A client id, or `UNASSIGNED` for shipments that carry no client. */
  client: string | null;
}

/** Sentinel for "no client", which is a real filter and not the absence of one. */
export const UNASSIGNED_CLIENT = "UNASSIGNED";

function trimmed(raw: string | null): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

/** Whitespace-only input is not a search. */
export function parseShipmentQuery(params: URLSearchParams): ShipmentQuery {
  return {
    ...parseTableQuery(params, SHIPMENT_SORT, {
      searchParam: "q",
      pageSizeDefault: SHIPMENT_PAGE_SIZE_DEFAULT,
      pageSizeMax: SHIPMENT_PAGE_SIZE_MAX,
    }),
    status: trimmed(params.get("status")),
    health: trimmed(params.get("health")),
    client: trimmed(params.get("client")),
  };
}

type Insensitive = { contains: string; mode: "insensitive" };

export interface ShipmentWhere {
  accountId: string;
  deletedAt: null;
  status?: string;
  healthStatus?: string;
  clientId?: string | null;
  OR?: Array<Record<string, Insensitive>>;
}

/**
 * `accountId` is written first and never sourced from user input, so no query
 * parameter can widen the result set beyond the caller's tenant.
 */
export function buildShipmentWhere(accountId: string, query: ShipmentQuery): ShipmentWhere {
  const where: ShipmentWhere = { accountId, deletedAt: null };

  if (query.status) where.status = query.status;
  if (query.health) where.healthStatus = query.health;
  if (query.client) {
    where.clientId = query.client === UNASSIGNED_CLIENT ? null : query.client;
  }

  if (query.search) {
    const contains: Insensitive = { contains: query.search, mode: "insensitive" };
    where.OR = [
      { shipmentNumber: contains },
      { importerName: contains },
      { poReference: contains },
      { portOfEntry: contains },
    ];
  }

  return where;
}

export function buildShipmentOrderBy(query: ShipmentQuery) {
  return buildOrderBy(query);
}

export function shipmentSkip(query: ShipmentQuery): number {
  return tableSkip(query);
}
