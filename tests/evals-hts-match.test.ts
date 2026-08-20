import { describe, it, expect } from "vitest";
import { scoreHtsMatch } from "../src/modules/evals/hierarchicalHtsMatch";

describe("scoreHtsMatch", () => {
  it("scores a full match at the case's own target depth as passed, 1.0", () => {
    const result = scoreHtsMatch("8471.30.0100", "8471.30.0100");
    expect(result).toEqual({ targetLevel: "10", matchedLevel: "10", score: 1.0, passed: true });
  });

  it("does not require 10-digit precision when the case only asserts 6-digit ground truth", () => {
    // Case authored to 6-digit (heading+subheading) confidence only -- an
    // actual that matches those 6 digits is a full pass, not a partial
    // credit against a 10-digit target nobody actually verified.
    const result = scoreHtsMatch("847130", "8471.30.0150");
    expect(result).toEqual({ targetLevel: "6", matchedLevel: "6", score: 0.5, passed: true });
  });

  it("scores an 8-digit match against a 10-digit target as a partial, failed match", () => {
    const result = scoreHtsMatch("8471.30.0100", "8471.30.0199");
    expect(result).toEqual({ targetLevel: "10", matchedLevel: "8", score: 0.8, passed: false });
  });

  it("scores a 6-digit (subheading) match against a 10-digit target", () => {
    const result = scoreHtsMatch("8471.30.0100", "8471.30.9999");
    expect(result).toEqual({ targetLevel: "10", matchedLevel: "6", score: 0.5, passed: false });
  });

  it("scores a 4-digit (heading-only) match", () => {
    const result = scoreHtsMatch("8471.30.0100", "8471.90.0000");
    expect(result).toEqual({ targetLevel: "10", matchedLevel: "4", score: 0.2, passed: false });
  });

  it("scores a completely different heading as no match", () => {
    const result = scoreHtsMatch("8471.30.0100", "6109.10.0012");
    expect(result).toEqual({ targetLevel: "10", matchedLevel: "none", score: 0, passed: false });
  });

  it("treats a null actual (agent produced no decision) as a full miss", () => {
    const result = scoreHtsMatch("8471.30.0100", null);
    expect(result).toEqual({ targetLevel: "10", matchedLevel: "none", score: 0, passed: false });
  });

  it("treats the agent's own UNCLASSIFIABLE sentinel as a full miss, not an error", () => {
    const result = scoreHtsMatch("8471.30.0100", "UNCLASSIFIABLE");
    expect(result).toEqual({ targetLevel: "10", matchedLevel: "none", score: 0, passed: false });
  });

  it("normalizes dots/dashes before comparing digits", () => {
    const result = scoreHtsMatch("8471-30-0100", "8471.30.0100");
    expect(result.matchedLevel).toBe("10");
  });

  it("throws on an expected code with fewer than 4 digits -- not a usable heading", () => {
    expect(() => scoreHtsMatch("84", "8471.30.0100")).toThrow();
  });
});
