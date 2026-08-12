/**
 * Controlled vocabulary for the Global Product Master.
 *
 * Everything here is data, not logic: the jurisdictions a classification may be
 * filed under, the nomenclatures each of those recognises, the country codes a
 * country fact may resolve to, and the units an attribute or composition row may
 * be normalized into. It is deliberately a separate module from the normalizers
 * so that widening the vocabulary never means touching parsing rules.
 *
 * Two things this module refuses to do:
 *
 *   - It does not guess. A country name that is not in the alias table stays
 *     unresolved and the raw string is kept, because a wrong ISO code on an
 *     origin claim is a customs misstatement while a missing one is merely
 *     incomplete.
 *   - It does not carry tariff content. There are no duty rates, no chapter
 *     notes, no rules of origin here — only the shape of a code, never its
 *     meaning.
 */

/** ISO 3166-1 alpha-2. The customs jurisdictions are drawn from this set. */
export const ISO_ALPHA2_COUNTRIES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

export type IsoAlpha2 = (typeof ISO_ALPHA2_COUNTRIES)[number];

const COUNTRY_CODE_SET: ReadonlySet<string> = new Set(ISO_ALPHA2_COUNTRIES);

export function isIsoAlpha2(value: string): value is IsoAlpha2 {
  return COUNTRY_CODE_SET.has(value);
}

/**
 * Country names that resolve to a code without ambiguity.
 *
 * Kept small on purpose. Every entry is a name a broker would type for exactly
 * one country; anything a reasonable person could read two ways is left out so
 * it lands as unresolved rather than as a confident mistake. Notably absent:
 * bare "China" is here but "Taiwan, China" is not, "Korea" is not (two Koreas),
 * and no historical names are mapped.
 */
export const COUNTRY_NAME_ALIASES: Readonly<Record<string, IsoAlpha2>> = {
  AFGHANISTAN: "AF",
  ARGENTINA: "AR",
  AUSTRALIA: "AU",
  AUSTRIA: "AT",
  BANGLADESH: "BD",
  BELGIUM: "BE",
  BRAZIL: "BR",
  CAMBODIA: "KH",
  CANADA: "CA",
  CHILE: "CL",
  CHINA: "CN",
  "PEOPLES REPUBLIC OF CHINA": "CN",
  "PEOPLE S REPUBLIC OF CHINA": "CN",
  COLOMBIA: "CO",
  "COSTA RICA": "CR",
  "CZECH REPUBLIC": "CZ",
  CZECHIA: "CZ",
  DENMARK: "DK",
  "DOMINICAN REPUBLIC": "DO",
  EGYPT: "EG",
  FINLAND: "FI",
  FRANCE: "FR",
  GERMANY: "DE",
  GREECE: "GR",
  GUATEMALA: "GT",
  "HONG KONG": "HK",
  HUNGARY: "HU",
  INDIA: "IN",
  INDONESIA: "ID",
  IRELAND: "IE",
  ISRAEL: "IL",
  ITALY: "IT",
  JAPAN: "JP",
  JORDAN: "JO",
  KENYA: "KE",
  MALAYSIA: "MY",
  MEXICO: "MX",
  MOROCCO: "MA",
  NETHERLANDS: "NL",
  "NEW ZEALAND": "NZ",
  NORWAY: "NO",
  PAKISTAN: "PK",
  PERU: "PE",
  PHILIPPINES: "PH",
  POLAND: "PL",
  PORTUGAL: "PT",
  ROMANIA: "RO",
  "SAUDI ARABIA": "SA",
  SINGAPORE: "SG",
  SLOVAKIA: "SK",
  "SOUTH AFRICA": "ZA",
  "SOUTH KOREA": "KR",
  "REPUBLIC OF KOREA": "KR",
  "NORTH KOREA": "KP",
  SPAIN: "ES",
  "SRI LANKA": "LK",
  SWEDEN: "SE",
  SWITZERLAND: "CH",
  TAIWAN: "TW",
  THAILAND: "TH",
  TURKEY: "TR",
  TURKIYE: "TR",
  UKRAINE: "UA",
  "UNITED ARAB EMIRATES": "AE",
  "UNITED KINGDOM": "GB",
  "GREAT BRITAIN": "GB",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  USA: "US",
  URUGUAY: "UY",
  VIETNAM: "VN",
  "VIET NAM": "VN",
};

