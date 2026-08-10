import { describe, it, expect } from "vitest";
import { reconcileShipment } from "@/modules/reconciliation/reconcileRules";
import type { ReconciliationDocument, ReconciliationInput } from "@/modules/reconciliation/reconcileRules";

function doc(docType: string, fields: Record<string, string>): ReconciliationDocument {
  return { id: `doc_${docType}`, docType, fields };
}

function input(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return { documents: [], lineItems: [], incoterm: null, ...overrides };
}

function detection(result: ReturnType<typeof reconcileShipment>, field: string) {
  return result.detections.find((d) => d.field === field);
}

describe("reconcileShipment cross-document rules", () => {
  it("reports a quantity mismatch between the invoice and the packing list", () => {
    const result = reconcileShipment(
      input({
        documents: [
          doc("Commercial Invoice", { totalQuantity: "20" }),
          doc("Packing List", { totalQuantity: "18" }),
        ],
      })
    );

    const found = detection(result, "quantity");
    expect(found?.severity).toBe("Warning");
    expect(found?.expectedValue).toContain("20");
    expect(found?.actualValue).toContain("18");
    expect(found?.sourceDocuments).toEqual(["Commercial Invoice", "Packing List"]);
  });

  it("does not report a mismatch when the same number is formatted differently", () => {
    const result = reconcileShipment(
      input({
        documents: [
          doc("Commercial Invoice", { totalValue: "13,400.00" }),
          doc("Arrival Notice", { totalValue: "USD 13400" }),
        ],
      })
    );

    expect(detection(result, "totalValue")).toBeUndefined();
    expect(result.evaluatedFields).toContain("totalValue");
  });

  it("treats a declared zero as a value, not as a missing field", () => {
    // A real value of 0 must remain 0. Reading it as absent would silently skip
    // the comparison and let a zero-value declaration through unchecked.
    const result = reconcileShipment(
      input({
        documents: [
          doc("Commercial Invoice", { totalValue: "0" }),
          doc("Arrival Notice", { totalValue: "13400" }),
        ],
      })
    );

    expect(result.evaluatedFields).toContain("totalValue");
    expect(detection(result, "totalValue")?.severity).toBe("Critical");
  });

  it("compares parties, containers, bill numbers, currency, and weight", () => {
    const result = reconcileShipment(
      input({
        documents: [
          doc("Commercial Invoice", {
            shipperName: "Shenzhen Optics Ltd",
            consigneeName: "Acme Imports",
            currency: "USD",
            grossWeight: "1200",
          }),
          doc("Bill of Lading", {
            shipperName: "Shenzhen Optics Limited",
            consigneeName: "Acme Imports",
            currency: "EUR",
            grossWeight: "1450",
            containerNumber: "MSKU1234567",
            billOfLadingNumber: "MAEU987654",
          }),
          doc("Arrival Notice", {
            containerNumber: "MSKU7654321",
            billOfLadingNumber: "MAEU987654",
          }),
        ],
      })
    );

    expect(detection(result, "shipper")).toBeDefined();
    expect(detection(result, "consignee")).toBeUndefined();
    expect(detection(result, "currency")?.severity).toBe("Critical");
    expect(detection(result, "weight")).toBeDefined();
    expect(detection(result, "container")?.severity).toBe("Critical");
    expect(detection(result, "billNumber")).toBeUndefined();
  });

  it("ignores case and spacing when comparing text", () => {
    const result = reconcileShipment(
      input({
        documents: [
          doc("Commercial Invoice", { consigneeName: "  Acme   Imports " }),
          doc("Bill of Lading", { consigneeName: "acme imports" }),
        ],
      })
    );

    expect(detection(result, "consignee")).toBeUndefined();
  });
});

