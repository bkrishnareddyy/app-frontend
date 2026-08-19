/**
 * Deterministic party matching.
 *
 * Given a description of a counterparty — off a commercial invoice, a CSV row,
 * an extracted document fact — this decides which party in the tenant's master
 * it refers to. Rule-based and explainable by construction, for the same reason
 * `productMatching.ts` is: every result names the rule that produced it and the
 * exact value that matched, so a broker asked "why did you attach this
 * shipment to that party?" has an answer that does not begin with "the model
 * thought".
 *
 * There is no fuzzy name matching, no similarity score, no embedding search
 * here. This is a stricter module than its product counterpart in one respect
 * that the spec calls out explicitly: a name may never, on its own, decide an
 * EXACT_MATCH. `matchOnNameAndCountry` cannot return EXACT_MATCH even when it
 * finds exactly one candidate, because two unrelated companies sharing a legal
 * name and a country is not a customs-safe coincidence to auto-resolve.
 *
 * The four outcomes:
 *
 *   EXACT_MATCH    exactly one party matched on an identifier scheme that is
 *                  unique on its own, on a registration number paired with its
 *                  country, or on a jurisdiction-scoped identifier (VAT, TAX_ID,
 *                  CUSTOMS_ID, CUSTOMER_NUMBER, SUPPLIER_NUMBER) paired with the
 *                  issuing country. Safe to attach automatically.
 *   POSSIBLE_MATCH exactly one party matched on weaker evidence — a
 *                  jurisdiction-scoped identifier without its country, or an
 *                  exact legal-name-and-country agreement. Needs a human to
 *                  confirm.
 *   AMBIGUOUS      the evidence matched more than one party. Every candidate is
 *                  returned; none is chosen.
 *   NO_MATCH       nothing matched.
 *
 * Tenant scoping is the caller's job: this module only ever sees the candidate
 * set it is handed.
 */

import type { PartyIdentifierType, PartyMatchStatus } from "@prisma/client";
import { normalizeCountry, normalizeIdentifier, normalizeLegalName, trimToNull } from "./partyNormalization";

/**
 * Identifier schemes that identify one party on their own, with no country
 * needed. EORI, DUNS and LEI are globally administered registry identifiers,
 * so a collision is a data error rather than a legitimate reuse.
 * INTERNAL_PARTY_CODE is unique because the tenant's own catalogue says so —
 * `Party.internalPartyCode` carries a database constraint to that effect.
 */
export const UNIQUE_IDENTIFIER_TYPES: readonly PartyIdentifierType[] = ["EORI", "DUNS", "LEI", "INTERNAL_PARTY_CODE"];

/**
 * Identifier schemes that only identify a party once paired with the country
 * that issued them. A VAT or tax number is reused across jurisdictions; a
 * customer or supplier number is only unique within whoever assigned it, and
 * the closest fact this module has to that is the country recorded alongside
 * it.
 */
export const COUNTRY_QUALIFIED_TYPES: readonly PartyIdentifierType[] = [
  "VAT",
  "TAX_ID",
  "CUSTOMS_ID",
  "CUSTOMER_NUMBER",
  "SUPPLIER_NUMBER",
];

export interface MatchableIdentifier {
  identifierType: PartyIdentifierType;
  normalizedValue: string;
  issuingCountry: string | null;
}

export interface MatchableRegistration {
  normalizedRegistrationNumber: string;
  country: string;
}

/** The shape matching needs from a party. Free of Prisma and of the database. */
export interface MatchableParty {
  id: string;
  clientId?: string | null;
  identifiers: readonly MatchableIdentifier[];
  registrations: readonly MatchableRegistration[];
  /** Normalized forms of every active name the party is known by. */
  normalizedNames: readonly string[];
  /** ISO country codes drawn from the party's registrations and addresses. */
  countries: readonly string[];
}

/** What the caller knows about the counterparty it is trying to identify. */
export interface MatchCandidateInput {
  identifiers?: readonly { identifierType: PartyIdentifierType; value: string; issuingCountry?: string | null }[];
  registrationNumber?: string | null;
  registrationCountry?: string | null;
  legalName?: string | null;
  /** A country associated with the name evidence — registration or address. */
  country?: string | null;
  clientId?: string | null;
  clientScope?: "EXACT" | "INCLUDE_SHARED" | "ALL";
}

export type MatchRule =
  | "UNIQUE_IDENTIFIER"
  | "REGISTRATION_NUMBER"
  | "COUNTRY_QUALIFIED_IDENTIFIER"
  | "UNQUALIFIED_IDENTIFIER"
  | "NAME_AND_COUNTRY";

