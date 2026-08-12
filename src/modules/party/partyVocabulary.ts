/**
 * Controlled vocabulary for the Global Party Master.
 *
 * Countries only. A party's country facts (registration country, address
 * country, identifier issuing country) each resolve independently against this
 * table, and none of them may be inferred from another. This module is
 * self-contained and does not import from the product module's vocabulary —
 * Party and Product are separate domains that happen to both need country
 * resolution, not a shared one.
 *
 * Like its product-module counterpart, this module does not guess: a country
 * name absent from the alias table stays unresolved and the raw string is
 * kept, because a wrong ISO code on a party's registration is a compliance
 * misstatement while a missing one is merely incomplete.
 */

/** ISO 3166-1 alpha-2. */
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
 * Kept small on purpose, mirroring the product module's table. Anything a
 * reasonable person could read two ways (e.g. "Korea") is left out so it lands
 * as unresolved rather than as a confident mistake.
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
