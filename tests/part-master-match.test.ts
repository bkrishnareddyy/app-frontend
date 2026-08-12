import { describe, it, expect } from "vitest";
import { matchPartMaster, type CanonicalProductRecord } from "@/modules/product/partMasterMatch";

function product(overrides: Partial<CanonicalProductRecord> = {}): CanonicalProductRecord {
  return {
    id: "cp1",
    partNumber: "PN-001",
    htsCode: "8481.80.5090",
    aliases: [],
    ...overrides,
  };
}

describe("matchPartMaster", () => {
  describe("no match", () => {
    it("returns NONE when line item has no part number", () => {
      const r = matchPartMaster({ partNumber: null, proposedHtsCode: "8481.80.5090" }, [product()]);
      expect(r.matched).toBe(false);
      expect(r.basis).toBe("NONE");
    });

    it("returns NONE when part number is blank", () => {
      const r = matchPartMaster({ partNumber: "   ", proposedHtsCode: null }, [product()]);
      expect(r.matched).toBe(false);
    });

    it("returns NONE when no products exist", () => {
      const r = matchPartMaster({ partNumber: "PN-001", proposedHtsCode: null }, []);
      expect(r.matched).toBe(false);
    });

    it("returns NONE when no product matches", () => {
      const r = matchPartMaster({ partNumber: "PN-999", proposedHtsCode: null }, [product()]);
      expect(r.matched).toBe(false);
    });
  });

  describe("exact part-number match", () => {
    it("matches on identical strings", () => {
      const r = matchPartMaster({ partNumber: "PN-001", proposedHtsCode: "8481.80.5090" }, [product()]);
      expect(r.matched).toBe(true);
      expect(r.basis).toBe("PART_NUMBER");
      expect(r.canonicalProductId).toBe("cp1");
    });

    it("is case-insensitive", () => {
      const r = matchPartMaster({ partNumber: "pn-001", proposedHtsCode: null }, [product()]);
      expect(r.matched).toBe(true);
    });

    it("ignores dashes and spaces", () => {
      const r = matchPartMaster({ partNumber: "PN 001", proposedHtsCode: null }, [product({ partNumber: "PN_001" })]);
      expect(r.matched).toBe(true);
    });
  });

  describe("alias match", () => {
    it("matches on an alias when no direct part number matches", () => {
      const p = product({ partNumber: "PN-001", aliases: [{ aliasName: "ALIAS-42" }] });
      const r = matchPartMaster({ partNumber: "ALIAS-42", proposedHtsCode: null }, [p]);
      expect(r.matched).toBe(true);
      expect(r.basis).toBe("ALIAS");
      expect(r.canonicalProductId).toBe("cp1");
    });

    it("prefers a direct part-number match over an alias on another product", () => {
      const direct = product({ id: "cp-direct", partNumber: "PN-001", aliases: [] });
      const aliased = product({ id: "cp-alias", partNumber: "OTHER", aliases: [{ aliasName: "PN-001" }] });
      const r = matchPartMaster({ partNumber: "PN-001", proposedHtsCode: null }, [direct, aliased]);
      expect(r.canonicalProductId).toBe("cp-direct");
      expect(r.basis).toBe("PART_NUMBER");
    });
  });

  describe("HTS agreement", () => {
    it("htsAgrees is true when codes match (ignoring dots)", () => {
      const r = matchPartMaster(
        { partNumber: "PN-001", proposedHtsCode: "8481805090" },
        [product({ htsCode: "8481.80.5090" })]
      );
      expect(r.matched).toBe(true);
      expect(r.htsAgrees).toBe(true);
    });

    it("htsAgrees is false when codes differ", () => {
      const r = matchPartMaster(
        { partNumber: "PN-001", proposedHtsCode: "8537.10.2030" },
        [product({ htsCode: "8481.80.5090" })]
      );
      expect(r.matched).toBe(true);
      expect(r.htsAgrees).toBe(false);
      expect(r.masterHtsCode).toBe("8481.80.5090");
    });

    it("htsAgrees is false when master has no HTS code", () => {
      const r = matchPartMaster(
        { partNumber: "PN-001", proposedHtsCode: "8481.80.5090" },
        [product({ htsCode: null })]
      );
      expect(r.matched).toBe(true);
      expect(r.htsAgrees).toBe(false);
    });

    it("htsAgrees is false when proposed code is null", () => {
      const r = matchPartMaster(
        { partNumber: "PN-001", proposedHtsCode: null },
        [product({ htsCode: "8481.80.5090" })]
      );
      expect(r.matched).toBe(true);
      expect(r.htsAgrees).toBe(false);
    });
  });
});