/**
 * Which nomenclature belongs to which jurisdiction.
 *
 * A jurisdiction is an ISO country code or one of the customs unions below;
 * `EU` is listed because member states file against a shared nomenclature even
 * though the national tariff extends it.
 *
 * The nomenclature is part of the classification's identity. "8471.30" means
 * something different depending on whether it was read as HS6, HTSUS, or CN,
 * and a code without its nomenclature is not a classification.
 */
export const JURISDICTION_NOMENCLATURES: Readonly<Record<string, readonly string[]>> = {
  WORLD: ["HS"],
  US: ["HTSUS", "HS", "SCHEDULE_B"],
  CA: ["CUSTOMS_TARIFF", "HS"],
  MX: ["TIGIE", "HS"],
  EU: ["CN", "TARIC", "HS"],
  GB: ["UK_GLOBAL_TARIFF", "HS"],
  CN: ["CHINA_TARIFF", "HS"],
  JP: ["JAPAN_TARIFF", "HS"],
  IN: ["ITC_HS", "HS"],
  AU: ["AHECC", "HS"],
  BR: ["NCM", "HS"],
};

/** Nomenclatures accepted anywhere, for jurisdictions not enumerated above. */
export const GENERIC_NOMENCLATURES: readonly string[] = ["HS"];

export function knownJurisdictions(): string[] {
  return Object.keys(JURISDICTION_NOMENCLATURES).sort();
}

/**
 * Whether a jurisdiction code is well-formed.
 *
 * A jurisdiction Qubere has no nomenclature table for is still accepted when it
 * is a real country code — a tenant classifying into Vietnam should not be
 * blocked because this file has not been extended. What it may not do is invent
 * a nomenclature, so `nomenclaturesFor` gives such a jurisdiction only "HS".
 */
export function isKnownJurisdiction(jurisdiction: string): boolean {
  return jurisdiction in JURISDICTION_NOMENCLATURES || isIsoAlpha2(jurisdiction);
}

export function nomenclaturesFor(jurisdiction: string): readonly string[] {
  return JURISDICTION_NOMENCLATURES[jurisdiction] ?? GENERIC_NOMENCLATURES;
}

export function isValidNomenclature(jurisdiction: string, nomenclature: string): boolean {
  return nomenclaturesFor(jurisdiction).includes(nomenclature);
}

/**
 * How many digits a nomenclature's codes carry, once punctuation is stripped.
 *
 * This is a well-formedness check on the shape of a code, not a lookup that
 * decides whether the code exists. Qubere does not hold these tariff schedules,
 * so it can say "8471.3.01 is not a shape HTSUS uses" but never "8471.30.0100
 * is the wrong classification for this product".
 */
export const NOMENCLATURE_DIGIT_LENGTHS: Readonly<Record<string, readonly number[]>> = {
  HS: [6],
  HTSUS: [8, 10],
  SCHEDULE_B: [10],
  CN: [8],
  TARIC: [10],
  CUSTOMS_TARIFF: [8, 10],
  TIGIE: [8],
  UK_GLOBAL_TARIFF: [8, 10],
  CHINA_TARIFF: [8, 10, 13],
  JAPAN_TARIFF: [9],
  ITC_HS: [8],
  AHECC: [8],
  NCM: [8],
};

/** Units an attribute or composition may be normalized into, by dimension. */
export const UNIT_DIMENSIONS = ["MASS", "LENGTH", "VOLUME", "AREA", "COUNT", "POWER", "VOLTAGE"] as const;
export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

