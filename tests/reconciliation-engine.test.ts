import { describe, it, expect } from "vitest";
import { runReconciliationEngine, type DocumentGroup } from "@/lib/reconciliation/reconciliationEngine";

function makeGroup(docType: string, fields: Record<string, string>, id?: string): DocumentGroup {
  return {
    documentId: id ?? `doc_${docType.replace(/\s/g, "_")}`,
    docType,
    fields: Object.entries(fields).map(([fieldName, value]) => ({ fieldName, value })),
  };
}

describe("runReconciliationEngine — quantity discrepancies", () => {
  it("creates a BLOCKING result when invoice and packing list quantities differ", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { totalQuantity: "100" }),
      makeGroup("Packing List", { totalQuantity: "95" }),
    ]);

    const hit = results.find((r) => r.ruleId === "QTY_INV_PACK");
    expect(hit).toBeDefined();
    expect(hit?.match).toBe(false);
    expect(hit?.severity).toBe("BLOCKING");
    expect(hit?.discrepancyType).toBe("QUANTITY");
  });

  it("produces no result when invoice and packing list quantities match", () => {
    const { results, evaluatedRuleIds } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { totalQuantity: "100" }),
      makeGroup("Packing List", { totalQuantity: "100" }),
    ]);

    expect(results.find((r) => r.ruleId === "QTY_INV_PACK")).toBeUndefined();
    expect(evaluatedRuleIds).toContain("QTY_INV_PACK");
  });

  it("tolerates 5% difference between invoice and BL quantity without raising a result", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { totalQuantity: "100" }),
      makeGroup("Bill of Lading", { totalQuantity: "97" }),
    ]);

    expect(results.find((r) => r.ruleId === "QTY_INV_BL")).toBeUndefined();
  });

  it("raises a WARNING (not BLOCKING) when invoice and BL quantities exceed 5% tolerance", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { totalQuantity: "100" }),
      makeGroup("Bill of Lading", { totalQuantity: "80" }),
    ]);

    const hit = results.find((r) => r.ruleId === "QTY_INV_BL");
    expect(hit?.severity).toBe("WARNING");
  });
});

describe("runReconciliationEngine — party name normalization", () => {
  it("does not flag a party match when only casing and punctuation differ", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { shipperName: "Shenzhen Optics Ltd." }),
      makeGroup("Bill of Lading", { shipperName: "shenzhen optics ltd" }),
    ]);

    expect(results.find((r) => r.ruleId === "SHIPPER_INV_BL")).toBeUndefined();
  });

  it("flags shipper when names genuinely differ", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { shipperName: "Shenzhen Optics Ltd" }),
      makeGroup("Bill of Lading", { shipperName: "Guangdong Electronics Corp" }),
    ]);

    const hit = results.find((r) => r.ruleId === "SHIPPER_INV_BL");
    expect(hit).toBeDefined();
    expect(hit?.discrepancyType).toBe("PARTY");
  });
});

describe("runReconciliationEngine — container ID normalization", () => {
  it("creates a BLOCKING result when BL and packing list container numbers differ", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Bill of Lading", { containerNumber: "MSKU 1234567" }),
      makeGroup("Packing List", { containerNumber: "MSKU7654321" }),
    ]);

    const hit = results.find((r) => r.ruleId === "CONTAINER_BL_PACK");
    expect(hit?.severity).toBe("BLOCKING");
    expect(hit?.discrepancyType).toBe("CONTAINER");
  });

  it("ignores spaces and case when container IDs are equivalent", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Bill of Lading", { containerNumber: "MSKU 1234567" }),
      makeGroup("Packing List", { containerNumber: "msku1234567" }),
    ]);

    expect(results.find((r) => r.ruleId === "CONTAINER_BL_PACK")).toBeUndefined();
  });
});

describe("runReconciliationEngine — value tolerance", () => {
  it("does not flag invoice vs packing list value within 2% tolerance", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { totalValue: "10000.00" }),
      makeGroup("Packing List", { totalValue: "USD 10,150" }),
    ]);

    expect(results.find((r) => r.ruleId === "VAL_INV_PACK")).toBeUndefined();
  });

  it("flags BLOCKING when invoice and packing list value exceed 2% tolerance", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { totalValue: "10000" }),
      makeGroup("Packing List", { totalValue: "9000" }),
    ]);

    const hit = results.find((r) => r.ruleId === "VAL_INV_PACK");
    expect(hit?.severity).toBe("BLOCKING");
    expect(hit?.discrepancyType).toBe("VALUE");
  });
});

describe("runReconciliationEngine — skips", () => {
  it("skips a rule when the required document type is not present", () => {
    const { skippedRuleIds } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { totalQuantity: "100" }),
      // No Packing List
    ]);

    expect(skippedRuleIds).toContain("QTY_INV_PACK");
  });

  it("skips a rule when neither document has extracted the required field", () => {
    const { skippedRuleIds } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { invoiceNumber: "INV-001" }),
      makeGroup("Packing List", { invoiceNumber: "INV-001" }),
      // totalQuantity not in either
    ]);

    expect(skippedRuleIds).toContain("QTY_INV_PACK");
  });

  it("skips a rule when both matches resolve to the same document", () => {
    // "Commercial Invoice" matches both "Invoice" and some rules' docTypeB
    // patterns. If a rule requires docTypeA=Invoice and docTypeB=Packing,
    // and only a Commercial Invoice exists, the rule should be skipped.
    const { skippedRuleIds } = runReconciliationEngine([
      makeGroup("Commercial Invoice", { totalQuantity: "100" }),
    ]);

    expect(skippedRuleIds).toContain("QTY_INV_PACK");
  });
});

describe("runReconciliationEngine — origin", () => {
  it("creates a BLOCKING result when CoO country differs from invoice country of origin", () => {
    const { results } = runReconciliationEngine([
      makeGroup("Certificate of Origin", { countryOfOrigin: "CN" }),
      makeGroup("Commercial Invoice", { countryOfOrigin: "VN" }),
    ]);

    const hit = results.find((r) => r.ruleId === "ORIGIN_COO_INV");
    expect(hit?.severity).toBe("BLOCKING");
    expect(hit?.discrepancyType).toBe("ORIGIN");
  });

  it("passes when CoO and invoice agree on country of origin", () => {
    const { results, evaluatedRuleIds } = runReconciliationEngine([
      makeGroup("Certificate of Origin", { countryOfOrigin: "CN" }),
      makeGroup("Commercial Invoice", { countryOfOrigin: "cn" }), // lowercase
    ]);

    expect(results.find((r) => r.ruleId === "ORIGIN_COO_INV")).toBeUndefined();
    expect(evaluatedRuleIds).toContain("ORIGIN_COO_INV");
  });
});
