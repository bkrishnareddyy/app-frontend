export const DOCUMENT_PAGE_SIZE_DEFAULT = 25;
export const DOCUMENT_PAGE_SIZE_MAX = 100;

export const DOCUMENT_SORT_COLUMNS = [
  "fileName",
  "docType",
  "shipmentNumber",
  "status",
  "confidence",
  "createdAt",
] as const;
export type DocumentSortColumn = (typeof DOCUMENT_SORT_COLUMNS)[number];
export type SortDirection = "asc" | "desc";

export interface DocumentQuery {
  search: string | null;
  docType: string | null;
  status: string | null;
  /** A client id, or `UNASSIGNED` for documents whose shipment carries no client. */
  clientId: string | null;
  /** A shipment id, or `UNATTACHED` for documents not attached to any shipment. */
  shipmentId: string | null;
  sort: DocumentSortColumn;
  direction: SortDirection;
  page: number;
  pageSize: number;
}

/** Sentinel for "no client", which is a real filter and not the absence of one. */
export const UNASSIGNED_CLIENT = "UNASSIGNED";

/**
 * Sentinel for "detached". Detaching a document nulls its shipmentId but keeps the
 * row and its extraction, so these documents must stay reachable in the console.
 */
export const UNATTACHED_SHIPMENT = "UNATTACHED";

function positiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function trimmed(raw: string | null): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

export function parseDocumentQuery(params: URLSearchParams): DocumentQuery {
  const requestedSort = trimmed(params.get("sort"));
  const sort = DOCUMENT_SORT_COLUMNS.includes(requestedSort as DocumentSortColumn)
    ? (requestedSort as DocumentSortColumn)
    : "createdAt";
  const requestedDirection = trimmed(params.get("dir"))?.toLowerCase();

  return {
    search: trimmed(params.get("search")),
    docType: trimmed(params.get("docType")),
    status: trimmed(params.get("status")),
    clientId: trimmed(params.get("clientId")),
    shipmentId: trimmed(params.get("shipmentId")),
    sort,
    direction:
      requestedDirection === "asc" || requestedDirection === "desc"
        ? requestedDirection
        : sort === "createdAt"
          ? "desc"
          : "asc",
    page: positiveInt(params.get("page"), 1, Number.MAX_SAFE_INTEGER),
    pageSize: positiveInt(params.get("pageSize"), DOCUMENT_PAGE_SIZE_DEFAULT, DOCUMENT_PAGE_SIZE_MAX),
  };
}

export type DocumentOrderBy =
  | { fileName: SortDirection }
  | { docType: SortDirection }
  | { status: SortDirection }
  | { createdAt: SortDirection }
  | { id: SortDirection }
  | { confidence: { sort: SortDirection; nulls: "last" } }
  | { shipment: { shipmentNumber: SortDirection } };

/**
 * A missing confidence is unknown, not low, so it sorts last in both directions
 * rather than crowding the top of a descending sort the way Postgres defaults to.
 * The trailing id keeps paging stable when the sorted column repeats.
 */
export function buildDocumentOrderBy(query: DocumentQuery): DocumentOrderBy[] {
  const dir = query.direction;

  const primary: DocumentOrderBy =
    query.sort === "confidence"
      ? { confidence: { sort: dir, nulls: "last" } }
      : query.sort === "shipmentNumber"
        ? { shipment: { shipmentNumber: dir } }
        : ({ [query.sort]: dir } as DocumentOrderBy);

  return query.sort === "createdAt" ? [primary, { id: "desc" }] : [primary, { createdAt: "desc" }, { id: "desc" }];
}

export interface DocumentWhere {
  accountId: string;
  docType?: string;
  status?: string;
  shipmentId?: string | null;
  shipment?: { clientId: string | null };
  OR?: Array<Record<string, unknown>>;
}

/**
 * accountId is always present so the filter cannot be widened past the caller's tenant
 * by any combination of query parameters.
 */
export function buildDocumentWhere(accountId: string, query: DocumentQuery): DocumentWhere {
  const where: DocumentWhere = { accountId };

  if (query.docType) where.docType = query.docType;
  if (query.status) where.status = query.status;

  if (query.shipmentId) {
    where.shipmentId =
      query.shipmentId === UNATTACHED_SHIPMENT ? null : query.shipmentId;
  }

  // Client lives on the shipment, so the document is filtered through it.
  if (query.clientId) {
    where.shipment = {
      clientId: query.clientId === UNASSIGNED_CLIENT ? null : query.clientId,
    };
  }

  if (query.search) {
    where.OR = [
      { fileName: { contains: query.search, mode: "insensitive" } },
      { docType: { contains: query.search, mode: "insensitive" } },
      { shipment: { shipmentNumber: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  return where;
}

export function documentSkip(query: DocumentQuery): number {
  return (query.page - 1) * query.pageSize;
}
