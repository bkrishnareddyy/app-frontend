import { GriRulesEngine, type SubjectInput, type HtsCandidateLookup } from "../../../src/modules/classification/griRulesEngine";

export interface HtsRulingCitation {
  rulingNumber: string;
  relevance: string;
}

export interface HtsGriStep {
  rule: string;
  applied: boolean;
  reasoning: string;
}

export interface HtsProposal {
  htsCode: string;
  description: string;
  confidence: number;
  griSteps: HtsGriStep[];
  rulingCitations: HtsRulingCitation[];
}

export interface HtsAgentOutput {
  proposals: HtsProposal[];
}

export interface HtsAgentInput extends SubjectInput {
  rulingCitations?: HtsRulingCitation[];
}

export class HTSClassificationAgent {
  static async classifyProduct(
    input: HtsAgentInput,
    releaseId?: string,
    lookup?: HtsCandidateLookup
  ): Promise<HtsAgentOutput> {
    const result = await GriRulesEngine.evaluate(input, releaseId, lookup);

    if (!result.candidateHtsCode || !result.candidateNodeId) {
      return { proposals: [] };
    }

    const proposals: HtsProposal[] = [
      {
        htsCode: result.candidateHtsCode,
        description: result.summary,
        confidence: result.calibratedConfidence,
        griSteps: result.griSteps.map((step) => ({
          rule: step.griRule,
          applied: step.outcome === "APPLIED",
          reasoning: step.conclusion,
        })),
        rulingCitations: input.rulingCitations ?? [],
      },
    ];

    return { proposals };
  }
}

// Legacy compat export used by older imports
export type { HtsAgentOutput as HTSClassificationResult };
