/**
 * Pure, database-free query construction for the product master.
 *
 * Kept separate from the page and the API route so that the tenant scoping,
 * search, sort and paging behaviour can be asserted without a database — and so
 * that the one line that matters most, `accountId` written before anything a
 * caller supplied, is somewhere a test can point at.
 */

import {
  type SortSpec,
  type TableQuery,
  buildOrderBy,
  parseTableQuery,
  tableSkip,
} from "@/modules/tables/tableQuery";
import { normalizeClassificationCode, normalizeIdentifier } from "./productNormalization";

export const PRODUCT_PAGE_SIZE_DEFAULT = 25;
export const PRODUCT_PAGE_SIZE_MAX = 100;

export const PRODUCT_SORT_COLUMNS = [
  "productName",
  "internalSku",
  "brand",
  "status",
  "reviewStatus",
  "createdAt",
  "updatedAt",
] as const;

export type ProductSortColumn = (typeof PRODUCT_SORT_COLUMNS)[number];

const PRODUCT_SORT: SortSpec<ProductSortColumn> = {
  columns: PRODUCT_SORT_COLUMNS,
  fallback: "updatedAt",
  fallbackDirection: "desc",
};

export interface ProductQuery extends TableQuery<ProductSortColumn> {
  status: string | null;
  reviewStatus: string | null;
  /** Restricts to products holding an approved classification here. */
  jurisdiction: string | null;
  /** Restricts to products with at least one open revalidation flag. */
  needsRevalidation: boolean;
  /** Restricts to products with no approved classification anywhere. */
  unclassified: boolean;
  clientId: string | null;
}

function trimmed(raw: string | null): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

export function parseProductQuery(params: URLSearchParams): ProductQuery {
  return {
    ...parseTableQuery(params, PRODUCT_SORT, {
      searchParam: "q",
      pageSizeDefault: PRODUCT_PAGE_SIZE_DEFAULT,
      pageSizeMax: PRODUCT_PAGE_SIZE_MAX,
    }),
    status: trimmed(params.get("status")),
    reviewStatus: trimmed(params.get("reviewStatus")),
    jurisdiction: trimmed(params.get("jurisdiction"))?.toUpperCase() ?? null,
    needsRevalidation: params.get("needsRevalidation") === "true",
    unclassified: params.get("unclassified") === "true",
    clientId: trimmed(params.get("clientId")),
  };
}

type Insensitive = { contains: string; mode: "insensitive" };

/**
 * The shape handed to Prisma. Typed structurally rather than with
 * `Prisma.ProductWhereInput` so this module stays testable without a generated
 * client, and so an accidental widening of the type is visible in the diff.
 */
export interface ProductWhere {
  accountId: string;
  deletedAt: null;
  status?: string;
  reviewStatus?: string;
  clientId?: string;
  classifications?: {
    some: { jurisdiction?: string; status: string };
    none?: never;
  };
  NOT?: { classifications: { some: { status: string } } };
  revalidationFlags?: { some: { status: string } };
  OR?: ProductSearchClause[];
}

type ProductSearchClause =
  | { productName: Insensitive }
  | { internalSku: Insensitive }
  | { brand: Insensitive }
  | { model: Insensitive }
  | { commercialDescription: Insensitive }
  | { customsDescription: Insensitive }
  | { identifiers: { some: { normalizedValue: { contains: string } } } }
  | { classifications: { some: { normalizedCode: { startsWith: string } } } };

/**
 * `accountId` is written first and never sourced from user input, so no query
 * parameter can widen the result set beyond the caller's tenant. Every filter
 * below narrows; none of them can replace the account.
 *
 * Search runs across the fields a broker actually types into a product search:
 * names, descriptions, any identifier in any scheme, and a tariff code. The
 * identifier and code clauses search the normalized columns, so "abc-123" finds
 * "ABC123" and "8471.30" finds "8471300000" — the ordinary case of someone
 * typing a code the way it is printed rather than the way it is stored.
 */
export function buildProductWhere(accountId: string, query: ProductQuery): ProductWhere {
  const where: ProductWhere = { accountId, deletedAt: null };

  if (query.clientId) where.clientId = query.clientId;
  if (query.status) where.status = query.status;
  if (query.reviewStatus) where.reviewStatus = query.reviewStatus;

  if (query.jurisdiction) {
    // Only APPROVED counts as classified for a jurisdiction. A pending candidate
    // must not make a product appear in a filter that reads as "ready to file".
    where.classifications = { some: { jurisdiction: query.jurisdiction, status: "APPROVED" } };
  }

  if (query.unclassified) {
    where.NOT = { classifications: { some: { status: "APPROVED" } } };
  }

  if (query.needsRevalidation) {
    where.revalidationFlags = { some: { status: "OPEN" } };
  }

  if (query.search) {
    const contains: Insensitive = { contains: query.search, mode: "insensitive" };
    const clauses: ProductSearchClause[] = [
      { productName: contains },
      { internalSku: contains },
      { brand: contains },
      { model: contains },
      { commercialDescription: contains },
      { customsDescription: contains },
    ];

    const identifier = normalizeIdentifier(query.search);
    if (identifier !== "") {
      clauses.push({ identifiers: { some: { normalizedValue: { contains: identifier } } } });
    }

    const digits = normalizeClassificationCode(query.search);
    if (digits.length >= 4) {
      clauses.push({ classifications: { some: { normalizedCode: { startsWith: digits } } } });
    }

    where.OR = clauses;
  }

  return where;
}

export function buildProductOrderBy(query: ProductQuery) {
  return buildOrderBy(query);
}

export function productSkip(query: ProductQuery): number {
  return tableSkip(query);
}
