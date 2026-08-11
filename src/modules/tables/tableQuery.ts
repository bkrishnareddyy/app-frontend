/**
 * Pure, database-free table state: search, sort, and pagination.
 *
 * Sort columns are allowlisted per table. A sort key is a Prisma `orderBy`
 * field name, so accepting one straight from the query string would let a
 * caller order by — and therefore probe — any column on the model.
 */

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

export type SortDirection = "asc" | "desc";

export interface SortSpec<TColumn extends string> {
  columns: readonly TColumn[];
  fallback: TColumn;
  fallbackDirection?: SortDirection;
}

export interface TableQuery<TColumn extends string> {
  search: string | null;
  sort: TColumn;
  direction: SortDirection;
  page: number;
  pageSize: number;
}

export interface ParseTableOptions {
  /** Query-string key holding the search term. Consoles differ; `q` is common. */
  searchParam?: string;
  pageSizeDefault?: number;
  pageSizeMax?: number;
}

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

export function parseTableQuery<TColumn extends string>(
  params: URLSearchParams,
  spec: SortSpec<TColumn>,
  options: ParseTableOptions = {}
): TableQuery<TColumn> {
  const {
    searchParam = "q",
    pageSizeDefault = PAGE_SIZE_DEFAULT,
    pageSizeMax = PAGE_SIZE_MAX,
  } = options;

  const requestedSort = params.get("sort");
  const sort = spec.columns.find((column) => column === requestedSort) ?? spec.fallback;

  const requestedDirection = params.get("dir");
  const direction: SortDirection =
    requestedDirection === "asc" || requestedDirection === "desc"
      ? requestedDirection
      : (spec.fallbackDirection ?? "desc");

  return {
    search: trimmed(params.get(searchParam)),
    sort,
    direction,
    page: positiveInt(params.get("page"), 1, Number.MAX_SAFE_INTEGER),
    pageSize: positiveInt(params.get("pageSize"), pageSizeDefault, pageSizeMax),
  };
}

export type OrderBy = Record<string, unknown>;

/**
 * A dotted column addresses a relation, so `shipment.shipmentNumber` becomes
 * `{ shipment: { shipmentNumber: "asc" } }`.
 */
export function buildOrderBy<TColumn extends string>(query: TableQuery<TColumn>): OrderBy {
  const segments = query.sort.split(".");
  return segments.reduceRight<unknown>(
    (value, segment) => ({ [segment]: value }),
    query.direction
  ) as OrderBy;
}

export function tableSkip<TColumn extends string>(query: TableQuery<TColumn>): number {
  return (query.page - 1) * query.pageSize;
}

/** A page count of 0 rows is 1 empty page, not 0 pages the UI cannot render. */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize < 1) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export interface PageWindow {
  /** Total pages, at least 1 so the footer always has something to render. */
  pages: number;
  /** The requested page, clamped into range. */
  page: number;
  /** 1-based row numbers for the "x-y of n" summary; 0 when nothing matched. */
  firstRow: number;
  lastRow: number;
  /** Bounds for `Array.prototype.slice`. */
  start: number;
  end: number;
}

/**
 * The slice of a client-filtered list to show, with its row numbers.
 *
 * The requested page is clamped rather than trusted: narrowing a filter can leave
 * it past the end of the new result, and correcting that in an effect afterwards
 * renders one empty page first. Clamping here means an in-range page over a
 * non-empty list always yields at least one row, so an empty table means nothing
 * matched and never a paging fault.
 *
 * Row numbers come from the real total, so a partial last page reports the rows it
 * actually holds instead of repeating the page size.
 */
export function pageWindow(total: number, pageSize: number, requestedPage: number): PageWindow {
  const pages = pageCount(total, pageSize);
  const page = Math.min(Math.max(requestedPage, 1), pages);
  const start = (page - 1) * pageSize;
  return {
    pages,
    page,
    firstRow: total === 0 ? 0 : start + 1,
    lastRow: Math.min(page * pageSize, total),
    start,
    end: page * pageSize,
  };
}

/** Clicking the active column reverses it; any other column starts descending. */
export function nextDirection<TColumn extends string>(
  query: TableQuery<TColumn>,
  column: TColumn,
  fallback: SortDirection = "desc"
): SortDirection {
  if (query.sort !== column) return fallback;
  return query.direction === "asc" ? "desc" : "asc";
}

/**
 * Deep links must carry the whole view, so every existing parameter survives
 * unless the patch replaces it. A null value drops the parameter entirely.
 */
export function tableHref(
  basePath: string,
  current: URLSearchParams,
  patch: Record<string, string | number | null>
): string {
  const next = new URLSearchParams(current);

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }

  const queryString = next.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}

/**
 * Changing what is shown must return to the first page: page 4 of a filtered
 * set is usually empty, and an empty page reads as "no records".
 */
export function resetPage(
  patch: Record<string, string | number | null>
): Record<string, string | number | null> {
  return { ...patch, page: null };
}

export interface ColumnSpec<TId extends string> {
  id: TId;
  label: string;
  /** Columns off by default still appear in the chooser. */
  optional?: boolean;
  sortable?: boolean;
}

/**
 * Column choice travels in the URL so a shared link shows the same table.
 * An unrecognised id is dropped, and a selection that hides everything falls
 * back to the defaults rather than rendering a table with no columns.
 */
export function visibleColumns<TId extends string>(
  raw: string | null,
  all: readonly ColumnSpec<TId>[]
): TId[] {
  const defaults = all.filter((column) => !column.optional).map((column) => column.id);
  if (!raw) return defaults;

  const requested = new Set(raw.split(",").map((part) => part.trim()));
  const chosen = all.filter((column) => requested.has(column.id)).map((column) => column.id);

  return chosen.length > 0 ? chosen : defaults;
}

export function serializeColumns<TId extends string>(
  ids: readonly TId[],
  all: readonly ColumnSpec<TId>[]
): string | null {
  const defaults = all.filter((column) => !column.optional).map((column) => column.id);
  const same = ids.length === defaults.length && ids.every((id, i) => id === defaults[i]);
  return same ? null : ids.join(",");
}
