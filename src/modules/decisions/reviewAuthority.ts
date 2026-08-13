/**
 * Who is allowed to close an agent decision, and in what capacity they did it.
 *
 * A decision review is a legal act: approving a reclassification changes the
 * code an entry is filed under. Two facts have to be separable afterwards --
 * whether the reviewer was permitted to do it, and whether the person who did
 * it holds a customs broker license.
 */

export const REVIEW_ACTIONS = {
  APPROVE: "Approved",
  REJECT: "Rejected",
  RE_EVALUATE: "In Progress",
} as const;

export const REVIEW_TRIAGE_STATES = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  RE_EVALUATE: "IN_PROGRESS",
} as const;

export type ReviewAction = keyof typeof REVIEW_ACTIONS;

export function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REVIEW_ACTIONS, value);
}

export const APPROVE_PERMISSION = "decisions.approve";
export const REJECT_PERMISSION = "decisions.reject";
export const RE_EVALUATE_PERMISSION = "decisions.reevaluate";
export const OVERRIDE_PERMISSION = "decisions.override";

const BASE_PERMISSION: Record<ReviewAction, string> = {
  APPROVE: APPROVE_PERMISSION,
  REJECT: REJECT_PERMISSION,
  RE_EVALUATE: RE_EVALUATE_PERMISSION,
};

export interface ClassificationCodes {
  currentHtsCode?: string | null;
  proposedHtsCode?: string | null;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Accepting a code where none was recorded is a first classification. Replacing
 * a code that is already on the record is an override of an earlier position.
 */
export function isClassificationOverride(decision: ClassificationCodes): boolean {
  const current = trimmed(decision.currentHtsCode);
  const proposed = trimmed(decision.proposedHtsCode);
  return current !== "" && proposed !== "" && current !== proposed;
}

export function requiredPermissions(action: ReviewAction, isOverride = false): string[] {
  const required = [BASE_PERMISSION[action]];
  if (action === "APPROVE" && isOverride) required.push(OVERRIDE_PERMISSION);
  return required;
}

export interface ReviewerAccess {
  roleNames?: string[] | null;
  isPlatformAdmin?: boolean | null;
  permissions?: string[] | null;
}

export interface PermissionCheck {
  allowed: boolean;
  required: string[];
  missing: string[];
  bypass: "PLATFORM_ADMIN" | "OWNER" | null;
}

/** Mirrors the bypasses in hasPermission(): platform admins and the account OWNER. */
export function checkReviewPermission(
  access: ReviewerAccess,
  required: string[]
): PermissionCheck {
  if (access.isPlatformAdmin === true) {
    return { allowed: true, required, missing: [], bypass: "PLATFORM_ADMIN" };
  }
  if (access.roleNames?.includes("OWNER")) {
    return { allowed: true, required, missing: [], bypass: "OWNER" };
  }

  const held = Array.isArray(access.permissions) ? access.permissions : [];
  const missing = required.filter((permission) => !held.includes(permission));
  return { allowed: missing.length === 0, required, missing, bypass: null };
}

export function permissionDeniedMessage(check: PermissionCheck): string {
  return `This action needs ${check.missing.join(" and ")}. Your role does not hold it.`;
}

export type ReviewerCapacity = "LICENSED_BROKER" | "OPERATOR";

export interface Reviewer {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  brokerLicenseNumber?: string | null;
}

export interface ReviewerIdentity {
  capacity: ReviewerCapacity;
  licenseNumber: string | null;
  name: string | null;
}

export function reviewerName(reviewer: Reviewer | null | undefined): string | null {
  if (!reviewer) return null;
  const full = [trimmed(reviewer.firstName), trimmed(reviewer.lastName)].filter(Boolean).join(" ");
  if (full !== "") return full;
  const email = trimmed(reviewer.email);
  return email === "" ? null : email;
}

/**
 * A blank license column means no license is on file, which is not the same as
 * knowing the reviewer is unlicensed -- the label has to say the former.
 */
export function reviewerIdentity(reviewer: Reviewer | null | undefined): ReviewerIdentity {
  const licenseNumber = trimmed(reviewer?.brokerLicenseNumber);
  return {
    capacity: licenseNumber === "" ? "OPERATOR" : "LICENSED_BROKER",
    licenseNumber: licenseNumber === "" ? null : licenseNumber,
    name: reviewerName(reviewer),
  };
}

export type ProvenanceKind =
  | "AI_PROPOSAL"
  | "OPERATOR_REVIEW"
  | "LICENSED_BROKER_REVIEW"
  | "REVIEWER_UNKNOWN";

export interface DecisionProvenance {
  kind: ProvenanceKind;
  name: string | null;
  licenseNumber: string | null;
  label: string;
}

export interface ProvenanceInput {
  reviewedByUserId?: string | null;
  reviewedByUser?: Reviewer | null;
}

/**
 * Status is deliberately ignored. A decision marked Approved with no reviewer on
 * the row was closed by machinery, and saying so is the honest answer.
 */
export function decisionProvenance(input: ProvenanceInput): DecisionProvenance {
  const reviewerId = trimmed(input.reviewedByUserId);

  if (reviewerId === "") {
    return {
      kind: "AI_PROPOSAL",
      name: null,
      licenseNumber: null,
      label: "Agent proposal. No person has reviewed it.",
    };
  }

  const reviewer = input.reviewedByUser;
  if (!reviewer) {
    return {
      kind: "REVIEWER_UNKNOWN",
      name: null,
      licenseNumber: null,
      label: "Reviewed by a person, but that user record is no longer available.",
    };
  }

  const identity = reviewerIdentity(reviewer);
  const who = identity.name ?? "a user whose name is not recorded";

  if (identity.capacity === "LICENSED_BROKER") {
    return {
      kind: "LICENSED_BROKER_REVIEW",
      name: identity.name,
      licenseNumber: identity.licenseNumber,
      label: `Reviewed by ${who}, licensed customs broker ${identity.licenseNumber}.`,
    };
  }

  return {
    kind: "OPERATOR_REVIEW",
    name: identity.name,
    licenseNumber: null,
    label: `Reviewed by ${who}. No customs broker license is on file for that user.`,
  };
}
