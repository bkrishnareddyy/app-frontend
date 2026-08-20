import { GoogleGenAI } from "@google/genai";
import { MemoryRepository } from "./memory.repository";
import { fuseRrfResults } from "./memory.scorer";
import { TASK_SUBJECT_TYPES } from "./memory.types";
import type {
  MemorySearchQuery,
  ScoredMemory,
} from "./memory.types";

/** Fast deterministic embedding fallback for offline / test mode when GEMINI_API_KEY is unset. */
export function generateDeterministicEmbedding(text: string, dimensions: number = 768): number[] {
  const normText = text.toLowerCase().trim();
  const vector = new Array(dimensions).fill(0);
  for (let i = 0; i < normText.length; i++) {
    const charCode = normText.charCodeAt(i);
    const index = (i * 31 + charCode) % dimensions;
    vector[index] += Math.sin(charCode + i) * 0.1;
  }
  // Normalize vector
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm) || 1;
  return vector.map((v) => v / norm);
}

export class HybridMemoryRetriever {
  private static aiClient = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

  /** Generate embedding vector for a given query text. */
  static async embedQuery(text: string): Promise<number[]> {
    if (!text.trim()) return [];

    if (this.aiClient && process.env.GEMINI_API_KEY) {
      try {
        const response = await this.aiClient.models.embedContent({
          model: "gemini-embedding-001",
          contents: text,
          config: { outputDimensionality: 768 },
        });
        const resAny = response as any;
        const values = resAny.embedding?.values || resAny.embeddings?.[0]?.values;
        if (Array.isArray(values)) {
          return values;
        }
      } catch (err) {
        console.warn("[HybridMemoryRetriever] Gemini embedding failed, using fallback:", err);
      }
    }

    return generateDeterministicEmbedding(text);
  }

  /** Run deterministic, LLM-free hybrid retrieval (PostgreSQL FTS + pgvector cosine similarity + RRF fusion). */
  static async search(params: MemorySearchQuery): Promise<ScoredMemory[]> {
    const {
      accountId,
      task,
      query = "",
      productId,
      partNumber,
      supplierName,
      limit = 10,
      subjectTypes,
    } = params;

    // Scope retrieval to the subjectTypes relevant to this task (e.g. a
    // VALUATION agent has no use for a SUPPLIER-origin memory) unless the
    // caller passed an explicit set. Every agent otherwise sees the same
    // undifferentiated pile of account memory regardless of what it asked.
    const effectiveSubjectTypes = subjectTypes ?? TASK_SUBJECT_TYPES[task];

    // `task` (e.g. "HTS_CLASSIFICATION") used to be folded directly into this
    // text and sent to both FTS and the embedding call. AccountMemory has no
    // `task` column, and no memory's content will ever literally contain the
    // enum string -- websearch_to_tsquery (and the ILIKE-token-AND it
    // replaced) ANDs every term together, so that one always-absent word
    // silently zeroed out every lexical match. Task-appropriateness is now
    // handled by effectiveSubjectTypes above, not by stuffing the task name
    // into the free-text query.
    const searchTerms: string[] = [query];
    if (productId) searchTerms.push(productId);
    if (partNumber) searchTerms.push(partNumber);
    if (supplierName) searchTerms.push(supplierName);

    const fullQuery = searchTerms.filter(Boolean).join(" ");

    // Valuation/Filing operate at the shipment level, not a specific
    // product/SKU, so callers for those tasks often have no free-text query
    // at all -- findLexicalMatches/findVectorMatches both short-circuit to []
    // on an empty query, which used to mean those two tasks got zero account
    // context, always, regardless of what's in the database. Falling back to
    // "recent memories of the relevant subjectTypes" gives them something
    // real to work with instead of a permanently-empty result.
    if (!fullQuery.trim()) {
      if (!effectiveSubjectTypes || effectiveSubjectTypes.length === 0) return [];
      const recent = await MemoryRepository.findMemoriesByAccount(accountId, {
        subjectType: effectiveSubjectTypes,
        limit: limit * 2,
      });
      return fuseRrfResults(recent, [], limit);
    }

    // 1. Parallel lexical & vector retrieval
    const queryEmbedding = await this.embedQuery(fullQuery);

    const [lexicalMatches, vectorMatches] = await Promise.all([
      MemoryRepository.findLexicalMatches(accountId, fullQuery, limit * 2, effectiveSubjectTypes),
      MemoryRepository.findVectorMatches(accountId, queryEmbedding, limit * 2, effectiveSubjectTypes),
    ]);

    // 2. RRF fusion + Source Weighting + Age Decay
    const fused = fuseRrfResults(lexicalMatches, vectorMatches, limit);

    return fused;
  }
}
