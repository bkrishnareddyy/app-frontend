/**
 * The tenant-scoped data layer for the party master.
 *
 * Every function here takes a `PartyActor` carrying the accountId resolved from
 * the authenticated session, and every query it issues filters on that accountId.
 * There is no code path that accepts an account from a caller: routes pass
 * `ctx.accountId` from `getAccountContext()`, and the request schemas have no
 * field for one, so there is nothing to forge.
 *
 * A party id belonging to another tenant is reported as not found rather than
 * as forbidden. "Forbidden" tells the caller the id exists, which turns any
 * detail endpoint into an enumeration oracle for another company's master.
 *
 * Three invariants this module is responsible for:
 *
 *   - Every mutation that touches a name, identifier, registration, or address
 *     runs through `withChangeDetection`, so a write that changes something
 *     identity- or screening-relevant always produces a change event and,
 *     where warranted, an open revalidation flag. There is no side door. If
 *     that mutation also finds the party currently APPROVED, review status
 *     drops to NEEDS_REVIEW — never back to IN_REVIEW directly, and never
 *     decided by a person editing the status field by hand.
 *   - Review status only ever moves through the lifecycle rules, and APPROVED
 *     requires a permission and a named reviewer. A registration only becomes
 *     VERIFIED through the same kind of gate, and only with evidence attached.
 *   - Facts carry their provenance. A fact created from a document points at
 *     the document; a fact created by hand says so. Nothing invents a source,
 *     and nothing here merges two parties, however similar their names look.
 */

