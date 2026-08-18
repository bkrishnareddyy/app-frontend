import type {
  AccountMemoryRecord,
  ScoredMemory,
} from "./memory.types";

/** Source weighting multiplier. Human decision > filing outcome > document > agent inference */
const SOURCE_WEIGHTS: Record<string, number> = {
  HUMAN_DECISION: 1.5,
  FILING_OUTCOME: 1.2,
  VERIFIED_DOCUMENT: 1.0,
  AGENT_INFERENCE: 0.6,
};

/** Type weighting multiplier. */
const TYPE_WEIGHTS: Record<string, number> = {
  PROCEDURE: 1.4,
  DECISION: 1.3,
  PREFERENCE: 1.2,
  EXCEPTION: 1.1,
  FACT: 1.0,
  PATTERN: 0.9,
};

const RRF_CONSTANT = 60;

/**
 * Fuse lexical search results and vector search results using Reciprocal Rank Fusion (RRF).
 */
export function fuseRrfResults(
  lexicalResults: AccountMemoryRecord[],
  vectorResults: AccountMemoryRecord[],
  limit: number = 10
): ScoredMemory[] {
  const map = new Map<
    string,
    {
      memory: AccountMemoryRecord;
      lexicalRank: number | null;
      vectorRank: number | null;
      rrfScore: number;
    }
  >();

  // Index lexical ranks
  lexicalResults.forEach((m, idx) => {
    const rank = idx + 1;
    const existing = map.get(m.id) || {
      memory: m,
      lexicalRank: null,
      vectorRank: null,
      rrfScore: 0,
    };
    existing.lexicalRank = rank;
    existing.rrfScore += 1.0 / (RRF_CONSTANT + rank);
    map.set(m.id, existing);
  });

  // Index vector ranks
  vectorResults.forEach((m, idx) => {
    const rank = idx + 1;
    const existing = map.get(m.id) || {
      memory: m,
      lexicalRank: null,
      vectorRank: null,
      rrfScore: 0,
    };
    existing.vectorRank = rank;
    existing.rrfScore += 1.0 / (RRF_CONSTANT + rank);
    map.set(m.id, existing);
  });

  const scored: ScoredMemory[] = [];
  const now = new Date().getTime();

  for (const item of map.values()) {
    const m = item.memory;
    const sourceWeight = SOURCE_WEIGHTS[m.sourceType] ?? 1.0;
    const typeWeight = TYPE_WEIGHTS[m.type] ?? 1.0;

    // Age decay: half-life ~365 days
    const ageDays = (now - new Date(m.validFrom).getTime()) / (1000 * 3600 * 24);
    const ageDecay = 1 / (1 + ageDays / 365.0);

    // Final unified confidence score
    const finalScore =
      item.rrfScore * sourceWeight * typeWeight * (m.confidence ?? 1.0) * ageDecay;

    scored.push({
      ...m,
      score: Number(finalScore.toFixed(6)),
      lexicalRank: item.lexicalRank,
      vectorRank: item.vectorRank,
      rrfScore: Number(item.rrfScore.toFixed(6)),
    });
  }

  // Sort descending by finalScore
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
