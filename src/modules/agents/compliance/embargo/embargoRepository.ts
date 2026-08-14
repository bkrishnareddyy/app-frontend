// Country Embargo Screening -- repository layer.
//
// All reference-data (countries / country_by_country_maps / country_groups /
// country_group_maps / compliance_country_groups / cy_ccg_maps /
// commerce_control_list) access is isolated here so matcher/business logic
// never issues raw Prisma calls directly. Batches by design -- callers
// collect unique country values for a shipment up front rather than
// resolving one at a time per check (avoids N+1 queries).
import { db } from "@/lib/db";
import type { Country, CountryByCountryMap, CountryGroupMap, CyCcgMap, CommerceControlList } from "@prisma/client";
import type { AccountEmbargoConfig } from "./types";

const DEFAULT_ACCOUNT_EMBARGO_CONFIG: AccountEmbargoConfig = {
  embargoScreeningEnabled: true,
  privateEmbargoEnabled: false,
  serverScreeningEnabled: true,
  genericExportLdEnabled: false,
  audited: false,
  emailAlertEnabled: false,
  generalAuditLogEnabled: false,
};

/** Resolves the account's embargo screening/audit configuration, defaulting to screening-on/audit-off when no row exists. */
export async function getAccountEmbargoConfig(accountId: string): Promise<AccountEmbargoConfig> {
  const row = await db.accountEmbargoConfig.findUnique({ where: { accountId } });
  if (!row) return DEFAULT_ACCOUNT_EMBARGO_CONFIG;
  return {
    embargoScreeningEnabled: row.embargoScreeningEnabled,
    privateEmbargoEnabled: row.privateEmbargoEnabled,
    serverScreeningEnabled: row.serverScreeningEnabled,
    genericExportLdEnabled: row.genericExportLdEnabled,
    audited: row.audited,
    emailAlertEnabled: row.emailAlertEnabled,
    generalAuditLogEnabled: row.generalAuditLogEnabled,
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolves a set of country identifiers (business codes like "US" or free-text
 * names like "China") to their `countries` rows, in a single batch query.
 * Matches on cyId first (exact business code), falling back to cyName.
 * Unresolvable values are simply absent from the returned map -- callers
 * must treat that as a resolution failure (ERROR), never as CLEAR.
 */
export async function resolveCountries(values: string[]): Promise<Map<string, Country>> {
  const unique = Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const rows = await db.country.findMany({
    where: {
      OR: [
        { cyId: { in: unique, mode: "insensitive" } },
        { cyName: { in: unique, mode: "insensitive" } },
      ],
    },
  });

  const byId = new Map<string, Country>();
  const byName = new Map<string, Country>();
  for (const row of rows) {
    byId.set(normalize(row.cyId), row);
    if (row.cyName) byName.set(normalize(row.cyName), row);
  }

  const result = new Map<string, Country>();
  for (const value of unique) {
    const key = normalize(value);
    const match = byId.get(key) ?? byName.get(key);
    if (match) result.set(value, match);
  }
  return result;
}

export async function resolveCountry(value: string): Promise<Country | null> {
  const map = await resolveCountries([value]);
  return map.get(value) ?? null;
}

/**
 * Batch-fetches direct country-pair rows for the given (fromCountry, toCountry)
 * business-code pairs (e.g. "US" -> "CU"). Keyed on COMPLIANCE_COUNTRY /
 * EMBARGOED_COUNTRY -- see the CountryByCountryMap model note: the real
 * extracted data uses these text codes, not a cycy_from_cy_seq/cycy_to_cy_seq
 * surrogate-key join as the original DDL implied.
 */
export async function getCountryRelationships(
  pairs: Array<{ fromCountry: string; toCountry: string }>
): Promise<Map<string, CountryByCountryMap>> {
  if (pairs.length === 0) return new Map();
  const fromCountries = Array.from(new Set(pairs.map((p) => p.fromCountry.toUpperCase())));
  const toCountries = Array.from(new Set(pairs.map((p) => p.toCountry.toUpperCase())));

  const rows = await db.countryByCountryMap.findMany({
    where: {
      complianceCountry: { in: fromCountries },
      embargoedCountry: { in: toCountries },
    },
  });

  const map = new Map<string, CountryByCountryMap>();
  for (const row of rows) {
    map.set(`${row.complianceCountry}:${row.embargoedCountry}`, row);
  }
  return map;
}

export async function getCountryRelationship(
  fromCountry: string,
  toCountry: string
): Promise<CountryByCountryMap | null> {
  const map = await getCountryRelationships([{ fromCountry, toCountry }]);
  return map.get(`${fromCountry.toUpperCase()}:${toCountry.toUpperCase()}`) ?? null;
}

/**
 * Active (per screeningDate effective/expiration window) country_group_maps
 * rows for a set of countries. Keyed on the country's business code
 * (COUNTRY_ID) -- see the CountryGroupMap model note.
 */
export async function getCountryGroupMemberships(
  countryIds: string[],
  screeningDate: Date
): Promise<CountryGroupMap[]> {
  const codes = Array.from(new Set(countryIds.map((c) => c.toUpperCase())));
  if (codes.length === 0) return [];
  return db.countryGroupMap.findMany({
    where: {
      countryId: { in: codes },
      AND: [
        { OR: [{ cygrmEffectiveDt: null }, { cygrmEffectiveDt: { lte: screeningDate } }] },
        { OR: [{ cygrmExpirationDt: null }, { cygrmExpirationDt: { gte: screeningDate } }] },
      ],
    },
  });
}

/**
 * compliance_country_groups membership (cy_ccg_maps) for a set of compliance
 * countries. Keyed on the country's business code (COUNTRY_ID) -- see the
 * CyCcgMap model note.
 */
export async function getComplianceCountryGroupMemberships(countryIds: string[]): Promise<CyCcgMap[]> {
  const codes = Array.from(new Set(countryIds.map((c) => c.toUpperCase())));
  if (codes.length === 0) return [];
  return db.cyCcgMap.findMany({ where: { countryId: { in: codes } } });
}

/**
 * commerce_control_list entries matching an ECCN (ccl_id), optionally scoped
 * to a country's business code (CCL_COUNTRY) -- see the CommerceControlList
 * model note.
 */
export async function getCommerceControlListEntries(
  eccn: string,
  country?: string
): Promise<CommerceControlList[]> {
  return db.commerceControlList.findMany({
    where: {
      cclId: eccn,
      ...(country !== undefined ? { cclCountry: country.toUpperCase() } : {}),
    },
  });
}
