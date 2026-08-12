/**
 * Lifecycle rules for the two decisions a party record carries: its overall
 * master-data review, and each registration's verification.
 *
 * Stated once, here, as pure functions, so the API route, the CSV importer,
 * and any future agent all go through the same gate rather than each
 * reimplementing "can this become approved" or "can this become verified" —
 * the same reason `productDecisionLifecycle.ts` exists for products.
 *
 * Three properties this module exists to guarantee:
 *
 *   1. Nothing reaches APPROVED review or VERIFIED registration without a
 *      named human reviewer. There is no code path — import, agent, bulk
 *      edit — that can set either without a userId.
 *   2. A registration cannot become VERIFIED without evidence attached. This
 *      is the concrete form of "never fabricate verification": a status flip
 *      with nothing behind it is refused by this gate, not merely discouraged
 *      by convention.
 *   3. Review and registration status only ever move forward through a
 *      reviewer's action or a revalidation request; nothing here, or
 *      anywhere in the party module, infers a party's legal identity from
 *      name similarity, however exact the string match — that is
 *      `partyMatching.ts`'s job to refuse, and this module never overrides it
 *      by granting an approval shortcut.
 */

import type { PartyRegistrationStatus, PartyReviewStatus } from "@prisma/client";

export interface TransitionCheck {
  allowed: boolean;
  /** Why not, phrased for an API error message. */
  reason: string | null;
}

const ALLOWED: TransitionCheck = { allowed: true, reason: null };

// ---------------------------------------------------------------------------
// Master-data review
// ---------------------------------------------------------------------------

/**
 * Which review statuses may follow which.
 *
 * APPROVED does not lead back to IN_REVIEW directly — a change that requires
 * another look moves an approved party to NEEDS_REVIEW (the change-detection
 * service does this, never a person editing the status by hand), and NEEDS_REVIEW
 * has to be picked back up through IN_REVIEW like any other review.
 */
const REVIEW_TRANSITIONS: Readonly<Record<PartyReviewStatus, readonly PartyReviewStatus[]>> = {
  UNREVIEWED: ["IN_REVIEW", "NEEDS_REVIEW"],
  IN_REVIEW: ["APPROVED", "REJECTED", "NEEDS_REVIEW"],
  APPROVED: ["NEEDS_REVIEW"],
  REJECTED: ["IN_REVIEW"],
  NEEDS_REVIEW: ["IN_REVIEW"],
};

export function canTransitionReview(from: PartyReviewStatus, to: PartyReviewStatus): TransitionCheck {
  if (from === to) return { allowed: false, reason: `The party is already ${from}.` };
  if (REVIEW_TRANSITIONS[from].includes(to)) return ALLOWED;

  if (to === "APPROVED") {
    return {
      allowed: false,
      reason: `A ${from} party cannot be approved directly. It has to be in review first, so the record shows who reviewed it.`,
    };
  }
  return { allowed: false, reason: `A ${from} party cannot become ${to}.` };
}

export interface ReviewApprovalRequest {
  currentStatus: PartyReviewStatus;
  reviewerUserId: string | null;
  /** Whether the caller holds parties.review.approve. */
  reviewerCanApprove: boolean;
}

export interface ApprovalCheck {
  allowed: boolean;
  reason: string | null;
}

