import { describe, expect, it } from "vitest";
import {
  EFFECTIVE_CLASSIFICATION_STATUSES,
  FORBIDDEN_ORIGIN_INFERENCE_SOURCES,
  NON_BINDING_CLASSIFICATION_STATUSES,
  OriginInferenceError,
  assertOriginNotInferred,
  canApproveClassification,
  canTransitionClassification,
  canTransitionCountryFact,
  classificationIdentity,
  effectiveClassification,
  initialClassificationStatus,
} from "@/modules/product/productDecisionLifecycle";

describe("classification transitions", () => {
  it("requires a code to be proposed and reviewed before it can be approved", () => {
    expect(canTransitionClassification("CANDIDATE", "APPROVED").allowed).toBe(false);
    expect(canTransitionClassification("PROPOSED", "APPROVED").allowed).toBe(false);
    expect(canTransitionClassification("UNDER_REVIEW", "APPROVED").allowed).toBe(true);
  });

  it("explains a refused approval in terms of the record it protects", () => {
    const check = canTransitionClassification("CANDIDATE", "APPROVED");
    expect(check.reason).toContain("proposed and reviewed");
  });

  it("never lets a rejected or superseded row come back as approved", () => {
    expect(canTransitionClassification("REJECTED", "APPROVED").allowed).toBe(false);
    expect(canTransitionClassification("SUPERSEDED", "APPROVED").allowed).toBe(false);
    expect(canTransitionClassification("EXPIRED", "APPROVED").allowed).toBe(false);
  });

  it("treats a no-op transition as a refusal rather than a silent success", () => {
    expect(canTransitionClassification("APPROVED", "APPROVED").allowed).toBe(false);
  });

  it("counts only APPROVED as a live customs position", () => {
    expect(EFFECTIVE_CLASSIFICATION_STATUSES).toEqual(["APPROVED"]);
    expect(NON_BINDING_CLASSIFICATION_STATUSES).not.toContain("APPROVED");
    expect(NON_BINDING_CLASSIFICATION_STATUSES).toContain("CANDIDATE");
    expect(NON_BINDING_CLASSIFICATION_STATUSES).toContain("PROPOSED");
    expect(NON_BINDING_CLASSIFICATION_STATUSES).toContain("UNDER_REVIEW");
  });
});

describe("canApproveClassification", () => {
  const base = {
    currentStatus: "UNDER_REVIEW" as const,
    reviewerUserId: "user_1",
    reviewerCanApprove: true,
    proposedByUserId: "user_2",
  };

  it("approves for a permitted, identified reviewer on a reviewed row", () => {
    expect(canApproveClassification(base).allowed).toBe(true);
  });

  it("refuses without the approve permission", () => {
    const check = canApproveClassification({ ...base, reviewerCanApprove: false });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("products.classification.approve");
  });

  it("refuses without an identified reviewer", () => {
    expect(canApproveClassification({ ...base, reviewerUserId: null }).allowed).toBe(false);
  });

  it("has no branch for an automated approval, however confident", () => {
    // There is no `source`, `confidence`, or `agent` parameter to pass. The only
    // way to get `allowed: true` is a permitted human reviewer on a reviewed row.
    const check = canApproveClassification({
      ...base,
      currentStatus: "CANDIDATE",
      reviewerUserId: null,
      reviewerCanApprove: true,
    });
    expect(check.allowed).toBe(false);
  });

  it("enforces four-eyes when the account asks for it", () => {
    const sameUser = canApproveClassification({
      ...base,
      proposedByUserId: "user_1",
      requireSeparateReviewer: true,
    });
    expect(sameUser.allowed).toBe(false);
    expect(sameUser.reason).toContain("different person");

    const otherUser = canApproveClassification({ ...base, requireSeparateReviewer: true });
    expect(otherUser.allowed).toBe(true);
  });
});

describe("initialClassificationStatus", () => {
  it("starts an agent proposal and an import as CANDIDATE", () => {
    expect(initialClassificationStatus("AGENT_PROPOSED")).toBe("CANDIDATE");
    expect(initialClassificationStatus("IMPORT")).toBe("CANDIDATE");
  });

  it("starts a person's entry as PROPOSED, never APPROVED", () => {
    expect(initialClassificationStatus("MANUAL")).toBe("PROPOSED");
    expect(initialClassificationStatus("RULING_BASED")).toBe("PROPOSED");
  });

  it("cannot produce APPROVED for any method", () => {
    for (const method of ["MANUAL", "RULING_BASED", "AGENT_PROPOSED", "IMPORT"] as const) {
      expect(initialClassificationStatus(method)).not.toBe("APPROVED");
    }
  });
});