export interface PartyMatchCandidate {
  partyId: string;
  rule: MatchRule;
  /** The identifier scheme that matched, where the rule used one. */
  identifierType: PartyIdentifierType | null;
  /** The normalized value both sides agreed on. */
  matchedValue: string;
  /** A sentence a reviewer can read, naming the evidence rather than a score. */
  explanation: string;
}

export interface PartyMatchResult {
  status: PartyMatchStatus;
  /** Every party the winning rule matched. One entry unless AMBIGUOUS. */
  candidates: readonly PartyMatchCandidate[];
  rule: MatchRule | null;
}

const NO_MATCH: PartyMatchResult = { status: "NO_MATCH", candidates: [], rule: null };

/**
 * Rules in strength order. The first rule that matches anything decides the
 * outcome, including when what it matched is several parties — a strong rule
 * finding two candidates means the master has a genuine collision, and
 * quietly falling through to a weaker rule would hide it.
 */
export function matchParty(input: MatchCandidateInput, parties: readonly MatchableParty[]): PartyMatchResult {
  const inputIdentifiers = (input.identifiers ?? [])
    .map((identifier) => ({
      identifierType: identifier.identifierType,
      normalizedValue: normalizeIdentifier(identifier.value),
      issuingCountry: resolveCountryOrNull(identifier.issuingCountry ?? null),
    }))
    .filter((identifier) => identifier.normalizedValue !== "");

  const filterCandidatesByClient = (candidates: PartyMatchCandidate[]): PartyMatchCandidate[] => {
    if (candidates.length <= 1 || !input.clientId) return candidates;
    const clientSpecific = candidates.filter((c) => {
      const party = parties.find((p) => p.id === c.partyId);
      return party?.clientId === input.clientId;
    });
    return clientSpecific.length > 0 ? clientSpecific : candidates;
  };

  const uniqueRule = filterCandidatesByClient(matchOnUniqueIdentifiers(inputIdentifiers, parties));
  if (uniqueRule.length > 0) return decide(uniqueRule, "UNIQUE_IDENTIFIER");

  const registrationRule = filterCandidatesByClient(matchOnRegistration(input, parties));
  if (registrationRule.length > 0) return decide(registrationRule, "REGISTRATION_NUMBER");

  const qualifiedRule = filterCandidatesByClient(matchOnCountryQualifiedIdentifiers(inputIdentifiers, parties, true));
  if (qualifiedRule.length > 0) return decide(qualifiedRule, "COUNTRY_QUALIFIED_IDENTIFIER");

  const unqualifiedRule = filterCandidatesByClient(matchOnCountryQualifiedIdentifiers(inputIdentifiers, parties, false));
  if (unqualifiedRule.length > 0) {
    // Never EXACT: without the issuing country, the same reference number can
    // legitimately belong to unrelated parties in different jurisdictions.
    return {
      status: unqualifiedRule.length === 1 ? "POSSIBLE_MATCH" : "AMBIGUOUS",
      candidates: unqualifiedRule,
      rule: "UNQUALIFIED_IDENTIFIER",
    };
  }

  const nameRule = filterCandidatesByClient(matchOnNameAndCountry(input, parties));
  if (nameRule.length > 0) {
    // Never EXACT, regardless of how many parties matched: a shared legal name
    // and country is evidence a person should confirm, not a determination.
    return {
      status: nameRule.length === 1 ? "POSSIBLE_MATCH" : "AMBIGUOUS",
      candidates: nameRule,
      rule: "NAME_AND_COUNTRY",
    };
  }

  return NO_MATCH;
}

function decide(candidates: PartyMatchCandidate[], rule: MatchRule): PartyMatchResult {
  return {
    status: candidates.length === 1 ? "EXACT_MATCH" : "AMBIGUOUS",
    candidates,
    rule,
  };
}

function resolveCountryOrNull(value: string | null): string | null {
  if (value === null) return null;
  const normalized = normalizeCountry(value);
  return normalized.code;
}

function matchOnUniqueIdentifiers(
  inputIdentifiers: readonly { identifierType: PartyIdentifierType; normalizedValue: string }[],
  parties: readonly MatchableParty[]
): PartyMatchCandidate[] {
  const wanted = inputIdentifiers.filter((identifier) => UNIQUE_IDENTIFIER_TYPES.includes(identifier.identifierType));
  if (wanted.length === 0) return [];

  const candidates: PartyMatchCandidate[] = [];
  for (const party of parties) {
    const hit = wanted.find((identifier) =>
      party.identifiers.some(
        (owned) => owned.identifierType === identifier.identifierType && owned.normalizedValue === identifier.normalizedValue
      )
    );
    if (hit) {
      candidates.push({
        partyId: party.id,
        rule: "UNIQUE_IDENTIFIER",
        identifierType: hit.identifierType,
        matchedValue: hit.normalizedValue,
        explanation: `Matched on ${hit.identifierType}, which identifies one party on its own, with value ${hit.normalizedValue}.`,
      });
    }
  }
  return candidates;
}

