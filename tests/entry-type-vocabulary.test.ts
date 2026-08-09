import { describe, it, expect } from "vitest";
import {
  ENTRY_TYPES,
  ENTRY_TYPE_CODES,
  entryTypeDefinition,
  entryTypeLabel,
  entryTypeVariants,
  isKnownEntryType,
  normalizeEntryType,
  requireEntryTypeCode,
} from "@/modules/filing/entryType";

describe("entry type catalogue", () => {
  it("has no duplicate codes", () => {
    expect(new Set(ENTRY_TYPE_CODES).size).toBe(ENTRY_TYPE_CODES.length);
  });

  it("uses two-digit codes, because Block 2 of the 7501 is two digits", () => {
    for (const entry of ENTRY_TYPES) {
      expect(entry.code).toMatch(/^\d{2}$/);
    }
  });

  it("gives every code a label a person can read", () => {
    for (const entry of ENTRY_TYPES) {
      expect(entry.label.length).toBeGreaterThan(3);
    }
  });
});

describe("normalizeEntryType", () => {
  it("accepts the code itself", () => {
    expect(normalizeEntryType("01")).toBe("01");
    expect(normalizeEntryType("23")).toBe("23");
  });

  it("pads a single digit rather than rejecting it", () => {
    expect(normalizeEntryType("1")).toBe("01");
    expect(normalizeEntryType("6")).toBe("06");
  });

  it("reads the three spellings that were live in the column", () => {
    // The create form wrote this one.
    expect(normalizeEntryType("Consumption Entry")).toBe("01");
    // The agents wrote this one.
    expect(normalizeEntryType("01")).toBe("01");
    // The filing screen wrote this one.
    expect(normalizeEntryType("01 - CONSUMPTION ENTRY")).toBe("01");
  });

  it("reads the other options the create form used to offer", () => {
    expect(normalizeEntryType("Informal Entry")).toBe("11");
    expect(normalizeEntryType("In-Bond Entry")).toBe("61");
    expect(normalizeEntryType("Foreign Trade Zone Entry")).toBe("06");
    expect(normalizeEntryType("Temporary Importation under Bond")).toBe("23");
  });

  it("reads the spellings the filing tests already relied on", () => {
    expect(normalizeEntryType("21 - Warehouse")).toBe("21");
    expect(normalizeEntryType("06 - FTZ")).toBe("06");
  });

  it("ignores case, spacing and punctuation", () => {
    expect(normalizeEntryType("  consumption   entry ")).toBe("01");
    expect(normalizeEntryType("FOREIGN_TRADE_ZONE")).toBe("06");
    expect(normalizeEntryType("T.I.B.")).toBe("23");
  });

  it("returns null rather than guessing at an unknown value", () => {
    expect(normalizeEntryType("Section 301 entry")).toBeNull();
    expect(normalizeEntryType("whatever the broker typed")).toBeNull();
    expect(normalizeEntryType("99")).toBeNull();
  });

  it("treats blank and absent as unknown", () => {
    expect(normalizeEntryType("")).toBeNull();
    expect(normalizeEntryType("   ")).toBeNull();
    expect(normalizeEntryType(null)).toBeNull();
    expect(normalizeEntryType(undefined)).toBeNull();
  });

  it("round-trips every spelling a writer can emit", () => {
    // The writers are the create form (codes), entryTypeVariants (legacy rows)
    // and entryTypeLabel (display). If the reader cannot read what the writers
    // produce, the column has more than one vocabulary again.
    for (const entry of ENTRY_TYPES) {
      expect(normalizeEntryType(entry.code)).toBe(entry.code);
      for (const variant of entryTypeVariants(entry.code)) {
        expect(normalizeEntryType(variant)).toBe(entry.code);
      }
      expect(normalizeEntryType(entryTypeLabel(entry.code))).toBe(entry.code);
      for (const alias of entry.aliases) {
        expect(normalizeEntryType(alias)).toBe(entry.code);
      }
    }
  });

  it("is idempotent", () => {
    for (const raw of ["Consumption Entry", "01 - CONSUMPTION ENTRY", "1", "21 - Warehouse"]) {
      const once = normalizeEntryType(raw);
      expect(normalizeEntryType(once)).toBe(once);
    }
  });
});

describe("entryTypeLabel", () => {
  it("prints the code and the meaning together", () => {
    expect(entryTypeLabel("01")).toBe("01 — Consumption");
    expect(entryTypeLabel("Consumption Entry")).toBe("01 — Consumption");
  });

  it("shows an unrecognised stored value verbatim instead of mapping it", () => {
    expect(entryTypeLabel("Section 301 entry")).toBe("Section 301 entry");
  });

  it("says the value is missing rather than picking one", () => {
    expect(entryTypeLabel(null)).toBe("Not provided");
    expect(entryTypeLabel("  ")).toBe("Not provided");
    expect(entryTypeLabel(undefined, "—")).toBe("—");
  });
});

describe("entryTypeDefinition and isKnownEntryType", () => {
  it("resolves a definition from any spelling", () => {
    expect(entryTypeDefinition("consumption entry")?.code).toBe("01");
    expect(entryTypeDefinition("bogus")).toBeNull();
  });

  it("reports whether a stored value names an entry type", () => {
    expect(isKnownEntryType("11")).toBe(true);
    expect(isKnownEntryType("bogus")).toBe(false);
    expect(isKnownEntryType(null)).toBe(false);
  });
});

describe("entryTypeVariants", () => {
  it("covers the spellings legacy rows hold for a code", () => {
    const variants = entryTypeVariants("01");
    expect(variants).toContain("01");
    expect(variants).toContain("Consumption");
    expect(variants).toContain("Consumption Entry");
    expect(variants).toContain("01 - CONSUMPTION");
  });

  it("returns the input for a code it does not know, rather than an empty filter", () => {
    // An empty list would silently match everything or nothing.
    expect(entryTypeVariants("99")).toEqual(["99"]);
  });
});

describe("requireEntryTypeCode", () => {
  it("returns the code when the value names one", () => {
    expect(requireEntryTypeCode("Consumption Entry")).toBe("01");
  });

  it("refuses to invent a consumption entry when nothing was supplied", () => {
    expect(() => requireEntryTypeCode(null)).toThrow(/needs a CBP entry type/i);
    expect(() => requireEntryTypeCode("")).toThrow(/None was supplied/i);
  });

  it("names the offending value and the accepted codes", () => {
    expect(() => requireEntryTypeCode("Section 301")).toThrow(/"Section 301" names none/);
    expect(() => requireEntryTypeCode("Section 301")).toThrow(/01/);
  });
});