describe("classificationIdentity", () => {
  it("keeps the same digits in different jurisdictions apart", () => {
    const us = classificationIdentity({
      jurisdiction: "US",
      nomenclature: "HTSUS",
      normalizedCode: "8471300000",
    });
    const eu = classificationIdentity({
      jurisdiction: "EU",
      nomenclature: "CN",
      normalizedCode: "8471300000",
    });
    expect(us).not.toBe(eu);
  });

  it("keeps the same digits under different nomenclatures apart", () => {
    expect(
      classificationIdentity({ jurisdiction: "US", nomenclature: "HS", normalizedCode: "847130" })
    ).not.toBe(
      classificationIdentity({ jurisdiction: "US", nomenclature: "HTSUS", normalizedCode: "847130" })
    );
  });
});

describe("effectiveClassification", () => {
  const at = new Date("2026-06-01T00:00:00Z");
  const row = (overrides: Partial<Parameters<typeof effectiveClassification>[0][number]> = {}) => ({
    id: "cls_1",
    jurisdiction: "US",
    nomenclature: "HTSUS",
    status: "APPROVED" as const,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    ...overrides,
  });

  it("returns the approved row in force for the jurisdiction", () => {
    const result = effectiveClassification([row()], "US", at);
    expect(result.effective?.id).toBe("cls_1");
    expect(result.conflicting).toBe(false);
  });

  it("ignores a candidate, a proposal, and a row under review", () => {
    for (const status of ["CANDIDATE", "PROPOSED", "UNDER_REVIEW", "REJECTED"] as const) {
      expect(effectiveClassification([row({ status })], "US", at).effective).toBeNull();
    }
  });

  it("never answers for a jurisdiction it was not asked about", () => {
    expect(effectiveClassification([row()], "EU", at).effective).toBeNull();
  });

  it("ignores a row that has not started or has already ended", () => {
    expect(
      effectiveClassification([row({ effectiveFrom: new Date("2026-12-01T00:00:00Z") })], "US", at)
        .effective
    ).toBeNull();
    expect(
      effectiveClassification([row({ effectiveTo: new Date("2026-03-01T00:00:00Z") })], "US", at)
        .effective
    ).toBeNull();
  });

  it("flags an overlap rather than hiding it behind a winner", () => {
    const result = effectiveClassification(
      [row(), row({ id: "cls_2", effectiveFrom: new Date("2026-04-01T00:00:00Z") })],
      "US",
      at
    );
    expect(result.effective?.id).toBe("cls_2");
    expect(result.conflicting).toBe(true);
  });
});

describe("country fact transitions", () => {
  it("requires a review before a claim can be verified", () => {
    expect(canTransitionCountryFact("CLAIMED", "VERIFIED").allowed).toBe(false);
    expect(canTransitionCountryFact("CLAIMED", "UNDER_REVIEW").allowed).toBe(true);
    expect(canTransitionCountryFact("UNDER_REVIEW", "VERIFIED").allowed).toBe(true);
  });

  it("explains the refusal by pointing at the evidence", () => {
    expect(canTransitionCountryFact("CLAIMED", "VERIFIED").reason).toContain("evidence");
  });

  it("lets a verified fact be reopened but never resurrected from superseded", () => {
    expect(canTransitionCountryFact("VERIFIED", "UNDER_REVIEW").allowed).toBe(true);
    expect(canTransitionCountryFact("SUPERSEDED", "VERIFIED").allowed).toBe(false);
  });
});

describe("assertOriginNotInferred", () => {
  it("rejects every forbidden basis, however it is spelled", () => {
    for (const source of FORBIDDEN_ORIGIN_INFERENCE_SOURCES) {
      expect(() => assertOriginNotInferred(source)).toThrow(OriginInferenceError);
      expect(() => assertOriginNotInferred(source.toLowerCase().replace(/_/g, " "))).toThrow(
        OriginInferenceError
      );
      expect(() => assertOriginNotInferred(source.toLowerCase().replace(/_/g, "-"))).toThrow(
        OriginInferenceError
      );
    }
  });

  it("names manufacturer address, supplier, seller, export and shipping origin among them", () => {
    expect(FORBIDDEN_ORIGIN_INFERENCE_SOURCES).toContain("MANUFACTURER_ADDRESS");
    expect(FORBIDDEN_ORIGIN_INFERENCE_SOURCES).toContain("SUPPLIER_COUNTRY");
    expect(FORBIDDEN_ORIGIN_INFERENCE_SOURCES).toContain("SELLER_COUNTRY");
    expect(FORBIDDEN_ORIGIN_INFERENCE_SOURCES).toContain("EXPORT_COUNTRY");
    expect(FORBIDDEN_ORIGIN_INFERENCE_SOURCES).toContain("SHIPPING_ORIGIN");
  });

  it("says why, rather than only that it refused", () => {
    const error = (() => {
      try {
        assertOriginNotInferred("SUPPLIER_COUNTRY");
        return null;
      } catch (caught) {
        return caught as OriginInferenceError;
      }
    })();
    expect(error?.message).toContain("legal determination");
  });

  it("allows a basis that is a rule of origin rather than an address field", () => {
    expect(() => assertOriginNotInferred("CTH_RULE_APPLIED_BY_ANALYST")).not.toThrow();
    expect(() => assertOriginNotInferred("SUPPLIER_DECLARATION_DOCUMENT")).not.toThrow();
  });
});
