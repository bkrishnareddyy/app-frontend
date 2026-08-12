/**
 * Compliance-significant change detection for parties.
 *
 * Mirrors `productChangeDetection.ts` in spirit: when a party record changes,
 * the question is not "what field moved" but "does anything already decided
 * about this party need looking at again". A cosmetic reformat of an address
 * line does not. A new EORI number does, because whatever identity check or
 * screening was last done was done against the old one.
 *
 * What this module produces is a **workflow signal**, never a compliance
 * decision. It says SCREENING_REVALIDATION_REQUIRED; it does not run a
 * screen, does not set a pass/fail, and does not touch review status.
 * SCREENING_REVALIDATION_REQUIRED in particular is never a permanent party
 * flag — it is a resolvable request to look again, exactly like the other
 * three flags, cleared by a person and never inferred into a result.
 *
 * The module is pure: it compares two snapshots and returns findings. Writing
 * change events and revalidation flags is the service's job.
 */

import type { PartyChangeSignificance, PartyImpactFlag, PartyIdentifierType } from "@prisma/client";
import { normalizeLegalName, normalizeText } from "./partyNormalization";

/**
 * The compliance-relevant surface of a party, flattened for comparison.
 *
 * Deliberately not the database rows: ids, timestamps and audit columns
 * change constantly and mean nothing here. Only ACTIVE facts are compared —
 * a fact already SUPERSEDED or REJECTED before either snapshot was taken is
 * not part of what changed.
 */
export interface PartySnapshot {
  names: readonly SnapshotName[];
  identifiers: readonly SnapshotIdentifier[];
  registrations: readonly SnapshotRegistration[];
  addresses: readonly SnapshotAddress[];
}

export interface SnapshotName {
  nameType: string;
  normalizedName: string;
}

export interface SnapshotIdentifier {
  identifierType: PartyIdentifierType;
  normalizedValue: string;
  issuingCountry: string | null;
}

export interface SnapshotRegistration {
  country: string;
  registrationNumber: string;
  legalForm: string | null;
  registeringAuthority: string | null;
}

export interface SnapshotAddress {
  addressType: string;
  addressLine1: string;
  city: string | null;
  country: string;
}

export interface DetectedChange {
  /** The entity that changed, e.g. "Party", "PartyName:LEGAL". */
  entity: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  significance: PartyChangeSignificance;
  impactFlags: readonly PartyImpactFlag[];
  /** Why this rises to the significance it does, for the history tab. */
  reason: string;
}

const IDENTITY: PartyImpactFlag = "IDENTITY_REVALIDATION_REQUIRED";
const REGISTRATION: PartyImpactFlag = "REGISTRATION_REVALIDATION_REQUIRED";
const ADDRESS: PartyImpactFlag = "ADDRESS_REVALIDATION_REQUIRED";
const SCREENING: PartyImpactFlag = "SCREENING_REVALIDATION_REQUIRED";

/**
 * Government-issued or registry identifiers. A change here is grounds a prior
 * identity check or screen was run against, so it re-raises both.
 * Tenant-internal reference numbers (a customer number, an internal code) are
 * bookkeeping and raise neither.
 */
const IDENTITY_BEARING_IDENTIFIER_TYPES: readonly PartyIdentifierType[] = [
  "EORI",
  "DUNS",
  "LEI",
  "VAT",
  "TAX_ID",
  "CUSTOMS_ID",
];

export function detectPartyChanges(before: PartySnapshot, after: PartySnapshot): DetectedChange[] {
  return [
    ...detectNameChanges(before, after),
    ...detectIdentifierChanges(before, after),
    ...detectRegistrationChanges(before, after),
    ...detectAddressChanges(before, after),
  ];
}

function nameKey(name: SnapshotName): string {
  return `${name.nameType}|${name.normalizedName}`;
}

/**
 * Names, added or removed. A LEGAL name is the identity a screen is run
 * against, so it also re-raises SCREENING; other name types (trade name, DBA,
 * former legal name, translation) still bear on identity but not, on their
 * own, on what a screening subject line reads.
 */
function detectNameChanges(before: PartySnapshot, after: PartySnapshot): DetectedChange[] {
  const beforeKeys = new Set(before.names.map(nameKey));
  const afterKeys = new Set(after.names.map(nameKey));

  const changes: DetectedChange[] = [];

  for (const name of after.names) {
    if (beforeKeys.has(nameKey(name))) continue;
    changes.push(nameChange(name, null, name.normalizedName));
  }
  for (const name of before.names) {
    if (afterKeys.has(nameKey(name))) continue;
    changes.push(nameChange(name, name.normalizedName, null));
  }

  return changes;
}

