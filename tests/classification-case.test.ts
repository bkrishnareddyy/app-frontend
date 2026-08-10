import { describe, it, expect } from "vitest";
import { GriRulesEngine, type HtsCandidateLookup } from "../src/modules/classification/griRulesEngine";

/** Deterministic stand-in for the tariff repository; keeps tests off the network. */
const stubLookup: HtsCandidateLookup = {
  async search() {
    return [
      {
        id: "hts_node_test",
        chapter: "84",
        heading: "8481",
        htsNumberDisplay: "8481.80.5090",
        description: "Valves for oleohydraulic transmissions",
      },
    ];
  },
};

const emptyLookup: HtsCandidateLookup = {
  async search() {
    return [];
  },
};

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
      const result = await GriRulesEngine.evaluate(
        {
          rawDescription: "Stainless steel valves for oleohydraulic transmissions",
          materialComposition: "304 Stainless Steel",
          functionUsage: "Oleohydraulic fluid control",
        },
        undefined,
        stubLookup
      );

      expect(result.griSteps.length).toBeGreaterThanOrEqual(2);
      expect(result.griSteps[0].griRule).toBe("GRI 1");
      expect(result.griSteps[1].griRule).toBe("GRI 6");
      expect(result.summary).toContain("GRI-grounded proposal");
    });

    it("abstains instead of inventing an HTS code when no candidate heading is found", async () => {
      const result = await GriRulesEngine.evaluate(
        {
          rawDescription: "Stainless steel valves for oleohydraulic transmissions",
          materialComposition: "304 Stainless Steel",
          functionUsage: "Oleohydraulic fluid control",
        },
        undefined,
        emptyLookup
      );

      expect(result.recommendationStatus).toBe("NEEDS_INFORMATION");
      expect(result.candidateHtsCode).toBeUndefined();
      expect(result.missingFacts).toContain("candidate_hts_heading");
    });
  });
});
