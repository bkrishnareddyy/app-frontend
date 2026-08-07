import { describe, it, expect } from "vitest";
import { GriRulesEngine } from "../src/modules/classification/griRulesEngine";

describe("Phase 2 Classification Engine & GRI Rules Engine Test Suite", () => {
  describe("GriRulesEngine Abstention & Evidence Gating", () => {
    it("abstains with NEEDS_INFORMATION when product description and material composition are missing", async () => {
      const result = await GriRulesEngine.evaluate({
        rawDescription: "x",
      });

      expect(result.recommendationStatus).toBe("NEEDS_INFORMATION");
      expect(result.calibratedConfidence).toBeLessThan(0.5);
      expect(result.missingFacts).toContain("rawDescription");
      expect(result.griSteps[0].outcome).toBe("NOT_APPLICABLE");
    });

    it("evaluates GRI 1 and GRI 6 steps when valid product description is provided", async () => {
      const result = await GriRulesEngine.evaluate({
        rawDescription: "Stainless steel valves for oleohydraulic transmissions",
        materialComposition: "304 Stainless Steel",
        functionUsage: "Oleohydraulic fluid control",
      });

      expect(result.griSteps.length).toBeGreaterThanOrEqual(2);
      expect(result.griSteps[0].griRule).toBe("GRI 1");
      expect(result.griSteps[1].griRule).toBe("GRI 6");
      expect(result.summary).toContain("GRI-grounded proposal");
    });
  });
});