describe("reconcileShipment honest skips", () => {
  it("skips a field only one document declares instead of passing it", () => {
    // One declaration agrees with itself. Counting that as a clean comparison
    // reports a check that never happened.
    const result = reconcileShipment(
      input({ documents: [doc("Commercial Invoice", { totalQuantity: "20" })] })
    );

    expect(detection(result, "quantity")).toBeUndefined();
    expect(result.evaluatedFields).not.toContain("quantity");
    expect(result.skippedChecks.some((s) => s.startsWith("quantity:"))).toBe(true);
  });

  it("skips a numeric field that cannot be read as a number", () => {
    const result = reconcileShipment(
      input({
        documents: [
          doc("Commercial Invoice", { grossWeight: "see attached" }),
          doc("Packing List", { grossWeight: "1200" }),
        ],
      })
    );

    expect(result.evaluatedFields).not.toContain("weight");
    expect(result.skippedChecks.some((s) => s.includes("Commercial Invoice"))).toBe(true);
  });

  it("reports only the missing documents when nothing is attached", async () => {
    const result = reconcileShipment(input());

    // Every comparison rule needs two declarations, so none of them can run.
    expect(result.detections.map((d) => d.field)).toEqual(["requiredDocuments"]);
    expect(result.evaluatedFields).toEqual(["requiredDocuments"]);
    expect(result.skippedChecks.length).toBeGreaterThan(0);
  });

  it("does not raise a document issue once every required type is attached", () => {
    const result = reconcileShipment(
      input({
        documents: [
          doc("Commercial Invoice", {}),
          doc("Packing List", {}),
          doc("Bill of Lading", {}),
        ],
      })
    );

    expect(detection(result, "requiredDocuments")).toBeUndefined();
  });
});

describe("reconcileShipment shipment-level rules", () => {
  it("flags a document incoterm that contradicts the shipment record", () => {
    const result = reconcileShipment(
      input({
        incoterm: "FOB",
        documents: [doc("Commercial Invoice", { incoterm: "CIF" })],
      })
    );

    const found = detection(result, "incotermOfRecord");
    expect(found?.expectedValue).toContain("FOB");
    expect(found?.actualValue).toContain("CIF");
    expect(found?.sourceDocuments).toContain("Shipment record");
  });

  it("accepts a document incoterm that matches the shipment record", () => {
    const result = reconcileShipment(
      input({ incoterm: "FOB", documents: [doc("Commercial Invoice", { incoterm: "fob" })] })
    );

    expect(detection(result, "incotermOfRecord")).toBeUndefined();
    expect(result.evaluatedFields).toContain("incotermOfRecord");
  });

  it("skips the incoterm rule when the shipment declares none", () => {
    const result = reconcileShipment(
      input({ incoterm: null, documents: [doc("Commercial Invoice", { incoterm: "CIF" })] })
    );

    expect(detection(result, "incotermOfRecord")).toBeUndefined();
    expect(result.skippedChecks.some((s) => s.startsWith("incotermOfRecord:"))).toBe(true);
  });

  it("flags line items that disagree on country of origin", () => {
    const result = reconcileShipment(
      input({
        lineItems: [
          { countryOfOrigin: "CN", description: "Sensor" },
          { countryOfOrigin: "VN", description: "Housing" },
        ],
      })
    );

    expect(detection(result, "country")?.severity).toBe("Critical");
    expect(detection(result, "country")?.actualValue).toBe("CN, VN");
  });

  it("flags line items that are missing a description", () => {
    const result = reconcileShipment(
      input({
        lineItems: [
          { countryOfOrigin: "CN", description: "Sensor" },
          { countryOfOrigin: "CN", description: "" },
        ],
      })
    );

    expect(detection(result, "description")?.actualValue).toBe("1 of 2 carry a description");
  });

  it("does not flag descriptions when every line item carries one", () => {
    const result = reconcileShipment(
      input({
        lineItems: [
          { countryOfOrigin: "CN", description: "Sensor" },
          { countryOfOrigin: "CN", description: "Housing" },
        ],
      })
    );

    expect(detection(result, "description")).toBeUndefined();
    expect(result.evaluatedFields).toContain("description");
  });
});
