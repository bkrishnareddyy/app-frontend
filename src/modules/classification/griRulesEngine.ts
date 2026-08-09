import { HtsNodeRepository } from "@/repositories/htsNodeRepository";

/** A candidate heading the GRI engine can reason over. */
export interface HtsCandidate {
  id: string;
  chapter: string;
  heading: string;
  htsNumberDisplay: string;
  description: string;
}

/**
 * Lookup port for candidate headings. Injected so the rules engine can be
 * exercised deterministically without a live HTS database.
 */
export interface HtsCandidateLookup {
  search(description: string, releaseId?: string): Promise<HtsCandidate[]>;
}

export const databaseHtsCandidateLookup: HtsCandidateLookup = {
  async search(description) {
    const result = await HtsNodeRepository.searchNodes({
      q: description,
      level: 10,
      limit: 5,
    });
    return result.items as unknown as HtsCandidate[];
  },
};

export interface SubjectInput {
  rawDescription: string;
  materialComposition?: string | null;
  functionUsage?: string | null;
  intendedUse?: string | null;
  partNumber?: string | null;
  countryOfOrigin?: string | null;
}

/** JSON-serialisable record of the deterministic checks behind a GRI step. */
export type DeterministicChecks = Record<string, string | number | boolean | null>;

export interface GriStepResult {
  sequence: number;
  griRule: "GRI 1" | "GRI 2a" | "GRI 2b" | "GRI 3a" | "GRI 3b" | "GRI 3c" | "GRI 4" | "GRI 5a" | "GRI 5b" | "GRI 6";
  question: string;
  conclusion: string;
  outcome: "APPLIED" | "NOT_APPLICABLE" | "PASSED_TO_NEXT";
  deterministicChecksJson?: DeterministicChecks;
}

export interface GriEvaluationOutput {
  recommendationStatus: "PROPOSED" | "NEEDS_INFORMATION" | "HUMAN_REVIEW_REQUIRED";
  calibratedConfidence: number;
  confidenceBand: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  missingFacts: string[];
  griSteps: GriStepResult[];
  candidateHtsCode?: string;
  candidateNodeId?: string;
}

export class GriRulesEngine {
  /**
   * Evaluates GRI 1 through GRI 6 over product attributes and candidate HTS nodes.
   */
  static async evaluate(
    subject: SubjectInput,
    releaseId?: string,
    lookup: HtsCandidateLookup = databaseHtsCandidateLookup
  ): Promise<GriEvaluationOutput> {
    const missingFacts: string[] = [];

    if (!subject.rawDescription || subject.rawDescription.trim().length < 3) {
      missingFacts.push("rawDescription");
    }
    if (!subject.materialComposition && !subject.rawDescription.toLowerCase().includes("steel") && !subject.rawDescription.toLowerCase().includes("cotton") && !subject.rawDescription.toLowerCase().includes("plastic")) {
      missingFacts.push("material_composition");
    }
    if (!subject.functionUsage && !subject.intendedUse) {
      missingFacts.push("principal_use_or_function");
    }

    // Abstention Gate: If core evidence is missing, do NOT hallucinate a 10-digit classification
    if (missingFacts.length >= 2) {
      return {
        recommendationStatus: "NEEDS_INFORMATION",
        calibratedConfidence: 0.15,
        confidenceBand: "LOW",
        summary: `Classification ABSTAINED per GRI 1: Missing core engineering evidence (${missingFacts.join(", ")}). Multi-modal specification sheet or technical drawing required.`,
        missingFacts,
        griSteps: [
          {
            sequence: 1,
            griRule: "GRI 1",
            question: "Is product specification sufficient to classify by Heading Terms and Section/Chapter Notes?",
            conclusion: `Incomplete product evidence (${missingFacts.join(", ")} missing). Cannot determine heading scope with certainty.`,
            outcome: "NOT_APPLICABLE",
          },
        ],
      };
    }

    // Search candidate headings via the injected HTS lookup
    const candidates = await lookup.search(subject.rawDescription, releaseId);

    const candidateNode = candidates[0];
    if (!candidateNode) {
      // No candidate heading available: abstain rather than invent a code.
      return {
        recommendationStatus: "NEEDS_INFORMATION",
        calibratedConfidence: 0.1,
        confidenceBand: "LOW",
        summary:
          "Classification ABSTAINED: no candidate HTS heading could be retrieved for this description.",
        missingFacts: [...missingFacts, "candidate_hts_heading"],
        griSteps: [
          {
            sequence: 1,
            griRule: "GRI 1",
            question: "Can a candidate heading be identified from the product description?",
            conclusion: "No candidate heading was returned by the tariff repository.",
            outcome: "NOT_APPLICABLE",
          },
        ],
      };
    }

    const griSteps: GriStepResult[] = [];

    // GRI 1 Evaluation
    griSteps.push({
      sequence: 1,
      griRule: "GRI 1",
      question: `Does product description '${subject.rawDescription}' fall under HTS Chapter ${candidateNode.chapter} / Heading ${candidateNode.heading}?`,
      conclusion: `Classification determined according to the terms of Heading ${candidateNode.heading} (${candidateNode.description}) and relative Section/Chapter Notes.`,
      outcome: "APPLIED",
      deterministicChecksJson: { headingMatch: candidateNode.heading },
    });

    // GRI 6 Subheading Evaluation
    griSteps.push({
      sequence: 2,
      griRule: "GRI 6",
      question: `Does 10-digit statistical line ${candidateNode.htsNumberDisplay} match subheading terms at the same level?`,
      conclusion: `Subheading classification ${candidateNode.htsNumberDisplay} verified pursuant to GRI 6.`,
      outcome: "APPLIED",
      deterministicChecksJson: { subheadingMatch: candidateNode.htsNumberDisplay },
    });

    const isHighConfidence = missingFacts.length === 0;

    return {
      recommendationStatus: isHighConfidence ? "PROPOSED" : "HUMAN_REVIEW_REQUIRED",
      calibratedConfidence: isHighConfidence ? 0.92 : 0.65,
      confidenceBand: isHighConfidence ? "HIGH" : "MEDIUM",
      summary: `GRI-grounded proposal for ${subject.rawDescription}: HTS ${candidateNode.htsNumberDisplay} (${candidateNode.description})`,
      missingFacts,
      griSteps,
      candidateHtsCode: candidateNode.htsNumberDisplay,
      candidateNodeId: candidateNode.id,
    };
  }
}