import type { Party, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { DomainError } from "@/lib/api/error";
import { markStaleIfChanged } from "@/modules/agents/compliance/restrictedParty/partyScreeningLifecycle";
import { screenPartyName } from "@/lib/screening/dpsScreening";
import { buildPartyOrderBy, buildPartyWhere, partySkip, type PartyQuery } from "./partyQuery";
import {
  detectPartyChanges,
  highestSignificance,
  revalidationSignals,
  type DetectedChange,
  type PartySnapshot,
} from "./partyChangeDetection";
import {
  canApproveParty,
  canTransitionRegistration,
  canTransitionReview,
  canVerifyRegistration,
} from "./partyDecisionLifecycle";
import { matchParty, type MatchCandidateInput, type PartyMatchResult, UNIQUE_IDENTIFIER_TYPES } from "./partyMatching";
import { normalizeCountry, normalizeIdentifier, normalizeLegalName, parseIsoDate } from "./partyNormalization";
import type { CreatePartyInput, UpdatePartyInput } from "./partySchemas";
import {
  partyAddressInputSchema,
  partyContactInputSchema,
  partyIdentifierInputSchema,
  partyNameInputSchema,
  partyRegistrationInputSchema,
  partyRelationshipInputSchema,
  partyRoleInputSchema,
  partySiteInputSchema,
} from "./partySchemas";

type PartyNameInput = z.infer<typeof partyNameInputSchema>;
type PartyIdentifierInput = z.infer<typeof partyIdentifierInputSchema>;
type PartyRegistrationInput = z.infer<typeof partyRegistrationInputSchema>;
type PartyAddressInput = z.infer<typeof partyAddressInputSchema>;
type PartyContactInput = z.infer<typeof partyContactInputSchema>;
type PartyRoleInput = z.infer<typeof partyRoleInputSchema>;
type PartyRelationshipInput = z.infer<typeof partyRelationshipInputSchema>;
type PartySiteInput = z.infer<typeof partySiteInputSchema>;

/** Who is acting, and on whose behalf. Never assembled from request input. */
export interface PartyActor {
  accountId: string;
  userId: string | null;
  /** Whether the actor holds parties.review.approve. */
  canApproveParty?: boolean;
  /** Whether the actor holds parties.registration.verify. */
  canVerifyRegistration?: boolean;
  /** Whether the actor holds parties.revalidation.resolve. */
  canResolveRevalidation?: boolean;
  requestId?: string | null;
}

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * `PartyRegistration.country` and `PartyAddress.country` are single columns
 * with no separate raw/code pair, unlike identifiers and names. When the
 * value resolves to an ISO code, that is what gets stored, so the matcher can
 * compare it directly against another normalized value; a value that cannot
 * be resolved is kept exactly as given rather than guessed at.
 */
function resolvePartyCountry(value: string): string {
  const normalized = normalizeCountry(value);
  return normalized.code ?? normalized.raw;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const LIST_SELECT = {
  id: true,
  internalPartyCode: true,
  partyKind: true,
  status: true,
  reviewStatus: true,
  currentVersion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PartySelect;

export interface PartyListRow {
  id: string;
  internalPartyCode: string | null;
  partyKind: string;
  status: string;
  reviewStatus: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  /** The party's primary name, or its next-best active name, for the list. */
  displayName: string | null;
  /** Active role types this party currently holds. */
  activeRoles: string[];
  openRevalidationCount: number;
}

export interface PartyListResult {
  rows: PartyListRow[];
  total: number;
}

export async function listParties(actor: PartyActor, query: PartyQuery): Promise<PartyListResult> {
  const where = buildPartyWhere(actor.accountId, query) as Prisma.PartyWhereInput;

  const [rows, total] = await Promise.all([
    db.party.findMany({
      where,
      select: {
        ...LIST_SELECT,
        names: {
          where: { status: "ACTIVE" },
          orderBy: [{ isPrimary: "desc" }, { nameType: "asc" }],
          select: { rawName: true },
          take: 1,
        },
        roles: {
          where: { status: "ACTIVE" },
          select: { roleType: true },
        },
        revalidationFlags: {
          where: { status: "OPEN" },
          select: { id: true },
        },
      },
      orderBy: buildPartyOrderBy(query),
      skip: partySkip(query),
      take: query.pageSize,
    }),
    db.party.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      internalPartyCode: row.internalPartyCode,
      partyKind: row.partyKind,
      status: row.status,
      reviewStatus: row.reviewStatus,
      currentVersion: row.currentVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      displayName: row.names[0]?.rawName ?? null,
      activeRoles: [...new Set(row.roles.map((role) => role.roleType))].sort(),
      openRevalidationCount: row.revalidationFlags.length,
    })),
  };
}

const DETAIL_INCLUDE = {
  names: { orderBy: [{ isPrimary: "desc" }, { nameType: "asc" }] },
  identifiers: { orderBy: [{ isPrimary: "desc" }, { identifierType: "asc" }] },
  registrations: { orderBy: [{ country: "asc" }, { effectiveFrom: "desc" }] },
  addresses: { orderBy: [{ isPrimary: "desc" }, { addressType: "asc" }] },
  contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
  roles: { orderBy: { roleType: "asc" } },
  sites: { orderBy: { siteName: "asc" } },
  evidence: { orderBy: { createdAt: "desc" } },
  revalidationFlags: { orderBy: { createdAt: "desc" } },
  relationshipsFrom: {
    orderBy: { createdAt: "desc" },
    include: { toParty: { select: { id: true, internalPartyCode: true } } },
  },
  relationshipsTo: {
    orderBy: { createdAt: "desc" },
    include: { fromParty: { select: { id: true, internalPartyCode: true } } },
  },
} satisfies Prisma.PartyInclude;

export type PartyDetail = Prisma.PartyGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** Returns null for a party in another account: not found, never forbidden. */
export async function getParty(actor: PartyActor, partyId: string): Promise<PartyDetail | null> {
  return db.party.findFirst({
    where: { id: partyId, accountId: actor.accountId, deletedAt: null },
    include: DETAIL_INCLUDE,
  });
}

export async function getPartyHistory(actor: PartyActor, partyId: string) {
  await requireOwnedParty(db, actor, partyId);
  return db.partyChangeEvent.findMany({
    where: { partyId, accountId: actor.accountId },
    orderBy: [{ createdAt: "desc" }],
    take: 500,
  });
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

export class PartyNotFoundError extends DomainError {
  constructor(partyId: string) {
    super(`No party ${partyId} in this account.`, "PARTY_NOT_FOUND", 404);
    this.name = "PartyNotFoundError";
  }
}

/**
 * Confirms the party exists *inside the actor's account*.
 *
 * Called at the top of every mutation, including the ones whose subsequent
 * writes also carry an accountId filter. The redundancy is deliberate: it
 * means a future query written without the filter still cannot act on
 * another tenant's party, because it never gets past this line.
 */
async function requireOwnedParty(tx: Tx, actor: PartyActor, partyId: string): Promise<Party> {
  const party = await tx.party.findFirst({
    where: { id: partyId, accountId: actor.accountId, deletedAt: null },
  });
  if (party === null) throw new PartyNotFoundError(partyId);
  return party;
}

/** Confirms an evidence row belongs to this account *and* this party. */
async function requireOwnedEvidence(tx: Tx, actor: PartyActor, partyId: string, evidenceId: string): Promise<string> {
  const evidence = await tx.partyEvidence.findFirst({
    where: { id: evidenceId, accountId: actor.accountId, partyId },
    select: { id: true },
  });
  if (evidence === null) {
    throw new DomainError("That evidence does not belong to this party.", "PARTY_EVIDENCE_NOT_FOUND", 404);
  }
  return evidence.id;
}

/** Confirms an address belongs to this account *and* this party, for site linking. */
async function requireOwnedAddress(tx: Tx, actor: PartyActor, partyId: string, addressId: string): Promise<string> {
  const address = await tx.partyAddress.findFirst({
    where: { id: addressId, accountId: actor.accountId, partyId },
    select: { id: true },
  });
  if (address === null) {
    throw new DomainError("That address does not belong to this party.", "PARTY_ADDRESS_NOT_FOUND", 404);
  }
  return address.id;
}

// ---------------------------------------------------------------------------
// Snapshots and change detection
// ---------------------------------------------------------------------------

async function loadSnapshot(tx: Tx, accountId: string, partyId: string): Promise<PartySnapshot> {
  const party = await tx.party.findFirstOrThrow({
    where: { id: partyId, accountId },
    include: {
      names: { where: { status: "ACTIVE" } },
      identifiers: { where: { status: "ACTIVE" } },
      registrations: { where: { status: { notIn: ["SUPERSEDED", "REJECTED"] } } },
      addresses: { where: { status: "ACTIVE" } },
    },
  });

  return {
    names: party.names.map((name) => ({ nameType: name.nameType, normalizedName: name.normalizedName })),
    identifiers: party.identifiers.map((identifier) => ({
      identifierType: identifier.identifierType,
      normalizedValue: identifier.normalizedValue,
      issuingCountry: identifier.issuingCountry,
    })),
    registrations: party.registrations.map((registration) => ({
      country: registration.country,
      registrationNumber: registration.registrationNumber,
      legalForm: registration.legalForm,
      registeringAuthority: registration.registeringAuthority,
    })),
    addresses: party.addresses.map((address) => ({
      addressType: address.addressType,
      addressLine1: address.addressLine1,
      city: address.city,
      country: address.country,
    })),
  };
}

export interface MutationOutcome<T> {
  result: T;
  changes: DetectedChange[];
  /** Flags newly opened by this mutation. */
  raisedFlags: string[];
}

/**
 * Runs a mutation and records what it did to the party's identity surface.
 *
 * The snapshot is taken before and after inside the same transaction, so the
 * comparison sees exactly the mutation's effect and nothing a concurrent
 * write did. Every change becomes a `PartyChangeEvent`; every one that bears
 * on identity, a registration, an address, or screening additionally opens a
 * `PartyRevalidationFlag`, unless an identical flag is already open, because
 * a party edited five times in an afternoon should show one outstanding
 * question per topic, not five.
 *
 * If the party was APPROVED and this mutation produced anything more than a
 * non-material change, review status drops to NEEDS_REVIEW — the one place
 * that transition happens, matching the rule in `partyDecisionLifecycle.ts`
 * that a person editing the status field never does this by hand.
 */
async function withChangeDetection<T>(
  actor: PartyActor,
  partyId: string,
  changeReason: string | null,
  mutate: (tx: Tx) => Promise<T>
): Promise<MutationOutcome<T>> {
  return db.$transaction(async (tx) => {
    const party = await requireOwnedParty(tx, actor, partyId);
    const before = await loadSnapshot(tx, actor.accountId, partyId);

    const result = await mutate(tx);

    // Name/address/contact writes can invalidate a party's last Restricted
    // Party Screening result -- checked on every mutation here (not just
    // ones loadSnapshot's name/address diff catches) because PartyContact
    // isn't part of that snapshot at all.
    await markStaleIfChanged(tx, actor.accountId, partyId);

    const after = await loadSnapshot(tx, actor.accountId, partyId);
    const changes = detectPartyChanges(before, after);

    if (changes.length === 0) {
      return { result, changes, raisedFlags: [] };
    }

    const needsReReview = party.reviewStatus === "APPROVED" && highestSignificance(changes) !== "NON_MATERIAL";

    const updated = await tx.party.update({
      where: { id: partyId },
      data: {
        currentVersion: { increment: 1 },
        updatedByUserId: actor.userId,
        ...(needsReReview ? { reviewStatus: "NEEDS_REVIEW" } : {}),
      },
      select: { currentVersion: true },
    });

    const createdEvents = await Promise.all(
      changes.map((change) =>
        tx.partyChangeEvent.create({
          data: {
            accountId: actor.accountId,
            partyId,
            versionNumber: updated.currentVersion,
            entity: change.entity,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            significance: change.significance,
            impactFlags: [...change.impactFlags],
            changeReason,
            changedByUserId: actor.userId,
            correlationId: actor.requestId ?? null,
          },
          select: { id: true },
        })
      )
    );

    const raisedFlags: string[] = [];
    for (const signal of revalidationSignals(changes)) {
      const existing = await tx.partyRevalidationFlag.findFirst({
        where: { partyId, accountId: actor.accountId, flag: signal.flag, status: "OPEN" },
        select: { id: true },
      });
      if (existing !== null) continue;

      const triggerIndex = signal.triggeredBy[0];
      await tx.partyRevalidationFlag.create({
        data: {
          accountId: actor.accountId,
          partyId,
          flag: signal.flag,
          status: "OPEN",
          reason: signal.reason,
          triggeredByChangeEventId: triggerIndex === undefined ? null : (createdEvents[triggerIndex]?.id ?? null),
        },
      });
      raisedFlags.push(signal.flag);
    }

    return { result, changes, raisedFlags };
  });
}

// ---------------------------------------------------------------------------
// Data-shaping helpers
// ---------------------------------------------------------------------------

function nameData(actor: PartyActor, partyId: string, input: PartyNameInput): Prisma.PartyNameUncheckedCreateInput {
  return {
    accountId: actor.accountId,
    partyId,
    nameType: input.nameType,
    rawName: input.rawName,
    normalizedName: normalizeLegalName(input.rawName),
    language: input.language ?? null,
    isPrimary: input.isPrimary ?? false,
    sourceType: input.sourceType ?? "USER",
    evidenceId: input.evidenceId ?? null,
    createdByUserId: actor.userId,
  };
}

function identifierData(
  actor: PartyActor,
  partyId: string,
  input: PartyIdentifierInput
): Prisma.PartyIdentifierUncheckedCreateInput {
  return {
    accountId: actor.accountId,
    partyId,
    identifierType: input.identifierType,
    value: input.value,
    normalizedValue: normalizeIdentifier(input.value),
    issuingCountry: input.issuingCountry == null ? null : resolvePartyCountry(input.issuingCountry),
    issuingAuthority: input.issuingAuthority ?? null,
    isPrimary: input.isPrimary ?? false,
    sourceType: input.sourceType ?? "USER",
    evidenceId: input.evidenceId ?? null,
    createdByUserId: actor.userId,
  };
}

function registrationData(
  actor: PartyActor,
  partyId: string,
  input: PartyRegistrationInput
): Prisma.PartyRegistrationUncheckedCreateInput {
  return {
    accountId: actor.accountId,
    partyId,
    registrationNumber: input.registrationNumber,
    registeringAuthority: input.registeringAuthority ?? null,
    country: resolvePartyCountry(input.country),
    legalForm: input.legalForm ?? null,
    status: "CLAIMED",
    registeredOn: input.registeredOn ? parseIsoDate(input.registeredOn) : null,
    sourceType: input.sourceType ?? "USER",
    evidenceId: input.evidenceId ?? null,
    createdByUserId: actor.userId,
  };
}

function addressData(
  actor: PartyActor,
  partyId: string,
  input: PartyAddressInput
): Prisma.PartyAddressUncheckedCreateInput {
  return {
    accountId: actor.accountId,
    partyId,
    addressType: input.addressType,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city ?? null,
    stateProvince: input.stateProvince ?? null,
    postalCode: input.postalCode ?? null,
    country: resolvePartyCountry(input.country),
    isPrimary: input.isPrimary ?? false,
    sourceType: input.sourceType ?? "USER",
    evidenceId: input.evidenceId ?? null,
    createdByUserId: actor.userId,
  };
}

function contactData(
  actor: PartyActor,
  partyId: string,
  input: PartyContactInput
): Prisma.PartyContactUncheckedCreateInput {
  return {
    accountId: actor.accountId,
    partyId,
    name: input.name ?? null,
    title: input.title ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    isPrimary: input.isPrimary ?? false,
    sourceType: input.sourceType ?? "USER",
    createdByUserId: actor.userId,
  };
}

function roleData(actor: PartyActor, partyId: string, input: PartyRoleInput): Prisma.PartyRoleUncheckedCreateInput {
  return {
    accountId: actor.accountId,
    partyId,
    roleType: input.roleType,
    sourceType: input.sourceType ?? "USER",
    evidenceId: input.evidenceId ?? null,
    createdByUserId: actor.userId,
  };
}

/**
 * Guards the identifier schemes that must not repeat inside a tenant.
 *
 * Applies only to the schemes in `UNIQUE_IDENTIFIER_TYPES`. A customer or
 * supplier number deliberately may repeat: the same digits belong to
 * different counterparts depending on who assigned them, and rejecting that
 * would force users to invent fake reference numbers, which is worse than the
 * ambiguity it would prevent.
 */
async function assertIdentifierAvailable(
  tx: Tx,
  actor: PartyActor,
  partyId: string,
  identifierType: string,
  value: string
): Promise<void> {
  if (!(UNIQUE_IDENTIFIER_TYPES as readonly string[]).includes(identifierType)) return;

  const normalizedValue = normalizeIdentifier(value);
  const clash = await tx.partyIdentifier.findFirst({
    where: {
      accountId: actor.accountId,
      identifierType: identifierType as Prisma.PartyIdentifierWhereInput["identifierType"],
      normalizedValue,
      status: "ACTIVE",
      partyId: { not: partyId },
      party: { deletedAt: null },
    },
    select: { partyId: true },
  });

  if (clash !== null) {
    throw new DomainError(
      `${identifierType} ${value} already identifies a different party in this account.`,
      "PARTY_IDENTIFIER_TAKEN",
      409
    );
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createParty(actor: PartyActor, input: CreatePartyInput): Promise<PartyDetail> {
  const internalPartyCode = input.internalPartyCode ?? null;
  if (internalPartyCode !== null) {
    const clash = await db.party.findFirst({
      where: { accountId: actor.accountId, internalPartyCode, deletedAt: null },
      select: { id: true },
    });
    if (clash !== null) {
      throw new DomainError(
        `Internal party code ${internalPartyCode} already belongs to another party in this account.`,
        "PARTY_CODE_TAKEN",
        409
      );
    }
  }

  const party = await db.$transaction(async (tx) => {
    const created = await tx.party.create({
      data: {
        accountId: actor.accountId,
        clientId: input.clientId ?? null,
        internalPartyCode,
        partyKind: input.partyKind ?? "ORGANIZATION",
        status: "DRAFT",
        reviewStatus: "UNREVIEWED",
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });

    // The internal code is also an identifier, so it is searchable and
    // matchable like any other scheme rather than only living in a column.
    if (internalPartyCode !== null) {
      await tx.partyIdentifier.create({
        data: identifierData(actor, created.id, {
          identifierType: "INTERNAL_PARTY_CODE",
          value: internalPartyCode,
          isPrimary: true,
          sourceType: "USER",
        }),
      });
    }

    for (const name of input.names) {
      await tx.partyName.create({ data: nameData(actor, created.id, name) });
    }

    for (const identifier of input.identifiers ?? []) {
      if (identifier.identifierType === "INTERNAL_PARTY_CODE" && internalPartyCode !== null) continue;
      await assertIdentifierAvailable(tx, actor, created.id, identifier.identifierType, identifier.value);
      await tx.partyIdentifier.create({ data: identifierData(actor, created.id, identifier) });
    }

    for (const registration of input.registrations ?? []) {
      await tx.partyRegistration.create({ data: registrationData(actor, created.id, registration) });
    }

    for (const address of input.addresses ?? []) {
      await tx.partyAddress.create({ data: addressData(actor, created.id, address) });
    }

    for (const contact of input.contacts ?? []) {
      await tx.partyContact.create({ data: contactData(actor, created.id, contact) });
    }

    for (const role of input.roles ?? []) {
      await tx.partyRole.create({ data: roleData(actor, created.id, role) });
    }

    // The creation event is the first entry in the party's history. It is
    // recorded directly rather than through change detection, because there
    // is no "before" to compare against and a party appearing is not a
    // change to an identity position that needs revalidating.
    const primaryName = input.names.find((name) => name.isPrimary) ?? input.names[0];
    await tx.partyChangeEvent.create({
      data: {
        accountId: actor.accountId,
        partyId: created.id,
        versionNumber: 1,
        entity: "Party",
        field: "created",
        oldValue: null,
        newValue: primaryName?.rawName ?? internalPartyCode ?? created.id,
        significance: "NON_MATERIAL",
        impactFlags: [],
        changeReason: "Party created.",
        changedByUserId: actor.userId,
        correlationId: actor.requestId ?? null,
      },
    });

    return created;
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: AuditAction.PARTY_CREATED,
    entity: "Party",
    entityId: party.id,
    source: "UI",
    metadata: { internalPartyCode: party.internalPartyCode, partyKind: party.partyKind },
    requestId: actor.requestId ?? null,
  });

  // DPS screening on every new party creation. INDETERMINATE means no list is
  // loaded; the compliance team must screen manually. BLOCKED/FLAGGED opens an
  // exception so the party cannot slip through unreviewed.
  const primaryName = input.names.find((n) => n.isPrimary) ?? input.names[0];
  if (primaryName) {
    const screening = await screenPartyName(actor.accountId, primaryName.rawName, input.partyKind ?? "ORGANIZATION");

    if (screening.matchStatus === "BLOCKED" || screening.matchStatus === "FLAGGED") {
      const severity = screening.matchStatus === "BLOCKED" ? "Critical" : "High";
      const description =
        screening.matchStatus === "BLOCKED"
          ? `Party "${primaryName.rawName}" matched denied-party list entry "${screening.matchedParty}" (score: ${screening.matchScore}/100, source: ${screening.listSource ?? "unknown"}). Do not ship until cleared by compliance.`
          : `Party "${primaryName.rawName}" is a possible match for denied-party list entry "${screening.matchedParty}" (score: ${screening.matchScore}/100, source: ${screening.listSource ?? "unknown"}). Manual compliance review required.`;

      await db.exceptionItem.create({
        data: {
          accountId: actor.accountId,
          category: "COMPLIANCE",
          type: "compliance_flag",
          severity,
          description,
          status: "Open",
          blocking: screening.matchStatus === "BLOCKED",
          requiredAction: "Perform manual denied-party screening before using this party on a shipment.",
          sourceAgent: "DPS Screening",
        },
      });

      await createAuditLog({
        accountId: actor.accountId,
        userId: actor.userId,
        action: AuditAction.PARTY_SCREENED,
        entity: "Party",
        entityId: party.id,
        source: "UI",
        metadata: {
          partyName: primaryName.rawName,
          matchStatus: screening.matchStatus,
          matchScore: screening.matchScore,
          matchedParty: screening.matchedParty,
          screeningLogId: screening.logId,
        },
        requestId: actor.requestId ?? null,
      });
    }
  }

  const detail = await getParty(actor, party.id);
  if (detail === null) throw new PartyNotFoundError(party.id);
  return detail;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateParty(
  actor: PartyActor,
  partyId: string,
  input: UpdatePartyInput
): Promise<MutationOutcome<PartyDetail>> {
  const { changeReason, ...fields } = input;

  if (fields.internalPartyCode !== undefined && fields.internalPartyCode !== null) {
    const clash = await db.party.findFirst({
      where: {
        accountId: actor.accountId,
        internalPartyCode: fields.internalPartyCode,
        deletedAt: null,
        id: { not: partyId },
      },
      select: { id: true },
    });
    if (clash !== null) {
      throw new DomainError(
        `Internal party code ${fields.internalPartyCode} already belongs to another party in this account.`,
        "PARTY_CODE_TAKEN",
        409
      );
    }
  }

  const outcome = await withChangeDetection(actor, partyId, changeReason ?? null, async (tx) => {
    await tx.party.update({
      where: { id: partyId },
      data: { ...fields, updatedByUserId: actor.userId },
    });
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: AuditAction.PARTY_UPDATED,
    entity: "Party",
    entityId: partyId,
    source: "UI",
    metadata: {
      fields: Object.keys(fields),
      significance: highestSignificance(outcome.changes),
      raisedFlags: outcome.raisedFlags,
    },
    requestId: actor.requestId ?? null,
  });

  const detail = await getParty(actor, partyId);
  if (detail === null) throw new PartyNotFoundError(partyId);
  return { ...outcome, result: detail };
}

/**
 * Retires a party without destroying it.
 *
 * Soft delete only. A party referenced by a filed shipment or product is
 * part of the record of what was declared, and a hard delete would remove
 * the explanation for a filing that still exists.
 */
export async function archiveParty(actor: PartyActor, partyId: string): Promise<void> {
  await requireOwnedParty(db, actor, partyId);

  await db.party.update({
    where: { id: partyId },
    data: { deletedAt: new Date(), status: "ARCHIVED", updatedByUserId: actor.userId },
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: AuditAction.PARTY_ARCHIVED,
    entity: "Party",
    entityId: partyId,
    source: "UI",
    requestId: actor.requestId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export async function addName(actor: PartyActor, partyId: string, input: PartyNameInput): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, partyId, null, async (tx) => {
    if (input.evidenceId != null) {
      await requireOwnedEvidence(tx, actor, partyId, input.evidenceId);
    }
    if (input.isPrimary) {
      await tx.partyName.updateMany({
        where: { partyId, accountId: actor.accountId, status: "ACTIVE", isPrimary: true },
        data: { isPrimary: false },
      });
    }
    await tx.partyName.create({ data: nameData(actor, partyId, input) });
  });
}

export async function removeName(actor: PartyActor, partyId: string, nameId: string): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, partyId, null, async (tx) => {
    const updated = await tx.partyName.updateMany({
      where: { id: nameId, partyId, accountId: actor.accountId, status: "ACTIVE" },
      data: { status: "SUPERSEDED", effectiveTo: new Date() },
    });
    if (updated.count === 0) {
      throw new DomainError("No such name on this party.", "PARTY_NAME_NOT_FOUND", 404);
    }
  });
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export async function addIdentifier(
  actor: PartyActor,
  partyId: string,
  input: PartyIdentifierInput
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, partyId, null, async (tx) => {
    await assertIdentifierAvailable(tx, actor, partyId, input.identifierType, input.value);
    if (input.evidenceId != null) {
      await requireOwnedEvidence(tx, actor, partyId, input.evidenceId);
    }
    if (input.isPrimary) {
      await tx.partyIdentifier.updateMany({
        where: { partyId, accountId: actor.accountId, status: "ACTIVE", isPrimary: true },
        data: { isPrimary: false },
      });
    }
    await tx.partyIdentifier.create({ data: identifierData(actor, partyId, input) });
  });
}

export async function removeIdentifier(
  actor: PartyActor,
  partyId: string,
  identifierId: string
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, partyId, null, async (tx) => {
    const updated = await tx.partyIdentifier.updateMany({
      where: { id: identifierId, partyId, accountId: actor.accountId, status: "ACTIVE" },
      data: { status: "SUPERSEDED", effectiveTo: new Date() },
    });
    if (updated.count === 0) {
      throw new DomainError("No such identifier on this party.", "PARTY_IDENTIFIER_NOT_FOUND", 404);
    }
  });
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

export async function addRegistration(
  actor: PartyActor,
  partyId: string,
  input: PartyRegistrationInput
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, partyId, null, async (tx) => {
    if (input.evidenceId != null) {
      await requireOwnedEvidence(tx, actor, partyId, input.evidenceId);
    }
    await tx.partyRegistration.create({ data: registrationData(actor, partyId, input) });
  });
}

/**
 * Moves a registration along its lifecycle.
 *
 * VERIFY is the consequential one, gated by `canVerifyRegistration`: the
 * actor must hold `parties.registration.verify`, must be an identified user,
 * and must point at an evidence record — the caller's own evidence, or the
 * one already attached when the registration was recorded. Nothing here
 * infers verification from the registration number merely looking well-formed.
 */
export async function reviewRegistration(
  actor: PartyActor,
  partyId: string,
  registrationId: string,
  action: "START_REVIEW" | "VERIFY" | "REJECT",
  options: { reviewNote?: string | null; evidenceId?: string | null } = {}
) {
  await requireOwnedParty(db, actor, partyId);

  const registration = await db.partyRegistration.findFirst({
    where: { id: registrationId, partyId, accountId: actor.accountId },
  });
  if (registration === null) {
    throw new DomainError("No such registration on this party.", "PARTY_REGISTRATION_NOT_FOUND", 404);
  }

  const target = action === "START_REVIEW" ? "UNDER_REVIEW" : action === "VERIFY" ? "VERIFIED" : "REJECTED";

  const evidenceId = target === "VERIFIED" ? options.evidenceId ?? registration.evidenceId ?? null : null;

  if (target === "VERIFIED") {
    if (options.evidenceId != null) {
      await requireOwnedEvidence(db, actor, partyId, options.evidenceId);
    }
    const check = canVerifyRegistration({
      currentStatus: registration.status,
      verifiedByUserId: actor.userId,
      evidenceId,
      verifierCanVerify: actor.canVerifyRegistration === true,
    });
    if (!check.allowed) {
      throw new DomainError(
        check.reason ?? "This registration cannot be verified.",
        "PARTY_REGISTRATION_NOT_VERIFIABLE",
        registration.status === "CLAIMED" || registration.status === "UNDER_REVIEW" ? 409 : 403
      );
    }
  } else {
    const check = canTransitionRegistration(registration.status, target);
    if (!check.allowed) {
      throw new DomainError(check.reason ?? "That transition is not allowed.", "PARTY_INVALID_TRANSITION", 409);
    }
  }

  const updated = await db.partyRegistration.update({
    where: { id: registrationId },
    data: {
      status: target,
      ...(target === "VERIFIED"
        ? { verifiedByUserId: actor.userId, verifiedAt: new Date(), evidenceId }
        : {}),
    },
  });

  // Verifying a registration is a consequential mutation, so a failure to
  // record it is surfaced rather than swallowed.
  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: `party.registration.${action.toLowerCase()}`,
    entity: "PartyRegistration",
    entityId: registrationId,
    metadata: { partyId, country: registration.country, from: registration.status, to: target, reviewNote: options.reviewNote ?? null },
    requestId: actor.requestId ?? null,
    failClosed: target === "VERIFIED",
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export async function addAddress(
  actor: PartyActor,
  partyId: string,
  input: PartyAddressInput
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, partyId, null, async (tx) => {
    if (input.evidenceId != null) {
      await requireOwnedEvidence(tx, actor, partyId, input.evidenceId);
    }
    if (input.isPrimary) {
      await tx.partyAddress.updateMany({
        where: { partyId, accountId: actor.accountId, addressType: input.addressType, status: "ACTIVE", isPrimary: true },
        data: { isPrimary: false },
      });
    }
    await tx.partyAddress.create({ data: addressData(actor, partyId, input) });
  });
}

export async function removeAddress(
  actor: PartyActor,
  partyId: string,
  addressId: string
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, partyId, null, async (tx) => {
    const updated = await tx.partyAddress.updateMany({
      where: { id: addressId, partyId, accountId: actor.accountId, status: "ACTIVE" },
      data: { status: "SUPERSEDED", effectiveTo: new Date() },
    });
    if (updated.count === 0) {
      throw new DomainError("No such address on this party.", "PARTY_ADDRESS_NOT_FOUND", 404);
    }
  });
}

// ---------------------------------------------------------------------------
// Contacts, roles, sites, relationships
//
// None of these carry compliance-significant facts the change-detection
// module compares (see `PartySnapshot` in partyChangeDetection.ts), so they
// are recorded directly rather than through `withChangeDetection` — there is
// nothing here for that comparison to find.
// ---------------------------------------------------------------------------

export async function addContact(actor: PartyActor, partyId: string, input: PartyContactInput) {
  await requireOwnedParty(db, actor, partyId);
  if (input.isPrimary) {
    await db.partyContact.updateMany({
      where: { partyId, accountId: actor.accountId, status: "ACTIVE", isPrimary: true },
      data: { isPrimary: false },
    });
  }
  const created = await db.partyContact.create({ data: contactData(actor, partyId, input) });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: "party.contact.add",
    entity: "PartyContact",
    entityId: created.id,
    metadata: { partyId },
    requestId: actor.requestId ?? null,
  });

  return created;
}

export async function removeContact(actor: PartyActor, partyId: string, contactId: string): Promise<void> {
  await requireOwnedParty(db, actor, partyId);
  const updated = await db.partyContact.updateMany({
    where: { id: contactId, partyId, accountId: actor.accountId, status: "ACTIVE" },
    data: { status: "SUPERSEDED" },
  });
  if (updated.count === 0) {
    throw new DomainError("No such contact on this party.", "PARTY_CONTACT_NOT_FOUND", 404);
  }
  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: "party.contact.remove",
    entity: "PartyContact",
    entityId: contactId,
    metadata: { partyId },
    requestId: actor.requestId ?? null,
  });
}

