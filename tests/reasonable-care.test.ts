import { describe, expect, it } from "vitest";
import { evaluateReasonableCare } from "@/modules/compliance/reasonableCare";

const base = {
  lineItems: [{ htsCode: "8481.80.5090", countryOfOrigin: "DE" }],
  documents: [{ status: "Received" }],
  totalValue: 1000,
  auditLogCount: 3,
};

const itemNamed = (result: ReturnType<typeof evaluateReasonableCare>, fragment: string) =>
  result.checklistItems.find((c) => c.item.includes(fragment))!;

describe("evaluateReasonableCare", () => {
  it("never auto-passes recordkeeping when no audit entries exist", () => {
    const result = evaluateReasonableCare({ ...base, auditLogCount: 0 });
    const item = itemNamed(result, "Recordkeeping");
    expect(item.result).toBe("Fail");
    expect(result.overallResult).toBe("Fail");
  });

  it("reports PGA applicability as not evaluated rather than passing on document count", () => {
    const result = evaluateReasonableCare(base);
    const item = itemNamed(result, "Partner Government Agency");
    expect(item.result).toBe("NotEvaluated");
    expect(item.evidence).toContain("not determined by this system");
  });

  it("excludes not-evaluated checks from the score denominator", () => {
    const result = evaluateReasonableCare(base);
    expect(result.evaluatedCount).toBe(4);
    expect(result.checklistItems).toHaveLength(5);
  });

  it("scores zero and passes when every performed check passes", () => {
    const result = evaluateReasonableCare(base);
    expect(result.overallResult).toBe("Pass");
    expect(result.riskScore).toBe(0);
  });

  it("fails classification when any line item lacks an HTS code", () => {
    const result = evaluateReasonableCare({
      ...base,
      lineItems: [
        { htsCode: "8481.80.5090", countryOfOrigin: "DE" },
        { htsCode: null, countryOfOrigin: "DE" },
      ],
    });
    const item = itemNamed(result, "HTS classification");
    expect(item.result).toBe("Fail");
    expect(item.evidence).toBe("1 of 2 line items have an HTS code assigned.");
  });

  it("flags classified codes that are not ten digits for review", () => {
    const result = evaluateReasonableCare({
      ...base,
      lineItems: [{ htsCode: "8481.80", countryOfOrigin: "DE" }],
    });
    expect(itemNamed(result, "HTS classification").result).toBe("NeedsReview");
  });

  it("does not claim the declared value was reconciled against an invoice", () => {
    const item = itemNamed(evaluateReasonableCare(base), "Declared customs value");
    expect(item.evidence).toContain("Not reconciled against invoice");
  });

  it("treats an absent customs value as needing review, not as a pass", () => {
    const result = evaluateReasonableCare({ ...base, totalValue: null });
    expect(itemNamed(result, "Declared customs value").result).toBe("NeedsReview");
    expect(result.overallResult).toBe("NeedsReview");
  });

  it("keeps a declared value of zero distinct from an absent one", () => {
    const zero = itemNamed(evaluateReasonableCare({ ...base, totalValue: 0 }), "Declared customs value");
    expect(zero.evidence).toContain("0.00");
    const absent = itemNamed(evaluateReasonableCare({ ...base, totalValue: null }), "Declared customs value");
    expect(absent.evidence).toBe("No customs value has been declared.");
  });

  it("reports partial origin coverage with real counts", () => {
    const result = evaluateReasonableCare({
      ...base,
      lineItems: [
        { htsCode: "8481.80.5090", countryOfOrigin: "DE" },
        { htsCode: "8481.80.5090", countryOfOrigin: null },
      ],
    });
    const item = itemNamed(result, "Country of origin");
    expect(item.result).toBe("NeedsReview");
    expect(item.evidence).toBe("1 of 2 line items declare a country of origin.");
  });

  it("derives the score from failed checks instead of a fixed constant", () => {
    const oneFail = evaluateReasonableCare({ ...base, auditLogCount: 0 });
    expect(oneFail.riskScore).toBe(25);

    const oneReview = evaluateReasonableCare({ ...base, totalValue: null });
    expect(oneReview.riskScore).toBe(13);
  });

  it("marks line-item checks as not evaluated when the filing has no line items", () => {
    const result = evaluateReasonableCare({ ...base, lineItems: [] });
    expect(itemNamed(result, "HTS classification").result).toBe("NotEvaluated");
    expect(itemNamed(result, "Country of origin").result).toBe("NotEvaluated");
    expect(result.evaluatedCount).toBe(2);
  });
});
