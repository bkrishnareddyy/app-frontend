import { GoogleGenAI } from "@google/genai";
import { MemoryRepository } from "./memory.repository";
import { fuseRrfResults } from "./memory.scorer";
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
    } = params;

    // Combine task context keywords
    const searchTerms: string[] = [query, task];
    if (productId) searchTerms.push(productId);
    if (partNumber) searchTerms.push(partNumber);
    if (supplierName) searchTerms.push(supplierName);

    const fullQuery = searchTerms.filter(Boolean).join(" ");

    // 1. Parallel lexical & vector retrieval
    const queryEmbedding = await this.embedQuery(fullQuery);

    const [lexicalMatches, vectorMatches] = await Promise.all([
      MemoryRepository.findLexicalMatches(accountId, fullQuery, limit * 2),
      MemoryRepository.findVectorMatches(accountId, queryEmbedding, limit * 2),
    ]);

    // 2. RRF fusion + Source Weighting + Age Decay
    const fused = fuseRrfResults(lexicalMatches, vectorMatches, limit);

    return fused;
  }
}
