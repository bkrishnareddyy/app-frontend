import { describe, it, expect } from "vitest";
import {
  normalizeName,
  tokenize,
  stripCommonWords,
  normalizeForMatching,
  COMMON_WORDS,
} from "@/modules/agents/compliance/restrictedParty/normalize";

describe("normalizeName", () => {
  it("uppercases, trims, and collapses whitespace", () => {
    expect(normalizeName("  acme   trading co  ")).toBe("ACME TRADING CO");
  });

  it("strips punctuation, keeping letters/digits/spaces", () => {
    expect(normalizeName("Acme, Trading & Co. (Pvt.) Ltd.")).toBe("ACME TRADING CO PVT LTD");
  });

  it("strips diacritics", () => {
    expect(normalizeName("Société Générale")).toBe("SOCIETE GENERALE");
  });
});

describe("tokenize", () => {
  it("drops single-character tokens", () => {
    expect(tokenize("J P MORGAN")).toEqual(["MORGAN"]);
  });

  it("keeps multi-character tokens", () => {
    expect(tokenize("ACME TRADING CO")).toEqual(["ACME", "TRADING", "CO"]);
  });
});

describe("stripCommonWords", () => {
  it("removes legal-entity suffixes and connector words", () => {
    expect(stripCommonWords("ACME TRADING CO LTD")).toBe("ACME");
  });

  it("leaves a name with no common words unchanged", () => {
    expect(stripCommonWords("XINJIANG TEXTILES")).toBe("XINJIANG TEXTILES");
  });

  it("every entry in COMMON_WORDS is actually stripped", () => {
    for (const word of COMMON_WORDS) {
      expect(stripCommonWords(`ACME ${word}`)).toBe("ACME");
    }
  });
});

describe("normalizeForMatching", () => {
  it("normalizes then strips common words", () => {
    expect(normalizeForMatching("Acme Trading Co., Ltd.")).toBe("ACME");
  });

  it("falls back to the merely-normalized form when stripping empties the name", () => {
    expect(normalizeForMatching("The Corporation Ltd")).toBe("THE CORPORATION LTD");
  });
});
