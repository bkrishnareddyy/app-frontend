/**
 * Lifecycle rules for the two jurisdiction-specific decisions a product carries:
 * its classifications and its country facts.
 *
 * These are the rules that keep an unreviewed suggestion from ever being mistaken
 * for an approved position. They are stated once, here, as pure functions, so
 * that the API route, the CSV importer, and any future agent all go through the
 * same gate rather than each reimplementing "can this become approved".
 *
 * Three properties this module exists to guarantee:
 *
 *   1. Nothing reaches APPROVED without a named human reviewer. There is no code
 *      path — import, agent, bulk edit, migration — that can set APPROVED
 *      without a userId, because `approveClassification` requires one and
 *      nothing else may write the status.
 *   2. A CANDIDATE cannot become APPROVED in one step. It has to be proposed and
 *      reviewed, so the record shows who put it forward and who accepted it.
 *   3. Approving a classification supersedes the previous approved one for the
 *      same jurisdiction and nomenclature rather than deleting it. The history of
 *      what was declared, and when, is the thing a customs audit asks for.
 */

import type {
  ProductClassificationStatus,
  ProductCountryFactStatus,
  ProductClassificationMethod,
} from "@prisma/client";

/**
 * Which statuses may follow which.
 *
 * Read this as the whole truth about classification status: any transition not
 * listed is refused, including the ones that look harmless. APPROVED does not
 * lead back to UNDER_REVIEW, for instance — reopening a decision means proposing
 * a new one, so that the approved record stays intact as the account of what was
 * relied upon at filing time.
 */
const CLASSIFICATION_TRANSITIONS: Readonly<
  Record<ProductClassificationStatus, readonly ProductClassificationStatus[]>