export async function addRole(actor: PartyActor, partyId: string, input: PartyRoleInput) {
  await requireOwnedParty(db, actor, partyId);
  if (input.evidenceId != null) {
    await requireOwnedEvidence(db, actor, partyId, input.evidenceId);
  }
  const created = await db.partyRole.create({ data: roleData(actor, partyId, input) });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: "party.role.add",
    entity: "PartyRole",
    entityId: created.id,
    metadata: { partyId, roleType: created.roleType },
    requestId: actor.requestId ?? null,
  });

  return created;
}

export async function removeRole(actor: PartyActor, partyId: string, roleId: string): Promise<void> {
  await requireOwnedParty(db, actor, partyId);
  const updated = await db.partyRole.updateMany({
    where: { id: roleId, partyId, accountId: actor.accountId, status: "ACTIVE" },
    data: { status: "SUPERSEDED", effectiveTo: new Date() },
  });
  if (updated.count === 0) {
    throw new DomainError("No such role on this party.", "PARTY_ROLE_NOT_FOUND", 404);
  }
  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: "party.role.remove",
    entity: "PartyRole",
    entityId: roleId,
    metadata: { partyId },
    requestId: actor.requestId ?? null,
  });
}

export async function addSite(actor: PartyActor, partyId: string, input: PartySiteInput) {
  await requireOwnedParty(db, actor, partyId);
  const addressId = input.addressId == null ? null : await requireOwnedAddress(db, actor, partyId, input.addressId);

  const created = await db.partySite.create({
    data: {
      accountId: actor.accountId,
      partyId,
      siteName: input.siteName,
      addressId,
      sourceType: "USER",
      createdByUserId: actor.userId,
    },
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: "party.site.add",
    entity: "PartySite",
    entityId: created.id,
    metadata: { partyId },
    requestId: actor.requestId ?? null,
  });

  return created;
}