export interface UnitDefinition {
  /** The canonical symbol this unit normalizes to. */
  canonical: string;
  dimension: UnitDimension;
  /** Multiplier onto the dimension's base unit (kg, m, l, m2, ea, w, v). */
  toBase: number;
  /** Lower-cased spellings that resolve here. */
  aliases: readonly string[];
}

export const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  { canonical: "kg", dimension: "MASS", toBase: 1, aliases: ["kg", "kgs", "kilogram", "kilograms", "kilo", "kilos"] },
  { canonical: "g", dimension: "MASS", toBase: 0.001, aliases: ["g", "gm", "gms", "gram", "grams"] },
  { canonical: "mg", dimension: "MASS", toBase: 0.000001, aliases: ["mg", "milligram", "milligrams"] },
  { canonical: "lb", dimension: "MASS", toBase: 0.45359237, aliases: ["lb", "lbs", "pound", "pounds"] },
  { canonical: "oz", dimension: "MASS", toBase: 0.028349523125, aliases: ["oz", "ounce", "ounces"] },
  { canonical: "t", dimension: "MASS", toBase: 1000, aliases: ["t", "tonne", "tonnes", "mt", "metric ton", "metric tons"] },
  { canonical: "m", dimension: "LENGTH", toBase: 1, aliases: ["m", "meter", "meters", "metre", "metres"] },
  { canonical: "cm", dimension: "LENGTH", toBase: 0.01, aliases: ["cm", "centimeter", "centimeters", "centimetre", "centimetres"] },
  { canonical: "mm", dimension: "LENGTH", toBase: 0.001, aliases: ["mm", "millimeter", "millimeters", "millimetre", "millimetres"] },
  { canonical: "in", dimension: "LENGTH", toBase: 0.0254, aliases: ["in", "inch", "inches", '"'] },
  { canonical: "ft", dimension: "LENGTH", toBase: 0.3048, aliases: ["ft", "foot", "feet"] },
  { canonical: "l", dimension: "VOLUME", toBase: 1, aliases: ["l", "lt", "liter", "liters", "litre", "litres"] },
  { canonical: "ml", dimension: "VOLUME", toBase: 0.001, aliases: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"] },
  { canonical: "m3", dimension: "VOLUME", toBase: 1000, aliases: ["m3", "cbm", "cubic meter", "cubic meters", "cubic metre", "cubic metres"] },
  { canonical: "m2", dimension: "AREA", toBase: 1, aliases: ["m2", "sqm", "square meter", "square meters", "square metre", "square metres"] },
  { canonical: "cm2", dimension: "AREA", toBase: 0.0001, aliases: ["cm2", "square centimeter", "square centimeters"] },
  { canonical: "ea", dimension: "COUNT", toBase: 1, aliases: ["ea", "each", "pc", "pcs", "piece", "pieces", "unit", "units", "no", "nos"] },
  { canonical: "pr", dimension: "COUNT", toBase: 2, aliases: ["pr", "pair", "pairs"] },
  { canonical: "dz", dimension: "COUNT", toBase: 12, aliases: ["dz", "doz", "dozen", "dozens"] },
  { canonical: "w", dimension: "POWER", toBase: 1, aliases: ["w", "watt", "watts"] },
  { canonical: "kw", dimension: "POWER", toBase: 1000, aliases: ["kw", "kilowatt", "kilowatts"] },
  { canonical: "v", dimension: "VOLTAGE", toBase: 1, aliases: ["v", "volt", "volts", "vac", "vdc"] },
];

const UNIT_BY_ALIAS: ReadonlyMap<string, UnitDefinition> = new Map(
  UNIT_DEFINITIONS.flatMap((unit) => unit.aliases.map((alias) => [alias, unit] as const))
);

export function lookupUnit(alias: string): UnitDefinition | null {
  return UNIT_BY_ALIAS.get(alias.trim().toLowerCase()) ?? null;
}
