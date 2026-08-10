import { describe, it, expect } from "vitest";
import {
  APPROVE_PERMISSION,
  OVERRIDE_PERMISSION,
  checkReviewPermission,
  decisionProvenance,
  isClassificationOverride,
  isReviewAction,
  permissionDeniedMessage,
  requiredPermissions,
  reviewerIdentity,
  reviewerName,
} from "@/modules/decisions/reviewAuthority";

describe("isReviewAction", () => {
  it("accepts the three review actions", () => {
    expect(isReviewAction("APPROVE")).toBe(true);
    expect(isReviewAction("REJECT")).toBe(true);
    expect(isReviewAction("RE_EVALUATE")).toBe(true);
  });

  it("rejects anything else, including inherited Object keys", () => {
    expect(isReviewAction("ESCALATE")).toBe(false);
    expect(isReviewAction("toString")).toBe(false);
    expect(isReviewAction("constructor")).toBe(false);
    expect(isReviewAction(undefined)).toBe(false);
  });
});

describe("isClassificationOverride", () => {
  it("is an override when a code already on the record is replaced", () => {
    expect(
      isClassificationOverride({ currentHtsCode: "8481.80.5090", proposedHtsCode: "8537.10.2030" })
    ).toBe(true);
  });

  it("is not an override when nothing was classified before", () => {
    expect(isClassificationOverride({ currentHtsCode: null, proposedHtsCode: "8537.10.2030" })).toBe(
      false
    );
    expect(isClassificationOverride({ currentHtsCode: "  ", proposedHtsCode: "8537.10.2030" })).toBe(
      false
    );
  });

  it("is not an override when the agent proposes the code already on file", () => {
    expect(
      isClassificationOverride({ currentHtsCode: "8537.10.2030", proposedHtsCode: "8537.10.2030" })
    ).toBe(false);
  });

  it("is not an override when the decision proposes no code at all", () => {
    expect(isClassificationOverride({ currentHtsCode: "8537.10.2030", proposedHtsCode: null })).toBe(
      false
    );
  });
});

describe("requiredPermissions", () => {
  it("asks only for the base permission on a first classification", () => {
    expect(requiredPermissions("APPROVE")).toEqual([APPROVE_PERMISSION]);
  });

  it("adds the override permission when an approval replaces a filed code", () => {
    expect(requiredPermissions("APPROVE", true)).toEqual([APPROVE_PERMISSION, OVERRIDE_PERMISSION]);
  });

  it("does not treat a rejection or a re-evaluation as an override", () => {
    expect(requiredPermissions("REJECT", true)).toEqual(["decisions.reject"]);
    expect(requiredPermissions("RE_EVALUATE", true)).toEqual(["decisions.reevaluate"]);
  });
});

describe("checkReviewPermission", () => {
  it("allows a role that holds every required permission", () => {
    const check = checkReviewPermission(
      { roleNames: ["MEMBER"], permissions: [APPROVE_PERMISSION, OVERRIDE_PERMISSION] },
      [APPROVE_PERMISSION, OVERRIDE_PERMISSION]
    );
    expect(check.allowed).toBe(true);
    expect(check.missing).toEqual([]);
    expect(check.bypass).toBeNull();
  });

  it("names the permission that is missing rather than failing silently", () => {
    const check = checkReviewPermission({ roleNames: ["MEMBER"], permissions: [APPROVE_PERMISSION] }, [
      APPROVE_PERMISSION,
      OVERRIDE_PERMISSION,
    ]);
    expect(check.allowed).toBe(false);
    expect(check.missing).toEqual([OVERRIDE_PERMISSION]);
    expect(permissionDeniedMessage(check)).toContain(OVERRIDE_PERMISSION);
  });

  it("denies a caller whose permissions were never loaded", () => {
    expect(checkReviewPermission({ roleNames: ["MEMBER"] }, [APPROVE_PERMISSION]).allowed).toBe(false);
    expect(
      checkReviewPermission({ roleNames: ["MEMBER"], permissions: null }, [APPROVE_PERMISSION]).allowed
    ).toBe(false);
  });

  it("records which bypass let a platform admin or an OWNER through", () => {
    expect(
      checkReviewPermission({ roleNames: ["VIEWER"], isPlatformAdmin: true }, [OVERRIDE_PERMISSION])
    ).toMatchObject({ allowed: true, bypass: "PLATFORM_ADMIN" });
    expect(checkReviewPermission({ roleNames: ["OWNER"] }, [OVERRIDE_PERMISSION])).toMatchObject({
      allowed: true,
      bypass: "OWNER",
    });
  });
});

describe("reviewerName", () => {
  it("prefers the person's name, falls back to the email, then to nothing", () => {
    expect(reviewerName({ firstName: "Jane", lastName: "Broker" })).toBe("Jane Broker");
    expect(reviewerName({ firstName: null, lastName: null, email: "j@example.com" })).toBe(
      "j@example.com"
    );
    expect(reviewerName({ firstName: "  ", lastName: "  ", email: "  " })).toBeNull();
    expect(reviewerName(null)).toBeNull();
  });
});

describe("reviewerIdentity", () => {
  it("reads a stored licence number as broker capacity", () => {
    expect(reviewerIdentity({ brokerLicenseNumber: "CHB-24815" })).toMatchObject({
      capacity: "LICENSED_BROKER",
      licenseNumber: "CHB-24815",
    });
  });

  it("treats a blank licence column as no licence on file, not as a licence", () => {
    expect(reviewerIdentity({ brokerLicenseNumber: "   " })).toMatchObject({
      capacity: "OPERATOR",
      licenseNumber: null,
    });
    expect(reviewerIdentity(null)).toMatchObject({ capacity: "OPERATOR", licenseNumber: null });
  });
});

describe("decisionProvenance", () => {
  it("says no person has reviewed an untouched agent proposal", () => {
    const p = decisionProvenance({ reviewedByUserId: null });
    expect(p.kind).toBe("AI_PROPOSAL");
    expect(p.label).toBe("Agent proposal. No person has reviewed it.");
  });

  it("distinguishes a licensed broker sign-off and quotes the licence", () => {
    const p = decisionProvenance({
      reviewedByUserId: "u_1",
      reviewedByUser: { firstName: "Jane", lastName: "Broker", brokerLicenseNumber: "CHB-24815" },
    });
    expect(p.kind).toBe("LICENSED_BROKER_REVIEW");
    expect(p.licenseNumber).toBe("CHB-24815");
    expect(p.label).toBe("Reviewed by Jane Broker, licensed customs broker CHB-24815.");
  });

  it("distinguishes an operator review and does not imply the person is unlicensed", () => {
    const p = decisionProvenance({
      reviewedByUserId: "u_2",
      reviewedByUser: { firstName: "Sam", lastName: "Operator", brokerLicenseNumber: null },
    });
    expect(p.kind).toBe("OPERATOR_REVIEW");
    expect(p.licenseNumber).toBeNull();
    expect(p.label).toBe(
      "Reviewed by Sam Operator. No customs broker license is on file for that user."
    );
  });

  it("does not guess a capacity when the reviewer row was not loaded", () => {
    const p = decisionProvenance({ reviewedByUserId: "u_3" });
    expect(p.kind).toBe("REVIEWER_UNKNOWN");
    expect(p.licenseNumber).toBeNull();
  });

  it("reports an Approved decision with no reviewer as an agent proposal", () => {
    // Status is not evidence of review: only the reviewer column is.
    const p = decisionProvenance({ reviewedByUserId: null, reviewedByUser: null });
    expect(p.kind).toBe("AI_PROPOSAL");
  });
});
