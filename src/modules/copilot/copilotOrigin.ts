/**
 * The country-of-origin position of a product, decided in code.
 *
 * This is the single most dangerous question the Copilot can be asked, because
 * the wrong answer is both plausible and actionable. A product manufactured in
 * Germany, bought from a German supplier, shipped from Hamburg, has four German
 * facts attached to it and none of them is a legal country of origin. Origin is
 * a determination — substantial transformation, tariff shift, regional value
 * content — that Qubere records as an approved fact or does not hold at all.
 *
 * So the model is never asked to work it out. This module reads the product's
 * country facts and produces a finished sentence; the tool returns that sentence
 * verbatim, and the system prompt tells the model to quote it rather than
 * reason about it. A model that ignores that instruction still cannot produce a
 * verified origin from this projection, because the projection does not contain
 * one — `legalCountryOfOrigin` is null, and every other country is labelled with
 * what it actually is.
 *
 * `ProductCountryFact.factType` already draws the distinction in the schema:
 * MANUFACTURE_COUNTRY and PRODUCTION_COUNTRY are physical facts, ORIGIN_CLAIM is
 * an assertion about origin, and only a VERIFIED origin claim is a determination
 * anyone may rely on.
 */

export const ORIGIN_FACT_TYPE = "ORIGIN_CLAIM";
export const MANUFACTURE_FACT_TYPE = "MANUFACTURE_COUNTRY";
export const PRODUCTION_FACT_TYPE = "PRODUCTION_COUNTRY";

/** The only status that makes an origin claim a determination. */
export const VERIFIED_STATUS = "VERIFIED";

const SUPERSEDED_STATUSES = new Set(["SUPERSEDED", "REJECTED"]);

export interface CountryFactInput {
  factType: string;
  rawCountry: string;
  countryCode: string | null;
  status: string;
  effectiveTo: Date | null;
  reviewedAt: Date | null;
}

export interface CountryFactView {
  country: string;
  countryCode: string | null;
  status: string;
}

export interface OriginPosition {
  /**
   * The country Qubere will stand behind, or null. Null is the common case and
   * is not a gap to be filled — it is the answer.
   */
  legalCountryOfOrigin: string | null;
  basis: "VERIFIED_ORIGIN_DETERMINATION" | "NO_DETERMINATION";
  /** Written here, quoted by the model. Never assembled by the model. */
  statement: string;
  /** Physical facts, returned so they can be reported *as* physical facts. */
  manufactureCountries: CountryFactView[];
  productionCountries: CountryFactView[];
  /** Claims that exist but have not been verified. Not usable as origin. */
  unverifiedOriginClaims: CountryFactView[];
}

function isCurrent(fact: CountryFactInput, now: Date): boolean {
  if (SUPERSEDED_STATUSES.has(fact.status)) return false;
  if (fact.effectiveTo && fact.effectiveTo.getTime() <= now.getTime()) return false;
  return true;
}

function view(fact: CountryFactInput): CountryFactView {
  return { country: fact.rawCountry, countryCode: fact.countryCode, status: fact.status };
}

function list(facts: CountryFactView[]): string {
  const names = [...new Set(facts.map((f) => f.country))];
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function resolveOriginPosition(
  facts: readonly CountryFactInput[],
  now: Date = new Date()
): OriginPosition {
  const current = facts.filter((fact) => isCurrent(fact, now));

  const manufacture = current.filter((f) => f.factType === MANUFACTURE_FACT_TYPE).map(view);
  const production = current.filter((f) => f.factType === PRODUCTION_FACT_TYPE).map(view);
  const originClaims = current.filter((f) => f.factType === ORIGIN_FACT_TYPE);

  const verified = originClaims.filter((f) => f.status === VERIFIED_STATUS);
  const unverified = originClaims.filter((f) => f.status !== VERIFIED_STATUS).map(view);

  if (verified.length === 1) {
    const determined = verified[0];
    return {
      legalCountryOfOrigin: determined.rawCountry,
      basis: "VERIFIED_ORIGIN_DETERMINATION",
      statement: `Qubere holds a verified country-of-origin determination for this product: ${determined.rawCountry}.`,
      manufactureCountries: manufacture,
      productionCountries: production,
      unverifiedOriginClaims: unverified,
    };
  }

  // More than one verified claim is a data conflict, not a tie to be broken.
  // Reporting either one would be reporting a determination Qubere has not made.
  if (verified.length > 1) {
    return {
      legalCountryOfOrigin: null,
      basis: "NO_DETERMINATION",
      statement:
        `This product carries ${verified.length} conflicting verified origin claims (${list(
          verified.map(view)
        )}). No single country of origin can be reported until the conflict is resolved by a reviewer.`,
      manufactureCountries: manufacture,
      productionCountries: production,
      unverifiedOriginClaims: [...verified.map(view), ...unverified],
    };
  }

  const physical = [...manufacture, ...production];
  const caveat =
    physical.length > 0
      ? ` The recorded manufacturing or production country (${list(
          physical
        )}) is a physical fact about where the goods were made and is not a legal country of origin.`
      : "";
  const pending =
    unverified.length > 0
      ? ` ${unverified.length} origin ${
          unverified.length === 1 ? "claim exists but has" : "claims exist but have"
        } not been verified.`
      : "";

  return {
    legalCountryOfOrigin: null,
    basis: "NO_DETERMINATION",
    statement:
      `Qubere holds no approved country-of-origin determination for this product.${caveat}${pending} Origin must be determined by the Origin Agent or a qualified reviewer before it can be declared.`,
    manufactureCountries: manufacture,
    productionCountries: production,
    unverifiedOriginClaims: unverified,
  };
}
