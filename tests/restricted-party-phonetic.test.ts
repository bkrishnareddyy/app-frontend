import { describe, it, expect } from "vitest";
import {
  doubleMetaphone,
  doubleMetaphoneMatches,
} from "@/modules/agents/compliance/restrictedParty/phoneticMatch";

describe("doubleMetaphone", () => {
  it("returns empty codes for a string with no letters", () => {
    expect(doubleMetaphone("123")).toEqual(["", ""]);
  });

  it("produces a non-empty code for an ordinary name", () => {
    const [primary] = doubleMetaphone("SMITH");
    expect(primary.length).toBeGreaterThan(0);
  });
});

describe("doubleMetaphoneMatches", () => {
  it("matches classic phonetic-equivalent spelling variants", () => {
    expect(doubleMetaphoneMatches("SMITH", "SMYTH")).toBe(true);
    expect(doubleMetaphoneMatches("CATHERINE", "KATHRYN")).toBe(true);
  });

  it("does not match clearly unrelated names", () => {
    expect(doubleMetaphoneMatches("ACME TRADING", "GLOBAL WIDGETS")).toBe(false);
  });

  it("returns false when both inputs have no letters", () => {
    expect(doubleMetaphoneMatches("123", "456")).toBe(false);
  });
});
