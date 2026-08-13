import { describe, it, expect } from "vitest";
import {
  buildForm7501,
  type FilingHeaderInput,
  type LineItemInput,
} from "@/lib/filing/form7501";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function baseHeader(overrides: Partial<FilingHeaderInput> = {}): FilingHeaderInput {
  return {
    id: "filing_1",
    entryNumber: "DFT-SHP001-ABCDEF12",
    entryType: "01",
    importerName: "Acme Imports LLC",
    importerCbpNumber: "123456789",
    importerOfRecordId: "ior_1",
    bondNumber: "BND-500123",
    bondId: "bond_1",
    portOfEntry: "Port of Los Angeles (2704)",
    countryOfExport: "Germany",
    carrierName: "Maersk Line",
    ...overrides,
  };
}

function baseLineItem(overrides: Partial<LineItemInput> = {}): LineItemInput {
  return {
    id: "line_1",
    lineNumber: 1,
    description: "Industrial valves",
    htsCode: "8481.80.5090",
    quantity: 100,
    unitPrice: 50,
    totalValue: 5000,
    countryOfOrigin: "Germany",
    dutyRateDecimal: 0.05, // 5%
    htsReleaseId: "hts_rel_2026_q1",
    ...overrides,
  };
}

// ── Required blocks coverage ───────────────────────────────────────────────────

describe("form7501 field mapping — required blocks", () => {
  it("covers all required header blocks with correct sources", () => {
    const result = buildForm7501(baseHeader(), [baseLineItem()], "hts_rel_2026_q1");

    expect(result.entryType.block).toBe("1");
    expect(result.entryType.value).toBe("01");
    expect(result.entryType.provenance.sourceModel).toBe("CustomsFiling");

    expect(result.entryNumber.block).toBe("2");
    expect(result.importerName.block).toBe("25");
    expect(result.importerNumber.block).toBe("23");
    expect(result.bondNumber.block).toBe("4");
    expect(result.portCode.block).toBe("45");
    expect(result.countryOfExport.block).toBe("14");
    expect(result.carrier.block).toBe("8");
    expect(result.totalEnteredValue.block).toBe("40");
    expect(result.totalDuty.block).toBe("43");
  });

  it("covers all required per-line blocks", () => {
    const result = buildForm7501(baseHeader(), [baseLineItem()], "hts_rel_2026_q1");
    const li = result.lineItems[0];

    expect(li.description.block).toBe("28");
    expect(li.htsCode.block).toBe("33");
    expect(li.enteredValue.block).toBe("29");
    expect(li.dutyRate.block).toBe("34");
    expect(li.dutyAmount.block).toBe("35");
    expect(li.countryOfOrigin.block).toBe("10");
    expect(li.quantity.block).toBe("27");
  });
});

// ── Decimal arithmetic ─────────────────────────────────────────────────────────

describe("form7501 arithmetic — Decimal precision", () => {
  it("computes Block 35 as Block 29 × Block 34 rounded to cents", () => {
    const result = buildForm7501(
      baseHeader(),
      [baseLineItem({ totalValue: 412500, dutyRateDecimal: 0.059 })],
      "hts_rel_2026_q1"
    );
    const li = result.lineItems[0];
    // 412500 × 0.059 = 24337.50
    expect(li.dutyAmount.value).toBeCloseTo(24337.5, 2);
  });

  it("Block 40 is the exact Decimal sum of all Block 29 values", () => {
    const lines: LineItemInput[] = [
      baseLineItem({ id: "l1", lineNumber: 1, totalValue: 100.10, dutyRateDecimal: 0.05 }),
      baseLineItem({ id: "l2", lineNumber: 2, totalValue: 200.20, dutyRateDecimal: 0.05 }),
      baseLineItem({ id: "l3", lineNumber: 3, totalValue: 300.30, dutyRateDecimal: 0.05 }),
    ];
    const result = buildForm7501(baseHeader(), lines, "hts_rel_2026_q1");
    // 100.10 + 200.20 + 300.30 = 600.60
    expect(result.totalEnteredValue.value).toBeCloseTo(600.6, 2);
  });

  it("Block 43 is the Decimal sum of all Block 35 values", () => {
    const lines: LineItemInput[] = [
      baseLineItem({ id: "l1", lineNumber: 1, totalValue: 1000, dutyRateDecimal: 0.05 }),
      baseLineItem({ id: "l2", lineNumber: 2, totalValue: 2000, dutyRateDecimal: 0.1 }),
    ];
    const result = buildForm7501(baseHeader(), lines, "hts_rel_2026_q1");
    // (1000 × 0.05) + (2000 × 0.10) = 50 + 200 = 250
    expect(result.totalDuty.value).toBeCloseTo(250, 2);
  });

  it("flags Block 35 as sourced_unapproved when no duty rate is available", () => {
    const result = buildForm7501(
      baseHeader(),
      [baseLineItem({ dutyRateDecimal: null })],
      "hts_rel_2026_q1"
    );
    const li = result.lineItems[0];
    expect(li.dutyRate.value).toBeNull();
    expect(li.dutyRate.status).toBe("missing");
    expect(li.dutyAmount.value).toBeNull();
    expect(li.dutyAmount.status).toBe("missing");
  });
});

// ── Missing HTS code ───────────────────────────────────────────────────────────

describe("form7501 — missing HTS code is flagged, not defaulted", () => {
  it("marks htsCode field missing when no htsCode or approved decision", () => {
    const result = buildForm7501(
      baseHeader(),
      [baseLineItem({ htsCode: null, approvedHtsCode: undefined })],
      "hts_rel_2026_q1"
    );
    expect(result.lineItems[0].htsCode.value).toBeNull();
    expect(result.lineItems[0].htsCode.status).toBe("missing");
  });

  it("prefers approvedHtsCode over htsCode for Block 33", () => {
    const result = buildForm7501(
      baseHeader(),
      [
        baseLineItem({
          htsCode: "1234.56.7890",
          approvedHtsCode: "8481.80.5090",
          approvedByUserId: "user_sarah",
          approvedAt: "2026-08-10T00:00:00Z",
          classificationId: "cls_1",
        }),
      ],
      "hts_rel_2026_q1"
    );
    const li = result.lineItems[0];
    expect(li.htsCode.value).toBe("8481.80.5090");
    expect(li.htsCode.status).toBe("sourced_approved");
    expect(li.htsCode.provenance.sourceModel).toBe("ClassificationDecision");
    expect(li.htsCode.provenance.approvedByUserId).toBe("user_sarah");
  });
});

// ── Coverage status ────────────────────────────────────────────────────────────

describe("form7501 — coverageStatus counts", () => {
  it("counts missing fields correctly", () => {
    const result = buildForm7501(
      baseHeader({ portOfEntry: null, bondNumber: null }),
      [baseLineItem({ htsCode: null, countryOfOrigin: null, dutyRateDecimal: null })],
      null
    );
    expect(result.coverageStatus.missing).toBeGreaterThan(0);
    expect(result.coverageStatus.required).toBeGreaterThan(result.coverageStatus.sourced);
  });

  it("reports full coverage when all fields are present", () => {
    const result = buildForm7501(baseHeader(), [baseLineItem()], "hts_rel_2026_q1");
    expect(result.coverageStatus.missing).toBe(0);
    expect(result.coverageStatus.sourced).toBe(result.coverageStatus.required);
  });
});
