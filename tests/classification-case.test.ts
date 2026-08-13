import { describe, it, expect } from "vitest";
import { GriRulesEngine, type HtsCandidateLookup } from "../src/modules/classification/griRulesEngine";
import { HTSClassificationAgent } from "../packages/ai/hts/htsAgent";

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

  // A-6: htsAgent structured output (A-3)
  describe("HTSClassificationAgent structured output", () => {
    it("returns structured proposals array from valid input", async () => {
      const result = await HTSClassificationAgent.classifyProduct(
        {
          rawDescription: "Stainless steel valves for oleohydraulic transmissions",
          materialComposition: "304 Stainless Steel",
          functionUsage: "Oleohydraulic fluid control",
        },
        undefined,
        stubLookup
      );

      expect(result.proposals).toBeInstanceOf(Array);
      expect(result.proposals.length).toBeGreaterThan(0);

      const proposal = result.proposals[0];
      expect(proposal).toHaveProperty("htsCode");
      expect(proposal).toHaveProperty("description");
      expect(proposal).toHaveProperty("confidence");
      expect(proposal).toHaveProperty("griSteps");
      expect(proposal).toHaveProperty("rulingCitations");

      expect(proposal.htsCode).toBe("8481.80.5090");
      expect(proposal.confidence).toBeGreaterThan(0);
      expect(proposal.griSteps.length).toBeGreaterThanOrEqual(2);
      proposal.griSteps.forEach((step) => {
        expect(step).toHaveProperty("rule");
        expect(step).toHaveProperty("applied");
        expect(step).toHaveProperty("reasoning");
        expect(typeof step.applied).toBe("boolean");
      });
    });

    it("returns empty proposals array when candidate heading not found", async () => {
      const result = await HTSClassificationAgent.classifyProduct(
        {
          rawDescription: "Stainless steel valves for oleohydraulic transmissions",
          materialComposition: "304 Stainless Steel",
          functionUsage: "Oleohydraulic fluid control",
        },
        undefined,
        emptyLookup
      );

      expect(result.proposals).toBeInstanceOf(Array);
      expect(result.proposals.length).toBe(0);
    });

    it("ruling citations appear in proposal when provided", async () => {
      const rulingCitations = [{ rulingNumber: "NY N123456", relevance: "Identical product classified under 8481.80" }];

      const result = await HTSClassificationAgent.classifyProduct(
        {
          rawDescription: "Stainless steel valves for oleohydraulic transmissions",
          materialComposition: "304 Stainless Steel",
          functionUsage: "Oleohydraulic fluid control",
          rulingCitations,
        },
        undefined,
        stubLookup
      );

      expect(result.proposals[0].rulingCitations).toEqual(rulingCitations);
    });
  });

  // A-6: GriRulesEngine ensures GRI step rows are created per proposal
  describe("GRI step output contract", () => {
    it("every step has sequence, griRule, question, conclusion, and outcome", async () => {
      const result = await GriRulesEngine.evaluate(
        {
          rawDescription: "Stainless steel valves for oleohydraulic transmissions",
          materialComposition: "304 Stainless Steel",
          functionUsage: "Oleohydraulic fluid control",
        },
        undefined,
        stubLookup
      );

      result.griSteps.forEach((step) => {
        expect(step.sequence).toBeGreaterThan(0);
        expect(typeof step.griRule).toBe("string");
        expect(typeof step.question).toBe("string");
        expect(typeof step.conclusion).toBe("string");
        expect(["APPLIED", "NOT_APPLICABLE", "PASSED_TO_NEXT"]).toContain(step.outcome);
      });
    });

    it("steps are ordered by sequence number", async () => {
      const result = await GriRulesEngine.evaluate(
        {
          rawDescription: "Stainless steel valves for oleohydraulic transmissions",
          materialComposition: "304 Stainless Steel",
          functionUsage: "Oleohydraulic fluid control",
        },
        undefined,
        stubLookup
      );

      const seqs = result.griSteps.map((s) => s.sequence);
      const sorted = [...seqs].sort((a, b) => a - b);
      expect(seqs).toEqual(sorted);
    });
  });
});
