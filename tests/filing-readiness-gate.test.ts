import { describe, it, expect } from "vitest";
import {
  evaluateFilingReadiness,
  isTenDigitHts,
  type FilingReadinessSubject,
} from "@/modules/filing/filingReadiness";

function ready(overrides: Partial<FilingReadinessSubject> = {}): FilingReadinessSubject {
  return {
    importerOfRecordId: "ior_1",
    entryType: "01",
    lineItems: [{ lineNumber: 1, htsCode: "8481.80.5090", countryOfOrigin: "Germany" }],
    documents: [{ docType: "Commercial Invoice", status: "Received" }],
    openExceptions: [],
    openReconciliationIssues: [],
    ...overrides,
  };
}

function codes(subject: FilingReadinessSubject): string[] {
  return evaluateFilingReadiness(subject).blockers.map((b) => b.code);
}

describe("ten digit HTS", () => {
  it("accepts a dotted ten digit number", () => {
    expect(isTenDigitHts("8481.80.5090")).toBe(true);
    expect(isTenDigitHts("8481805090")).toBe(true);
  });

  it("rejects a truncated classification, which is the common half-done case", () => {
    expect(isTenDigitHts("8481.80")).toBe(false);
    expect(isTenDigitHts("8481")).toBe(false);
  });

  it("rejects absence and whitespace rather than treating them as a value", () => {
    expect(isTenDigitHts(null)).toBe(false);
    expect(isTenDigitHts("")).toBe(false);
    expect(isTenDigitHts("   ")).toBe(false);
  });
});

describe("filing readiness", () => {
  it("clears a shipment that holds everything the checks look for", () => {
    const result = evaluateFilingReadiness(ready());

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.checksPassed).toBe(result.checksPerformed);
  });

  it("does not count a check it could not run as passed", () => {
    const withLines = evaluateFilingReadiness(ready());
    const withoutLines = evaluateFilingReadiness(ready({ lineItems: [] }));

    // Classification and origin cannot be checked when there is no line to check.
    expect(withoutLines.checksPerformed).toBe(withLines.checksPerformed - 2);
    expect(withoutLines.blockers.map((b) => b.code)).toContain("NO_LINE_ITEMS");
    expect(withoutLines.blockers.map((b) => b.code)).not.toContain(
      "MISSING_HTS_CLASSIFICATION"
    );
  });

  it("blocks an entry whose lines are not classified to ten digits", () => {
    expect(
      codes(
        ready({
          lineItems: [{ lineNumber: 4, htsCode: "8481.80", countryOfOrigin: "Germany" }],
        })
      )
    ).toContain("MISSING_HTS_CLASSIFICATION");
  });

  it("names the lines at fault instead of saying some lines are incomplete", () => {
    const result = evaluateFilingReadiness(
      ready({
        lineItems: [
          { lineNumber: 1, htsCode: "8481.80.5090", countryOfOrigin: "Germany" },
          { lineNumber: 7, htsCode: "", countryOfOrigin: "Germany" },
          { lineNumber: 9, htsCode: null, countryOfOrigin: "Germany" },
        ],
      })
    );

    const blocker = result.blockers.find((b) => b.code === "MISSING_HTS_CLASSIFICATION");
    expect(blocker?.detail).toContain("line 7");
    expect(blocker?.detail).toContain("line 9");
    expect(blocker?.detail).toContain("2 of 3");
  });

  it("blocks a line with no country of origin", () => {
    expect(
      codes(
        ready({
          lineItems: [{ lineNumber: 1, htsCode: "8481.80.5090", countryOfOrigin: "  " }],
        })
      )
    ).toContain("MISSING_COUNTRY_OF_ORIGIN");
  });

  it("blocks an entry with no commercial invoice", () => {
    expect(codes(ready({ documents: [] }))).toContain("MISSING_COMMERCIAL_INVOICE");
    expect(
      codes(ready({ documents: [{ docType: "Packing List", status: "Received" }] }))
    ).toContain("MISSING_COMMERCIAL_INVOICE");
  });

  it("does not accept an invoice row that records the document as missing", () => {
    expect(
      codes(ready({ documents: [{ docType: "Commercial Invoice", status: "Missing" }] }))
    ).toContain("MISSING_COMMERCIAL_INVOICE");
  });

  it("accepts an invoice whatever case the docType was stored in", () => {
    expect(
      codes(ready({ documents: [{ docType: "commercial invoice", status: "Received" }] }))
    ).not.toContain("MISSING_COMMERCIAL_INVOICE");
  });

  it("blocks an entry with no importer of record", () => {
    expect(codes(ready({ importerOfRecordId: null }))).toContain(
      "MISSING_IMPORTER_OF_RECORD"
    );
  });

  it("blocks an entry with no entry type, because Block 2 cannot be filled", () => {
    expect(codes(ready({ entryType: null }))).toContain("MISSING_ENTRY_TYPE");
    expect(codes(ready({ entryType: "  " }))).toContain("MISSING_ENTRY_TYPE");
  });

  it("blocks on open critical or high exceptions, and ignores the rest", () => {
    expect(codes(ready({ openExceptions: [{ severity: "Critical" }] }))).toContain(
      "BLOCKING_EXCEPTIONS"
    );
    expect(codes(ready({ openExceptions: [{ severity: "High" }] }))).toContain(
      "BLOCKING_EXCEPTIONS"
    );
    expect(codes(ready({ openExceptions: [{ severity: "Low" }] }))).not.toContain(
      "BLOCKING_EXCEPTIONS"
    );
  });

  it("blocks on a critical reconciliation issue", () => {
    expect(
      codes(ready({ openReconciliationIssues: [{ severity: "Critical" }] }))
    ).toContain("CRITICAL_RECONCILIATION");
    expect(
      codes(ready({ openReconciliationIssues: [{ severity: "Medium" }] }))
    ).not.toContain("CRITICAL_RECONCILIATION");
  });

  it("reports every unmet requirement at once, not the first one it hits", () => {
    const result = evaluateFilingReadiness({
      importerOfRecordId: null,
      entryType: null,
      lineItems: [{ lineNumber: 1, htsCode: "", countryOfOrigin: "" }],
      documents: [],
      openExceptions: [{ severity: "Critical" }],
      openReconciliationIssues: [{ severity: "Critical" }],
    });

    expect(result.blockers.map((b) => b.code).sort()).toEqual(
      [
        "BLOCKING_EXCEPTIONS",
        "CRITICAL_RECONCILIATION",
        "MISSING_COMMERCIAL_INVOICE",
        "MISSING_COUNTRY_OF_ORIGIN",
        "MISSING_ENTRY_TYPE",
        "MISSING_HTS_CLASSIFICATION",
        "MISSING_IMPORTER_OF_RECORD",
      ].sort()
    );
    expect(result.checksPassed).toBe(1);
  });

  it("gives every blocker somewhere on the page to go", () => {
    const result = evaluateFilingReadiness({
      importerOfRecordId: null,
      entryType: null,
      lineItems: [],
      documents: [],
      openExceptions: [{ severity: "High" }],
      openReconciliationIssues: [{ severity: "Critical" }],
    });

    for (const blocker of result.blockers) {
      expect(blocker.anchor.startsWith("#")).toBe(true);
      expect(blocker.detail.length).toBeGreaterThan(0);
    }
  });
});
