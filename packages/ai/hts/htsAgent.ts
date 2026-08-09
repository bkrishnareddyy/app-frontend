export interface HTSClassificationResult {
  htsCode: string | null;
  dutyRate: string | null;
  description: string | null;
  /** Null unless a classifier actually ran; an unclassified line has no confidence. */
  confidenceScore: number | null;
  reasoning: string | null;
  /** Why the line was not classified. Null when a classifier genuinely ran. */
  unavailableReason: string | null;
}

/**
 * No classifier is wired up in this build. This previously returned
 * 8481.20.00.00 at 0.96 confidence with invented reasoning for every product.
 * src/modules/agents/htsClassificationAgent.ts is the real implementation.
 */
export class HTSClassificationAgent {
  static async classifyProduct(description: string, origin?: string): Promise<HTSClassificationResult> {
    const subject = description.trim() ? `"${description.trim()}"` : "this line item";
    return {
      htsCode: null,
      dutyRate: null,
      description: null,
      confidenceScore: null,
      reasoning: null,
      unavailableReason: `No HTS classifier is configured, so ${subject}${origin ? ` (origin ${origin})` : ""} has not been classified.`,
    };
  }
}