function nameChange(name: SnapshotName, oldValue: string | null, newValue: string | null): DetectedChange {
  const isLegal = name.nameType === "LEGAL";
  return {
    entity: `PartyName:${name.nameType}`,
    field: oldValue === null ? "added" : "removed",
    oldValue,
    newValue,
    significance: isLegal ? "COMPLIANCE_SIGNIFICANT" : "POTENTIALLY_COMPLIANCE_SIGNIFICANT",
    impactFlags: isLegal ? [IDENTITY, SCREENING] : [IDENTITY],
    reason: isLegal
      ? "The legal name is the identity a prior identity check or screen was run against."
      : "A name the party is known by changed. This does not itself change legal identity.",
  };
}

function identifierKey(identifier: SnapshotIdentifier): string {
  return `${identifier.identifierType}`;
}

/**
 * Identifiers, added, removed, or changed in value. Keyed by scheme rather
 * than by scheme+value, so a corrected EORI number shows as one change on the
 * scheme rather than a remove-and-add pair.
 */
function detectIdentifierChanges(before: PartySnapshot, after: PartySnapshot): DetectedChange[] {
  const beforeMap = new Map(before.identifiers.map((i) => [identifierKey(i), i]));
  const afterMap = new Map(after.identifiers.map((i) => [identifierKey(i), i]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const changes: DetectedChange[] = [];
  for (const key of keys) {
    const oldIdentifier = beforeMap.get(key) ?? null;
    const newIdentifier = afterMap.get(key) ?? null;
    const oldValue = oldIdentifier === null ? null : describeIdentifier(oldIdentifier);
    const newValue = newIdentifier === null ? null : describeIdentifier(newIdentifier);
    if (oldValue === newValue) continue;

    const identifierType = (newIdentifier ?? oldIdentifier)?.identifierType as PartyIdentifierType;
    const identityBearing = IDENTITY_BEARING_IDENTIFIER_TYPES.includes(identifierType);

    changes.push({
      entity: `PartyIdentifier:${identifierType}`,
      field: oldIdentifier === null ? "added" : newIdentifier === null ? "removed" : "value",
      oldValue,
      newValue,
      significance: identityBearing ? "COMPLIANCE_SIGNIFICANT" : "NON_MATERIAL",
      impactFlags: identityBearing ? [IDENTITY, SCREENING] : [],
      reason: identityBearing
        ? `${identifierType} is a government-issued or registry identifier. A prior identity check or screen was run against the old value.`
        : `${identifierType} is a tenant-internal reference and does not itself bear on identity or screening.`,
    });
  }

  return changes;
}

function describeIdentifier(identifier: SnapshotIdentifier): string {
  return identifier.issuingCountry === null
    ? identifier.normalizedValue
    : `${identifier.normalizedValue} (${identifier.issuingCountry})`;
}

function registrationKey(registration: SnapshotRegistration): string {
  return registration.country;
}

/**
 * Registrations, added, removed, or changed. Kept by country: a party has, at
 * most, one active registration per jurisdiction at a time, and a change to
 * its number, legal form, or authority is exactly the kind of fact a prior
 * verification or screen was run against.
 */
function detectRegistrationChanges(before: PartySnapshot, after: PartySnapshot): DetectedChange[] {
  const beforeMap = new Map(before.registrations.map((r) => [registrationKey(r), r]));
  const afterMap = new Map(after.registrations.map((r) => [registrationKey(r), r]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const changes: DetectedChange[] = [];
  for (const key of keys) {
    const oldRow = beforeMap.get(key) ?? null;
    const newRow = afterMap.get(key) ?? null;
    const oldValue = oldRow === null ? null : describeRegistration(oldRow);
    const newValue = newRow === null ? null : describeRegistration(newRow);
    if (oldValue === newValue) continue;

    changes.push({
      entity: `PartyRegistration:${key}`,
      field: oldRow === null ? "added" : newRow === null ? "removed" : "registrationNumber",
      oldValue,
      newValue,
      significance: "COMPLIANCE_SIGNIFICANT",
      impactFlags: [REGISTRATION, SCREENING],
      reason:
        "The business registration for this jurisdiction changed. Any prior verification of it, and any screen run against it, needs to be looked at again.",
    });
  }

  return changes;
}

function describeRegistration(registration: SnapshotRegistration): string {
  const form = registration.legalForm === null ? "" : ` (${registration.legalForm})`;
  return `${registration.registrationNumber}${form}`;
}

function addressKey(address: SnapshotAddress): string {
  return address.addressType;
}

/**
 * Addresses, added, removed, or changed. A REGISTERED address is treated the
 * same as an identity-bearing fact, since it is what verification and
 * screening are usually run against; other address types (mailing, billing,
 * site, operating) still matter but do not, on their own, imply a person
 * verified or screened the party there.
 */
function detectAddressChanges(before: PartySnapshot, after: PartySnapshot): DetectedChange[] {
  const beforeMap = new Map(before.addresses.map((a) => [addressKey(a), a]));
  const afterMap = new Map(after.addresses.map((a) => [addressKey(a), a]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const changes: DetectedChange[] = [];
  for (const key of keys) {
    const oldRow = beforeMap.get(key) ?? null;
    const newRow = afterMap.get(key) ?? null;
    const oldValue = oldRow === null ? null : describeAddress(oldRow);
    const newValue = newRow === null ? null : describeAddress(newRow);
    if (oldValue === newValue) continue;

    // A pure reformat of the free-text lines is recorded but never raises a
    // signal, because nothing about where the party actually is changed.
    const cosmetic =
      oldRow !== null &&
      newRow !== null &&
      oldRow.country === newRow.country &&
      normalizeText(oldRow.addressLine1) === normalizeText(newRow.addressLine1) &&
      normalizeText(oldRow.city ?? "") === normalizeText(newRow.city ?? "");

    const isRegistered = key === "REGISTERED";

    changes.push({
      entity: `PartyAddress:${key}`,
      field: oldRow === null ? "added" : newRow === null ? "removed" : "address",
      oldValue,
      newValue,
      significance: cosmetic ? "NON_MATERIAL" : isRegistered ? "COMPLIANCE_SIGNIFICANT" : "POTENTIALLY_COMPLIANCE_SIGNIFICANT",
      impactFlags: cosmetic ? [] : isRegistered ? [ADDRESS, SCREENING] : [ADDRESS],
      reason: cosmetic
        ? "Wording is unchanged once punctuation and case are set aside."
        : isRegistered
          ? "The registered address changed. This is commonly what identity checks and screens were run against."
          : "An address on file for this party changed.",
    });
  }

  return changes;
}

function describeAddress(address: SnapshotAddress): string {
  const city = address.city === null ? "" : `${address.city}, `;
  return `${address.addressLine1}, ${city}${address.country}`;
}

/** Whether two legal names agree once suffixes and formatting are folded. */
export function namesAreEquivalent(oldName: string, newName: string): boolean {
  return normalizeLegalName(oldName) === normalizeLegalName(newName);
}

/** The distinct signals a set of changes asks for, with the reason for each. */
export interface RevalidationSignal {
  flag: PartyImpactFlag;
  reason: string;
  /** Indexes into the change list that raised this flag. */
  triggeredBy: readonly number[];
}

export function revalidationSignals(changes: readonly DetectedChange[]): RevalidationSignal[] {
  const byFlag = new Map<PartyImpactFlag, { reasons: string[]; indexes: number[] }>();

  changes.forEach((change, index) => {
    for (const flag of change.impactFlags) {
      const entry = byFlag.get(flag) ?? { reasons: [], indexes: [] };
      const reason = `${change.entity}.${change.field}: ${change.reason}`;
      if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
      entry.indexes.push(index);
      byFlag.set(flag, entry);
    }
  });

  return [...byFlag.entries()].map(([flag, entry]) => ({
    flag,
    reason: entry.reasons.join(" "),
    triggeredBy: entry.indexes,
  }));
}

export function highestSignificance(changes: readonly DetectedChange[]): PartyChangeSignificance {
  if (changes.some((c) => c.significance === "COMPLIANCE_SIGNIFICANT")) return "COMPLIANCE_SIGNIFICANT";
  if (changes.some((c) => c.significance === "POTENTIALLY_COMPLIANCE_SIGNIFICANT")) {
    return "POTENTIALLY_COMPLIANCE_SIGNIFICANT";
  }
  return "NON_MATERIAL";
}
