// Restricted / Denied-Party Screening -- Party Master lifecycle.
//
// rescreenParty resolves the party's current-effective name/address/contact
// (status ACTIVE, primary-then-most-recent -- the same selection pattern
// already used across PartyName/PartyAddress/PartyContact elsewhere), runs
// the name pass and (if a contact exists) a separate contact pass, persists
// both, and upserts PartyScreeningSummary. screeningStatus takes the worse
// of the two pass outcomes (HIT > REVIEW_REQUIRED > PARTIAL > ERROR >
// SKIPPED > CLEAR).
//
// Stale detection is identity-change-driven, not clock-driven: no fixed
// rescreen interval/TTL exists anywhere in this codebase. markStaleIfChanged
// recomputes the input hash and compares it to PartyScreeningSummary --
// a mismatch flips screeningStatus to STALE (an async re-screen is triggered
// on next read/explicit trigger, never forced synchronously into the write
// path that's calling this).
import crypto from "crypto";
import { db } from "@/lib/db";
import type { Prisma, PrismaClient, RestrictedPartyScreeningStatus as PrismaRPSStatus } from "@prisma/client";
import { runRestrictedPartyScreening } from "./restrictedPartyScreening";
import { persistScreeningRun, type PersistedRestrictedPartyResult } from "./persistResult";
import type { RestrictedPartyIdentity, RestrictedPartyScreeningOptions, RestrictedPartyScreeningStatus } from "./types";

type Tx = Prisma.TransactionClient | PrismaClient;

const STATUS_SEVERITY: Record<RestrictedPartyScreeningStatus, number> = {
  HIT: 5,
  REVIEW_REQUIRED: 4,
  PARTIAL: 3,
  ERROR: 2,
  SKIPPED: 1,
  CLEAR: 0,
};

function worseStatus(a: RestrictedPartyScreeningStatus, b: RestrictedPartyScreeningStatus): RestrictedPartyScreeningStatus {
  return STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b;
}

async function loadCurrentIdentity(tx: Tx, accountId: string, partyId: string): Promise<RestrictedPartyIdentity | null> {
  const [name, address, contact] = await Promise.all([
    tx.partyName.findFirst({
      where: { partyId, accountId, status: "ACTIVE" },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
    }),
    tx.partyAddress.findFirst({
      where: { partyId, accountId, status: "ACTIVE" },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
    }),
    tx.partyContact.findFirst({
      where: { partyId, accountId, status: "ACTIVE" },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
    }),
  ]);

  if (!name) return null;

  return {
    name: name.rawName,
    address: address?.addressLine1 ?? null,
    city: address?.city ?? null,
    country: address?.country ?? null,
    contactName: contact?.name ?? null,
  };
}

function computeIdentityHash(identity: RestrictedPartyIdentity): string {
  const normalized = [identity.name, identity.address ?? "", identity.city ?? "", identity.country ?? "", identity.contactName ?? ""]
    .map((v) => v.trim().toLowerCase())
    .join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export class PartyHasNoActiveNameError extends Error {
  constructor(partyId: string) {
    super(`Party ${partyId} has no active name to screen.`);
    this.name = "PartyHasNoActiveNameError";
  }
}

export interface RescreenPartyResult {
  overallStatus: RestrictedPartyScreeningStatus;
  results: PersistedRestrictedPartyResult[];
}

export async function rescreenParty(accountId: string, partyId: string, options?: RestrictedPartyScreeningOptions): Promise<RescreenPartyResult> {
  const identity = await loadCurrentIdentity(db, accountId, partyId);
  if (!identity) throw new PartyHasNoActiveNameError(partyId);

  const input = { accountId, source: "PARTY_MASTER" as const, partyId, identity, ...options };
  const runResult = await runRestrictedPartyScreening(input);
  const persisted = await persistScreeningRun(input, runResult);

  const overallStatus = persisted.map((p) => p.status as RestrictedPartyScreeningStatus).reduce(worseStatus, "CLEAR");
  const primaryResult = persisted.find((p) => p.passType === "PARTY_NAME") ?? persisted[0];
  const currentInputHash = computeIdentityHash(identity);

  await db.partyScreeningSummary.upsert({
    where: { partyId },
    create: {
      partyId,
      accountId,
      screeningStatus: overallStatus as PrismaRPSStatus,
      lastScreenedAt: new Date(),
      lastScreeningResultId: primaryResult.id,
      currentInputHash,
    },
    update: {
      screeningStatus: overallStatus as PrismaRPSStatus,
      lastScreenedAt: new Date(),
      lastScreeningResultId: primaryResult.id,
      currentInputHash,
    },
  });

  return { overallStatus, results: persisted };
}

/**
 * Called from identity-fact write paths (PartyName/PartyAddress/PartyContact
 * mutations) inside their own transaction. A no-op when the party has never
 * been screened -- there is nothing to go stale. Best-effort: never throws,
 * so a screening-summary hiccup can't block an unrelated party edit.
 */
export async function markStaleIfChanged(tx: Tx, accountId: string, partyId: string): Promise<void> {
  try {
    const summary = await tx.partyScreeningSummary.findUnique({ where: { partyId } });
    if (!summary || summary.screeningStatus === "STALE") return;

    const identity = await loadCurrentIdentity(tx, accountId, partyId);
    if (!identity) return;

    const freshHash = computeIdentityHash(identity);
    if (freshHash !== summary.currentInputHash) {
      await tx.partyScreeningSummary.update({ where: { partyId }, data: { screeningStatus: "STALE" } });
    }
  } catch {
    // Best-effort -- staleness bookkeeping must never fail the caller's mutation.
  }
}