function matchOnRegistration(input: MatchCandidateInput, parties: readonly MatchableParty[]): PartyMatchCandidate[] {
  const rawNumber = trimToNull(input.registrationNumber ?? null);
  const rawCountry = trimToNull(input.registrationCountry ?? null);
  if (rawNumber === null || rawCountry === null) return [];

  const normalizedNumber = normalizeIdentifier(rawNumber);
  const country = resolveCountryOrNull(rawCountry);
  if (normalizedNumber === "" || country === null) return [];

  const candidates: PartyMatchCandidate[] = [];
  for (const party of parties) {
    const hit = party.registrations.some(
      (registration) => registration.normalizedRegistrationNumber === normalizedNumber && registration.country === country
    );
    if (hit) {
      candidates.push({
        partyId: party.id,
        rule: "REGISTRATION_NUMBER",
        identifierType: null,
        matchedValue: `${country}/${normalizedNumber}`,
        explanation: `Matched on registration number ${normalizedNumber} in ${country}.`,
      });
    }
  }
  return candidates;
}

function matchOnCountryQualifiedIdentifiers(
  inputIdentifiers: readonly { identifierType: PartyIdentifierType; normalizedValue: string; issuingCountry: string | null }[],
  parties: readonly MatchableParty[],
  requireCountry: boolean
): PartyMatchCandidate[] {
  const wanted = inputIdentifiers.filter(
    (identifier) =>
      COUNTRY_QUALIFIED_TYPES.includes(identifier.identifierType) &&
      (requireCountry ? identifier.issuingCountry !== null : identifier.issuingCountry === null)
  );
  if (wanted.length === 0) return [];

  const candidates: PartyMatchCandidate[] = [];
  for (const party of parties) {
    const hit = wanted.find((identifier) =>
      party.identifiers.some((owned) => {
        if (owned.identifierType !== identifier.identifierType || owned.normalizedValue !== identifier.normalizedValue) {
          return false;
        }
        return requireCountry ? owned.issuingCountry === identifier.issuingCountry : true;
      })
    );
    if (hit) {
      const rule: MatchRule = requireCountry ? "COUNTRY_QUALIFIED_IDENTIFIER" : "UNQUALIFIED_IDENTIFIER";
      const suffix = requireCountry
        ? ` issued in ${hit.issuingCountry}.`
        : `, without a known issuing country to qualify it. The same reference number can belong to unrelated parties in different jurisdictions, so this needs confirmation.`;
      candidates.push({
        partyId: party.id,
        rule,
        identifierType: hit.identifierType,
        matchedValue: hit.normalizedValue,
        explanation: `Matched on ${hit.identifierType} ${hit.normalizedValue}${suffix}`,
      });
    }
  }
  return candidates;
}

/**
 * Exact agreement on both normalized legal name and country. Both halves are
 * required — a name alone matches every "Global Trading Co" in a master — and
 * even a single result from this rule is only ever POSSIBLE_MATCH, never
 * EXACT_MATCH: legal identity is never inferred from name similarity alone,
 * however exact the string comparison.
 */
function matchOnNameAndCountry(input: MatchCandidateInput, parties: readonly MatchableParty[]): PartyMatchCandidate[] {
  const name = trimToNull(input.legalName ?? null);
  const rawCountry = trimToNull(input.country ?? null);
  if (name === null || rawCountry === null) return [];

  const normalizedName = normalizeLegalName(name);
  const country = resolveCountryOrNull(rawCountry);
  if (normalizedName === "" || country === null) return [];

  return parties
    .filter((party) => party.normalizedNames.includes(normalizedName) && party.countries.includes(country))
    .map((party) => ({
      partyId: party.id,
      rule: "NAME_AND_COUNTRY" as const,
      identifierType: null,
      matchedValue: `${normalizedName} / ${country}`,
      explanation: `Legal name and country match this record exactly. No identifier or registration number was supplied, so this is a suggestion rather than a determination.`,
    }));
}

/** Whether a match may be attached without a human confirming it. */
export function isAutoAttachable(result: PartyMatchResult): boolean {
  return result.status === "EXACT_MATCH" && result.candidates.length === 1;
}