/** The single gate through which a party's master data becomes APPROVED. */
export function canApproveParty(request: ReviewApprovalRequest): ApprovalCheck {
  if (!request.reviewerCanApprove) {
    return { allowed: false, reason: "Approving a party requires the parties.review.approve permission." };
  }
  if (request.reviewerUserId === null) {
    return { allowed: false, reason: "A party cannot be approved without an identified reviewer." };
  }
  const transition = canTransitionReview(request.currentStatus, "APPROVED");
  if (!transition.allowed) return { allowed: false, reason: transition.reason };
  return { allowed: true, reason: null };
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

/**
 * Which registration statuses may follow which. Mirrors the product module's
 * country-fact transitions: VERIFIED is never reached in one step from
 * CLAIMED, because "a source stated it" and "a person checked it against
 * evidence" are different facts and the model insists the second is recorded
 * as its own event.
 */
const REGISTRATION_TRANSITIONS: Readonly<Record<PartyRegistrationStatus, readonly PartyRegistrationStatus[]>> = {
  CLAIMED: ["UNDER_REVIEW", "REJECTED", "SUPERSEDED"],
  UNDER_REVIEW: ["VERIFIED", "REJECTED", "SUPERSEDED"],
  VERIFIED: ["SUPERSEDED", "UNDER_REVIEW"],
  REJECTED: ["SUPERSEDED"],
  SUPERSEDED: [],
};

export function canTransitionRegistration(
  from: PartyRegistrationStatus,
  to: PartyRegistrationStatus
): TransitionCheck {
  if (from === to) return { allowed: false, reason: `The registration is already ${from}.` };
  if (REGISTRATION_TRANSITIONS[from].includes(to)) return ALLOWED;
  if (to === "VERIFIED") {
    return {
      allowed: false,
      reason: `A ${from} registration cannot be marked verified directly. It has to be reviewed against its evidence first.`,
    };
  }
  return { allowed: false, reason: `A ${from} registration cannot become ${to}.` };
}

export interface VerificationRequest {
  currentStatus: PartyRegistrationStatus;
  verifiedByUserId: string | null;
  /** The evidence the reviewer checked the registration against. */
  evidenceId: string | null;
  /** Whether the caller holds parties.registration.verify. */
  verifierCanVerify: boolean;
}

/**
 * The single gate through which a registration becomes VERIFIED.
 *
 * Requires the permission, a named reviewer, and an evidence record — the
 * concrete, checkable form of "never fabricate verification". A registration
 * number that merely matches an expected shape, or a source that merely
 * repeats a claim, is not verification.
 */
export function canVerifyRegistration(request: VerificationRequest): ApprovalCheck {
  if (!request.verifierCanVerify) {
    return { allowed: false, reason: "Verifying a registration requires the parties.registration.verify permission." };
  }
  if (request.verifiedByUserId === null) {
    return { allowed: false, reason: "A registration cannot be verified without an identified reviewer." };
  }
  if (request.evidenceId === null) {
    return {
      allowed: false,
      reason: "A registration cannot be verified without evidence to check it against.",
    };
  }
  const transition = canTransitionRegistration(request.currentStatus, "VERIFIED");
  if (!transition.allowed) return { allowed: false, reason: transition.reason };
  return { allowed: true, reason: null };
}

/**
 * Picks the registration in force for a country at a moment in time.
 *
 * Only VERIFIED rows are eligible — a CLAIMED registration is what a source
 * said, not a position anything downstream should rely on as established.
 * When more than one is verified and effective, the most recently effective
 * one wins and the caller can see there was more than one.
 */
export interface EffectiveRegistrationInput {
  id: string;
  country: string;
  status: PartyRegistrationStatus;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface EffectiveRegistrationResult<T extends EffectiveRegistrationInput> {
  effective: T | null;
  /** True when more than one verified row was in force; needs cleaning up. */
  conflicting: boolean;
}

export function effectiveRegistration<T extends EffectiveRegistrationInput>(
  registrations: readonly T[],
  country: string,
  at: Date
): EffectiveRegistrationResult<T> {
  const inForce = registrations.filter(
    (registration) =>
      registration.country === country &&
      registration.status === "VERIFIED" &&
      registration.effectiveFrom.getTime() <= at.getTime() &&
      (registration.effectiveTo === null || registration.effectiveTo.getTime() > at.getTime())
  );

  if (inForce.length === 0) return { effective: null, conflicting: false };

  const sorted = [...inForce].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return { effective: sorted[0] ?? null, conflicting: inForce.length > 1 };
}
