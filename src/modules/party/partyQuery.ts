/**
 * Pure, database-free query construction for the party master.
 *
 * Mirrors `productQuery.ts`: the tenant scoping, search, sort and paging
 * behaviour lives here so it can be asserted without a database, and so the
 * one line that matters most — `accountId` written before anything a caller
 * supplied — is somewhere a test can point at.
 */

import {
  type SortSpec,
  type TableQuery,
  buildOrderBy,
  parseTableQuery,
  tableSkip,
} from "@/modules/tables/tableQuery";
import { normalizeIdentifier } from "./partyNormalization";

export const PARTY_PAGE_SIZE_DEFAULT = 25;
export const PARTY_PAGE_SIZE_MAX = 100;

export const PARTY_SORT_COLUMNS = [
  "internalPartyCode",
  "status",
  "reviewStatus",
  "createdAt",
  "updatedAt",
] as const;

export type PartySortColumn = (typeof PARTY_SORT_COLUMNS)[number];

const PARTY_SORT: SortSpec<PartySortColumn> = {
  columns: PARTY_SORT_COLUMNS,
  fallback: "updatedAt",
  fallbackDirection: "desc",
};

export interface PartyQuery extends TableQuery<PartySortColumn> {
  status: string | null;
  reviewStatus: string | null;
  /** Restricts to parties currently holding this role. */
  roleType: string | null;
  /** Restricts to parties with at least one open revalidation flag. */
  needsRevalidation: boolean;
}

function trimmed(raw: string | null): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

export function parsePartyQuery(params: URLSearchParams): PartyQuery {
  return {
    ...parseTableQuery(params, PARTY_SORT, {
      searchParam: "q",
      pageSizeDefault: PARTY_PAGE_SIZE_DEFAULT,
      pageSizeMax: PARTY_PAGE_SIZE_MAX,
    }),
    status: trimmed(params.get("status")),
    reviewStatus: trimmed(params.get("reviewStatus")),
    roleType: trimmed(params.get("roleType")),
    needsRevalidation: params.get("needsRevalidation") === "true",
  };
}

type Insensitive = { contains: string; mode: "insensitive" };

/**
 * The shape handed to Prisma. Typed structurally rather than with
 * `Prisma.PartyWhereInput` so this module stays testable without a generated
 * client, and so an accidental widening of the type is visible in the diff.
 */
export interface PartyWhere {
  accountId: string;
  deletedAt: null;
  status?: string;
  reviewStatus?: string;
  roles?: { some: { roleType: string; status: string } };
  revalidationFlags?: { some: { status: string } };
  OR?: PartySearchClause[];
}

type PartySearchClause =
  | { internalPartyCode: Insensitive }
  | { names: { some: { rawName: Insensitive; status: string } } }
  | { identifiers: { some: { normalizedValue: { contains: string }; status: string } } };

/**
 * `accountId` is written first and never sourced from user input, so no query
 * parameter can widen the result set beyond the caller's tenant. Every filter
 * below narrows; none of them can replace the account.
 *
 * Search runs across the fields a broker actually types into a party search:
 * the internal code, any name a party is known by, and any identifier in any
 * scheme. The identifier clause searches the normalized column, so "abc-123"
 * finds "ABC123" — the ordinary case of someone typing a reference the way it
 * is printed rather than the way it is stored.
 */
export function buildPartyWhere(accountId: string, query: PartyQuery): PartyWhere {
  const where: PartyWhere = { accountId, deletedAt: null };

  if (query.status) where.status = query.status;
  if (query.reviewStatus) where.reviewStatus = query.reviewStatus;

  if (query.roleType) {
    where.roles = { some: { roleType: query.roleType, status: "ACTIVE" } };
  }

  if (query.needsRevalidation) {
    where.revalidationFlags = { some: { status: "OPEN" } };
  }

  if (query.search) {
    const contains: Insensitive = { contains: query.search, mode: "insensitive" };
    const clauses: PartySearchClause[] = [
      { internalPartyCode: contains },
      { names: { some: { rawName: contains, status: "ACTIVE" } } },
    ];

    const identifier = normalizeIdentifier(query.search);
    if (identifier !== "") {
      clauses.push({ identifiers: { some: { normalizedValue: { contains: identifier }, status: "ACTIVE" } } });
    }

    where.OR = clauses;
  }

  return where;
}

export function buildPartyOrderBy(query: PartyQuery) {
  return buildOrderBy(query);
}

export function partySkip(query: PartyQuery): number {
  return tableSkip(query);
}