export async function removeSite(actor: PartyActor, partyId: string, siteId: string): Promise<void> {
  await requireOwnedParty(db, actor, partyId);
  const updated = await db.partySite.updateMany({
    where: { id: siteId, partyId, accountId: actor.accountId, status: "ACTIVE" },
    data: { status: "SUPERSEDED" },
  });
  if (updated.count === 0) {
    throw new DomainError("No such site on this party.", "PARTY_SITE_NOT_FOUND", 404);
  }
  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: "party.site.remove",
    entity: "PartySite",
    entityId: siteId,
    metadata: { partyId },
    requestId: actor.requestId ?? null,
  });
}

/**
 * Records a stated relationship to another party in this master.
 *
 * `toPartyId` is checked against the caller's account before anything is
 * written, and a party may not hold a relationship to itself. This never
 * merges the two records — they stay two parties, related, never one.
 */
export async function addRelationship(actor: PartyActor, fromPartyId: string, input: PartyRelationshipInput) {
  await requireOwnedParty(db, actor, fromPartyId);
  if (input.toPartyId === fromPartyId) {
    throw new DomainError("A party cannot hold a relationship to itself.", "PARTY_RELATIONSHIP_SELF", 400);
  }
  await requireOwnedParty(db, actor, input.toPartyId);
  if (input.evidenceId != null) {
    await requireOwnedEvidence(db, actor, fromPartyId, input.evidenceId);
  }

  const created = await db.partyRelationship.create({
    data: {
      accountId: actor.accountId,
      fromPartyId,
      toPartyId: input.toPartyId,
      relationshipType: input.relationshipType,
      sourceType: input.sourceType ?? "USER",
      evidenceId: input.evidenceId ?? null,
      createdByUserId: actor.userId,
    },
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: "party.relationship.add",
    entity: "PartyRelationship",
    entityId: created.id,
    metadata: { fromPartyId, toPartyId: input.toPartyId, relationshipType: created.relationshipType },
    requestId: actor.requestId ?? null,
  });

  return created;
}

