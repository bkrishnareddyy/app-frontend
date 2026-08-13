const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ParsedPagination {
  limit: number;
  cursor?: string;
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export function parsePagination(query: URLSearchParams): ParsedPagination {
  const rawLimit = query.get("limit");
  const cursor = query.get("cursor") ?? undefined;

  const parsed = rawLimit !== null ? parseInt(rawLimit, 10) : DEFAULT_LIMIT;
  const limit =
    Number.isInteger(parsed) && parsed > 0
      ? Math.min(parsed, MAX_LIMIT)
      : DEFAULT_LIMIT;

  return { limit, cursor };
}

export function buildPage<T>(
  items: T[],
  total: number,
  cursor: string | null
): PagedResponse<T> {
  return {
    items,
    total,
    nextCursor: cursor,
    hasMore: cursor !== null,
  };
}