> = {
  CANDIDATE: ["PROPOSED", "REJECTED", "SUPERSEDED"],
  PROPOSED: ["UNDER_REVIEW", "REJECTED", "SUPERSEDED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "PROPOSED", "SUPERSEDED"],
  APPROVED: ["SUPERSEDED", "EXPIRED"],
  REJECTED: ["SUPERSEDED"],
  SUPERSEDED: [],
  EXPIRED: ["SUPERSEDED"],
};

/** Statuses that count as a live customs position for the jurisdiction. */
export const EFFECTIVE_CLASSIFICATION_STATUSES: readonly ProductClassificationStatus[] = ["APPROVED"];

/** Statuses that must never be presented as a usable classification. */
export const NON_BINDING_CLASSIFICATION_STATUSES: readonly ProductClassificationStatus[] = [
  "CANDIDATE",
  "PROPOSED",
  "UNDER_REVIEW",
  "REJECTED",
  "SUPERSEDED",
  "EXPIRED",
];

export interface TransitionCheck {
  allowed: boolean;
  /** Why not, phrased for an API error message. */
  reason: string | null;
}

const ALLOWED: TransitionCheck = { allowed: true, reason: null };

export function canTransitionClassification(
  from: ProductClassificationStatus,
  to: ProductClassificationStatus
): TransitionCheck {
  if (from === to) {
    return { allowed: false, reason: `The classification is already ${from}.` };
  }
  if (CLASSIFICATION_TRANSITIONS[from].includes(to)) return ALLOWED;

  if (to === "APPROVED") {
    return {
      allowed: false,
      reason: `A ${from} classification cannot be approved directly. It has to be proposed and reviewed first, so the record shows who put the code forward and who accepted it.`,
    };
  }
  return {
    allowed: false,
    reason: `A ${from} classification cannot become ${to}.`,
  };
}

export interface ApprovalRequest {
  currentStatus: ProductClassificationStatus;
  reviewerUserId: string | null;
  /** Whether the caller holds products.classification.approve. */
  reviewerCanApprove: boolean;
  /** The user who proposed it, where known. */
  proposedByUserId: string | null;
  /** Whether the account requires a second person to approve. */
  requireSeparateReviewer?: boolean;
}

export interface ApprovalCheck {
  allowed: boolean;
  reason: string | null;
}

/**
 * The single gate through which a classification becomes APPROVED.
 *
 * Note what is absent: there is no `source` or `confidence` parameter, and no
 * branch that lets a sufficiently confident automated proposal through. An agent
 * may create a CANDIDATE and may move it to PROPOSED; a person moves it the rest
 * of the way or it does not move.
 */
export function canApproveClassification(request: ApprovalRequest): ApprovalCheck {
  if (!request.reviewerCanApprove) {
    return {
      allowed: false,
      reason: "Approving a classification requires the products.classification.approve permission.",
    };
  }
  if (request.reviewerUserId === null) {
    return {
      allowed: false,
      reason: "A classification cannot be approved without an identified reviewer.",
    };
  }

  const transition = canTransitionClassification(request.currentStatus, "APPROVED");
  if (!transition.allowed) return { allowed: false, reason: transition.reason };

  if (
    request.requireSeparateReviewer === true &&
    request.proposedByUserId !== null &&
    request.proposedByUserId === request.reviewerUserId
  ) {
    return {
      allowed: false,
      reason: "This account requires a different person to approve a classification from the one who proposed it.",
    };
  }

  return { allowed: true, reason: null };
}

/**
 * The status a newly created classification may start in.
 *
 * Anything not entered by a person starts as CANDIDATE. An import file that
 * carries a status column is not trusted with it: a spreadsheet asserting
 * "APPROVED" is not a review, and treating it as one is the exact failure this
 * whole model is built to prevent.
 */
export function initialClassificationStatus(
  method: ProductClassificationMethod
): ProductClassificationStatus {
  switch (method) {
    case "MANUAL":
      return "PROPOSED";
    case "RULING_BASED":
      // A binding ruling is strong evidence, but it still has to be read against
      // this product by someone before it becomes this product's position.
      return "PROPOSED";
    case "AGENT_PROPOSED":
    case "IMPORT":
      return "CANDIDATE";
  }
}

/**
 * Whether an incoming classification duplicates one the product already holds.
 *
 * Identity is jurisdiction + nomenclature + normalized code. The same digits
 * under a different nomenclature are a different classification, and the same
 * code for a different jurisdiction is the entire point of the model.
 */
export function classificationIdentity(input: {
  jurisdiction: string;
  nomenclature: string;
  normalizedCode: string;
}): string {
  return `${input.jurisdiction}|${input.nomenclature}|${input.normalizedCode}`;
}

/**
 * Picks the classification in force for a jurisdiction at a moment in time.
 *
 * Only APPROVED rows are eligible. When several are approved and effective — a
 * data state that should not occur but is cheap to be safe about — the most
 * recently effective one wins and the caller can see there was more than one.
 */
export interface EffectiveClassificationInput {
  id: string;
  jurisdiction: string;
  nomenclature: string;
  status: ProductClassificationStatus;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface EffectiveClassificationResult<T extends EffectiveClassificationInput> {
  effective: T | null;
  /** True when more than one approved row was in force; needs cleaning up. */
  conflicting: boolean;
}

export function effectiveClassification<T extends EffectiveClassificationInput>(
  classifications: readonly T[],
  jurisdiction: string,
  at: Date
): EffectiveClassificationResult<T> {
  const inForce = classifications.filter(
    (classification) =>
      classification.jurisdiction === jurisdiction &&
      classification.status === "APPROVED" &&
      classification.effectiveFrom.getTime() <= at.getTime() &&
      (classification.effectiveTo === null || classification.effectiveTo.getTime() > at.getTime())
  );

  if (inForce.length === 0) return { effective: null, conflicting: false };

  const sorted = [...inForce].sort(
    (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
  );
  return { effective: sorted[0] ?? null, conflicting: inForce.length > 1 };
}

// ---------------------------------------------------------------------------
// Country facts
// ---------------------------------------------------------------------------

const COUNTRY_FACT_TRANSITIONS: Readonly<
  Record<ProductCountryFactStatus, readonly ProductCountryFactStatus[]>
> = {
  CLAIMED: ["UNDER_REVIEW", "REJECTED", "SUPERSEDED"],
  UNDER_REVIEW: ["VERIFIED", "REJECTED", "SUPERSEDED"],
  VERIFIED: ["SUPERSEDED", "UNDER_REVIEW"],
  REJECTED: ["SUPERSEDED"],
  SUPERSEDED: [],
};

export function canTransitionCountryFact(
  from: ProductCountryFactStatus,
  to: ProductCountryFactStatus
): TransitionCheck {
  if (from === to) return { allowed: false, reason: `The fact is already ${from}.` };
  if (COUNTRY_FACT_TRANSITIONS[from].includes(to)) return ALLOWED;
  if (to === "VERIFIED") {
    return {
      allowed: false,
      reason: `A ${from} country fact cannot be marked verified directly. It has to be reviewed against its evidence first.`,
    };
  }
  return { allowed: false, reason: `A ${from} country fact cannot become ${to}.` };
}

/**
 * Country facts that may never be created by inference.
 *
 * An origin claim is a legal assertion about where goods originate under a
 * specific rule. It is not the manufacturer's address, not the supplier's
 * country, not the country the goods were exported from, and not where the ship
 * left from. Those inputs may inform a person making the determination; none of
 * them may create the record. This list is checked by `assertOriginNotInferred`
 * and exists so the prohibition is enforced rather than merely documented.
 */
export const FORBIDDEN_ORIGIN_INFERENCE_SOURCES = [
  "MANUFACTURER_ADDRESS",
  "SUPPLIER_COUNTRY",
  "SELLER_COUNTRY",
  "EXPORT_COUNTRY",
  "SHIPPING_ORIGIN",
  "PORT_OF_LADING",
  "CONSIGNOR_ADDRESS",
] as const;

export type ForbiddenOriginInferenceSource = (typeof FORBIDDEN_ORIGIN_INFERENCE_SOURCES)[number];

export class OriginInferenceError extends Error {
  constructor(readonly source: string) {
    super(
      `Country of origin cannot be derived from ${source}. Origin is a legal determination under a specific rule of origin; it is not the country a party is located in or the country goods shipped from.`
    );
    this.name = "OriginInferenceError";
  }
}

/**
 * Guards the creation of an ORIGIN_CLAIM against being derived from a party
 * address or a routing field. Callers pass whatever they used as the basis.
 */
export function assertOriginNotInferred(basis: string): void {
  const normalized = basis.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((FORBIDDEN_ORIGIN_INFERENCE_SOURCES as readonly string[]).includes(normalized)) {
    throw new OriginInferenceError(normalized);
  }
}