export async function removeRelationship(actor: PartyActor, fromPartyId: string, relationshipId: string): Promise<void> {
  await requireOwnedParty(db, actor, fromPartyId);
  const updated = await db.partyRelationship.updateMany({
    where: { id: relationshipId, fromPartyId, accountId: actor.accountId, status: "ACTIVE" },
    data: { status: "SUPERSEDED", effectiveTo: new Date() },
  });
  if (updated.count === 0) {
    throw new DomainError("No such relationship on this party.", "PARTY_RELATIONSHIP_NOT_FOUND", 404);
  }
  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: "party.relationship.remove",
    entity: "PartyRelationship",
    entityId: relationshipId,
    metadata: { fromPartyId },
    requestId: actor.requestId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * Attaches evidence to a party.
 *
 * A document or extracted-fact reference is checked against the caller's
 * account before it is stored, so evidence cannot be made to point at
 * another tenant's document — which would leak both the document's existence
 * and, through the evidence viewer, its contents.
 *
 * Nothing here manufactures provenance. If the caller supplies no source, the
 * schema rejects the request rather than defaulting to "user said so".
 */
export async function addEvidence(
  actor: PartyActor,
  partyId: string,
  input: {
    sourceType: string;
    sourceDocumentId?: string | null;
    sourceExtractedFactId?: string | null;
    sourceReference?: string | null;
    sourceUrl?: string | null;
    page?: number | null;
    description?: string | null;
  }
) {
  await requireOwnedParty(db, actor, partyId);

  if (input.sourceDocumentId != null) {
    const document = await db.shipmentDocument.findFirst({
      where: { id: input.sourceDocumentId, shipment: { accountId: actor.accountId } },
      select: { id: true },
    });
    if (document === null) {
      throw new DomainError("No such document in this account.", "DOCUMENT_NOT_FOUND", 404);
    }
  }

  if (input.sourceExtractedFactId != null) {
    // An extracted fact belongs to a classification case, which is the row
    // that carries the account. Scoping through the case rather than the
    // document is what keeps a fact whose document was detached still
    // tenant-checked.
    const fact = await db.extractedFact.findFirst({
      where: {
        id: input.sourceExtractedFactId,
        case: { accountId: actor.accountId },
      },
      select: { id: true },
    });
    if (fact === null) {
      throw new DomainError("No such extracted fact in this account.", "EXTRACTED_FACT_NOT_FOUND", 404);
    }
  }

  return db.partyEvidence.create({
    data: {
      accountId: actor.accountId,
      partyId,
      sourceType: input.sourceType as Prisma.PartyEvidenceUncheckedCreateInput["sourceType"],
      sourceDocumentId: input.sourceDocumentId ?? null,
      sourceExtractedFactId: input.sourceExtractedFactId ?? null,
      sourceReference: input.sourceReference ?? null,
      sourceUrl: input.sourceUrl ?? null,
      page: input.page ?? null,
      description: input.description ?? null,
      createdByUserId: actor.userId,
    },
  });
}

// ---------------------------------------------------------------------------
// Revalidation flags
// ---------------------------------------------------------------------------

/**
 * Closes a revalidation flag. Requires both an identified user and the
 * `parties.revalidation.resolve` permission — resolving one of these is a
 * person saying they looked again, never an automatic outcome, and never a
 * screening result (see `partyIntelligence.ts`).
 */
export async function resolveRevalidationFlag(
  actor: PartyActor,
  partyId: string,
  flagId: string,
  action: "RESOLVE" | "DISMISS",
  note: string | null
) {
  await requireOwnedParty(db, actor, partyId);

  if (actor.userId === null) {
    throw new DomainError("Closing a revalidation flag requires an identified user.", "PARTY_REVIEWER_REQUIRED", 403);
  }
  if (actor.canResolveRevalidation !== true) {
    throw new DomainError(
      "Closing a revalidation flag requires the parties.revalidation.resolve permission.",
      "PARTY_PERMISSION_REQUIRED",
      403
    );
  }

  const updated = await db.partyRevalidationFlag.updateMany({
    where: { id: flagId, partyId, accountId: actor.accountId, status: "OPEN" },
    data: {
      status: action === "RESOLVE" ? "RESOLVED" : "DISMISSED",
      resolvedByUserId: actor.userId,
      resolvedAt: new Date(),
      resolutionNote: note,
    },
  });

  if (updated.count === 0) {
    throw new DomainError("No open revalidation flag with that id on this party.", "PARTY_FLAG_NOT_FOUND", 404);
  }

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: `party.revalidation.${action.toLowerCase()}`,
    entity: "PartyRevalidationFlag",
    entityId: flagId,
    metadata: { partyId, note },
    requestId: actor.requestId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Master-data review
// ---------------------------------------------------------------------------

export async function reviewParty(
  actor: PartyActor,
  partyId: string,
  action: "START_REVIEW" | "APPROVE" | "REJECT",
  reviewNote: string | null = null
) {
  const party = await requireOwnedParty(db, actor, partyId);

  const target = action === "START_REVIEW" ? "IN_REVIEW" : action === "APPROVE" ? "APPROVED" : "REJECTED";

  if (target === "APPROVED") {
    const check = canApproveParty({
      currentStatus: party.reviewStatus,
      reviewerUserId: actor.userId,
      reviewerCanApprove: actor.canApproveParty === true,
    });
    if (!check.allowed) {
      throw new DomainError(
        check.reason ?? "This party cannot be approved.",
        "PARTY_NOT_APPROVABLE",
        party.reviewStatus === "IN_REVIEW" ? 403 : 409
      );
    }
  } else {
    const check = canTransitionReview(party.reviewStatus, target);
    if (!check.allowed) {
      throw new DomainError(check.reason ?? "That transition is not allowed.", "PARTY_INVALID_TRANSITION", 409);
    }
  }

  const updated = await db.party.update({
    where: { id: partyId },
    data: { reviewStatus: target, reviewedByUserId: actor.userId, reviewedAt: new Date() },
  });

  // Approving a party is a consequential mutation, so a failure to record it
  // is surfaced rather than swallowed.
  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: `party.review.${action.toLowerCase()}`,
    entity: "Party",
    entityId: partyId,
    metadata: { from: party.reviewStatus, to: target, reviewNote },
    requestId: actor.requestId ?? null,
    failClosed: target === "APPROVED",
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Finds the party a counterparty description refers to, within the caller's
 * tenant.
 *
 * The candidate set is narrowed in the database by the identifiers,
 * registration, or name actually supplied, then the decision is made by the
 * pure matcher. A tenant with 200,000 parties therefore does not load 200,000
 * rows, and the rule that decides the outcome is still the one the tests
 * exercise directly.
 */
export async function findPartyMatches(actor: PartyActor, input: MatchCandidateInput): Promise<PartyMatchResult> {
  const normalizedValues = (input.identifiers ?? [])
    .map((identifier) => normalizeIdentifier(identifier.value))
    .filter((value) => value !== "");

  const orClauses: Prisma.PartyWhereInput[] = [];
  if (normalizedValues.length > 0) {
    orClauses.push({ identifiers: { some: { normalizedValue: { in: normalizedValues }, status: "ACTIVE" } } });
  }
  if (input.registrationNumber != null && input.registrationCountry != null) {
    orClauses.push({
      registrations: {
        some: {
          registrationNumber: { equals: input.registrationNumber, mode: "insensitive" },
          status: { notIn: ["SUPERSEDED", "REJECTED"] },
        },
      },
    });
  }
  if (input.legalName != null && input.country != null) {
    orClauses.push({
      names: { some: { normalizedName: normalizeLegalName(input.legalName), status: "ACTIVE" } },
    });
  }

  if (orClauses.length === 0) {
    return { status: "NO_MATCH", candidates: [], rule: null };
  }

  const parties = await db.party.findMany({
    where: {
      accountId: actor.accountId,
      deletedAt: null,
      status: { notIn: ["ARCHIVED"] },
      OR: orClauses,
    },
    select: {
      id: true,
      identifiers: {
        where: { status: "ACTIVE" },
        select: { identifierType: true, normalizedValue: true, issuingCountry: true },
      },
      registrations: {
        where: { status: { notIn: ["SUPERSEDED", "REJECTED"] } },
        select: { registrationNumber: true, country: true },
      },
      names: { where: { status: "ACTIVE" }, select: { normalizedName: true } },
      addresses: { where: { status: "ACTIVE" }, select: { country: true } },
    },
    take: 200,
  });

  return matchParty(
    input,
    parties.map((party) => ({
      id: party.id,
      identifiers: party.identifiers,
      registrations: party.registrations.map((registration) => ({
        normalizedRegistrationNumber: normalizeIdentifier(registration.registrationNumber),
        country: registration.country,
      })),
      normalizedNames: party.names.map((name) => name.normalizedName),
      countries: [...new Set([...party.registrations.map((r) => r.country), ...party.addresses.map((a) => a.country)])],
    }))
  );
}
