import { describe, expect, it } from "vitest";
import {
  canApproveParty,
  canTransitionRegistration,
  canTransitionReview,
  canVerifyRegistration,
  effectiveRegistration,
} from "@/modules/party/partyDecisionLifecycle";

describe("party review transitions", () => {
  it("requires a party to be in review before it can be approved", () => {
    expect(canTransitionReview("UNREVIEWED", "APPROVED").allowed).toBe(false);
    expect(canTransitionReview("IN_REVIEW", "APPROVED").allowed).toBe(true);
  });

  it("explains a refused approval in terms of who reviewed it", () => {
    const check = canTransitionReview("UNREVIEWED", "APPROVED");
    expect(check.reason).toContain("in review first");
  });

  it("never lets a rejected party come back as approved directly", () => {
    expect(canTransitionReview("REJECTED", "APPROVED").allowed).toBe(false);
  });

  it("moves an approved party to NEEDS_REVIEW rather than back to IN_REVIEW directly", () => {
    expect(canTransitionReview("APPROVED", "IN_REVIEW").allowed).toBe(false);
    expect(canTransitionReview("APPROVED", "NEEDS_REVIEW").allowed).toBe(true);
  });

  it("treats a no-op transition as a refusal rather than a silent success", () => {
    expect(canTransitionReview("APPROVED", "APPROVED").allowed).toBe(false);
  });
});

describe("canApproveParty", () => {
  const base = {
    currentStatus: "IN_REVIEW" as const,
    reviewerUserId: "user_1",
    reviewerCanApprove: true,
  };

  it("approves for a permitted, identified reviewer on a party in review", () => {
    expect(canApproveParty(base).allowed).toBe(true);
  });

  it("refuses without the approve permission", () => {
    const check = canApproveParty({ ...base, reviewerCanApprove: false });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("parties.review.approve");
  });

  it("refuses without an identified reviewer", () => {
    expect(canApproveParty({ ...base, reviewerUserId: null }).allowed).toBe(false);
  });

  it("has no branch for an automated approval, however confident", () => {
    // There is no `source` or `confidence` parameter. The only way to get
    // `allowed: true` is a permitted human reviewer on a party already in review.
    const check = canApproveParty({ ...base, currentStatus: "UNREVIEWED", reviewerUserId: null });
    expect(check.allowed).toBe(false);
  });
});

describe("registration transitions", () => {
  it("requires a review before a claim can be verified", () => {
    expect(canTransitionRegistration("CLAIMED", "VERIFIED").allowed).toBe(false);
    expect(canTransitionRegistration("CLAIMED", "UNDER_REVIEW").allowed).toBe(true);
    expect(canTransitionRegistration("UNDER_REVIEW", "VERIFIED").allowed).toBe(true);
  });

  it("explains the refusal by pointing at the missing review step", () => {
    expect(canTransitionRegistration("CLAIMED", "VERIFIED").reason).toContain("reviewed against its evidence");
  });

  it("lets a verified registration be reopened but never resurrected from superseded", () => {
    expect(canTransitionRegistration("VERIFIED", "UNDER_REVIEW").allowed).toBe(true);
    expect(canTransitionRegistration("SUPERSEDED", "VERIFIED").allowed).toBe(false);
    expect(canTransitionRegistration("SUPERSEDED", "UNDER_REVIEW").allowed).toBe(false);
  });
});

describe("canVerifyRegistration", () => {
  const base = {
    currentStatus: "UNDER_REVIEW" as const,
    verifiedByUserId: "user_1",
    evidenceId: "evidence_1",
    verifierCanVerify: true,
  };

  it("verifies for a permitted, identified reviewer with evidence attached", () => {
    expect(canVerifyRegistration(base).allowed).toBe(true);
  });

  it("refuses without the verify permission", () => {
    const check = canVerifyRegistration({ ...base, verifierCanVerify: false });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("parties.registration.verify");
  });

  it("refuses without an identified reviewer", () => {
    expect(canVerifyRegistration({ ...base, verifiedByUserId: null }).allowed).toBe(false);
  });

  it("refuses without evidence, however confident the reviewer is — this is the concrete anti-fabrication gate", () => {
    const check = canVerifyRegistration({ ...base, evidenceId: null });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("evidence");
  });

  it("refuses a claimed registration that skipped review, even with evidence and a reviewer", () => {
    expect(canVerifyRegistration({ ...base, currentStatus: "CLAIMED" }).allowed).toBe(false);
  });
});

describe("effectiveRegistration", () => {
  const at = new Date("2026-06-01T00:00:00Z");
  const row = (overrides: Partial<Parameters<typeof effectiveRegistration>[0][number]> = {}) => ({
    id: "reg_1",
    country: "DE",
    status: "VERIFIED" as const,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    ...overrides,
  });

  it("returns the verified row in force for the country", () => {
    const result = effectiveRegistration([row()], "DE", at);
    expect(result.effective?.id).toBe("reg_1");
    expect(result.conflicting).toBe(false);
  });

  it("ignores a claimed, under-review, or rejected registration", () => {
    for (const status of ["CLAIMED", "UNDER_REVIEW", "REJECTED"] as const) {
      expect(effectiveRegistration([row({ status })], "DE", at).effective).toBeNull();
    }
  });

  it("never answers for a country it was not asked about", () => {
    expect(effectiveRegistration([row()], "FR", at).effective).toBeNull();
  });

  it("ignores a row that has not started or has already ended", () => {
    expect(effectiveRegistration([row({ effectiveFrom: new Date("2026-12-01T00:00:00Z") })], "DE", at).effective).toBeNull();
    expect(effectiveRegistration([row({ effectiveTo: new Date("2026-03-01T00:00:00Z") })], "DE", at).effective).toBeNull();
  });

  it("flags an overlap rather than hiding it behind a winner", () => {
    const result = effectiveRegistration(
      [row(), row({ id: "reg_2", effectiveFrom: new Date("2026-04-01T00:00:00Z") })],
      "DE",
      at
    );
    expect(result.effective?.id).toBe("reg_2");
    expect(result.conflicting).toBe(true);
  });
});
