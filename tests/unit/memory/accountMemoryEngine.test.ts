import { describe, it, expect, vi } from "vitest";
import {
  cosineSimilarity,
  fuseRrfResults,
  generateDeterministicEmbedding,
  AccountContextBuilder,
  MemoryExtractorWorker,
  MemoryRepository,
  HybridMemoryRetriever,
} from "@/modules/memory";
import { db } from "@/lib/db";
import type { AccountMemoryRecord } from "@/modules/memory/memory.types";

// Mock db for testing
vi.mock("@/lib/db", () => {
  const memoryStore: AccountMemoryRecord[] = [];
  const evidenceStore: any[] = [];

  // Vitest hoists vi.mock factories above the file's imports, so this can't
  // reference the real `cosineSimilarity` import below -- it's a self-contained
  // duplicate for the $queryRaw stand-in only.
  function localCosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  const isExpired = (m: AccountMemoryRecord) => {
    const now = new Date();
    return m.validUntil !== null && m.validUntil <= now;
  };

  // Approximates the real contentTsv generated column (`to_tsvector('simple',
  // content || ' ' || subjectId)`) with AND-of-tokens semantics, the same
  // way websearch_to_tsquery treats space-separated plain words. The ILIKE
  // fallback (whole-phrase substring on content/subjectId) is layered on
  // separately, matching the OR in the real query.
  function matchesLexically(m: AccountMemoryRecord, rawQuery: string): boolean {
    const needle = rawQuery.toLowerCase().trim();
    if (!needle) return false;
    const combined = `${m.content} ${m.subjectId ?? ""}`.toLowerCase();
    const tokens = needle.split(/\s+/).filter(Boolean);
    const tokenAndMatch = tokens.length > 0 && tokens.every((t) => combined.includes(t));
    const wholePhraseMatch = m.content.toLowerCase().includes(needle) || (m.subjectId ?? "").toLowerCase().includes(needle);
    return tokenAndMatch || wholePhraseMatch;
  }

  return {
    db: {
      accountMemory: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          const rec: AccountMemoryRecord = {
            id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            accountId: data.accountId,
            type: data.type,
            subjectType: data.subjectType,
            subjectId: data.subjectId ?? null,
            content: data.content,
            confidence: data.confidence ?? 1.0,
            validFrom: data.validFrom ?? new Date(),
            validUntil: data.validUntil ?? null,
            sourceType: data.sourceType,
            sourceId: data.sourceId ?? null,
            supersedesMemoryId: data.supersedesMemoryId ?? null,
            embedding: data.embedding ?? [],
            searchVector: data.searchVector ?? "",
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          memoryStore.push(rec);
          return rec;
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return memoryStore.filter((m) => {
            if (where.accountId && m.accountId !== where.accountId) return false;
            if (where.type && m.type !== where.type) return false;
            if (where.subjectType) {
              if (Array.isArray(where.subjectType?.in)) {
                if (!where.subjectType.in.includes(m.subjectType)) return false;
              } else if (m.subjectType !== where.subjectType) return false;
            }
            if (where.validUntil === null && m.validUntil !== null) return false;
            if (where.id?.in && !where.id.in.includes(m.id)) return false;
            if (Array.isArray(where.OR)) {
              const passesOr = where.OR.some((cond: any) => {
                if (cond.validUntil === null) return m.validUntil === null;
                if (cond.validUntil && typeof cond.validUntil === "object" && "gt" in cond.validUntil) {
                  return m.validUntil !== null && m.validUntil > cond.validUntil.gt;
                }
                return false;
              });
              if (!passesOr) return false;
            }
            return true;
          });
        }),
        findFirst: vi.fn().mockImplementation(async ({ where, orderBy }) => {
          let matches = memoryStore.filter((m) => !where?.accountId || m.accountId === where.accountId);
          if (orderBy?.createdAt === "asc") matches = matches.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          return matches[0] ?? null;
        }),
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          const rec = memoryStore.find((m) => m.id === where.id);
          return rec ? { ...rec, evidence: evidenceStore.filter((e) => e.memoryId === rec.id) } : null;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const rec = memoryStore.find((m) => m.id === where.id);
          if (rec) {
            if (data.validUntil !== undefined) rec.validUntil = data.validUntil;
            if (data.supersedesMemoryId !== undefined) rec.supersedesMemoryId = data.supersedesMemoryId;
            if (data.confidence !== undefined) rec.confidence = data.confidence;
            if (data.updatedAt !== undefined) rec.updatedAt = data.updatedAt;
          }
          return rec;
        }),
        count: vi.fn().mockImplementation(async () => memoryStore.length),
        groupBy: vi.fn().mockImplementation(async () => []),
      },
      memoryEvidence: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          const ev = { id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...data, createdAt: new Date() };
          evidenceStore.push(ev);
          return ev;
        }),
        findFirst: vi.fn().mockImplementation(async ({ where, orderBy }) => {
          let matches = evidenceStore.filter(
            (e) =>
              (!where?.accountId || e.accountId === where.accountId) &&
              (!where?.sourceType || e.sourceType === where.sourceType) &&
              (!where?.sourceId || e.sourceId === where.sourceId)
          );
          if (orderBy?.createdAt === "desc") matches = matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return matches[0] ?? null;
        }),
      },
      agentDecision: {
        count: vi.fn().mockImplementation(async () => 10),
      },
      // Stand-ins for the raw pgvector / FTS queries findVectorMatches and
      // findLexicalMatches issue against the real DB. Both queries use a
      // FIXED parameter shape regardless of whether a subjectTypes filter is
      // active (the filter value is null when absent) specifically so this
      // mock's positional unpacking doesn't have to replicate Prisma's
      // fragment-flattening runtime, which a fully-mocked `db` never runs.
      // Vector values: [vectorLiteral, accountId, subjectTypeFilter, subjectTypeFilter, limit]
      // Lexical values: [accountId, subjectTypeFilter, subjectTypeFilter, query, likeTerm, likeTerm, query, limit]
      // If those shapes change in memory.repository.ts, update this too.
      $queryRaw: vi.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = strings.join(" ");

        if (sql.includes('"embeddingVector"')) {
          const [vectorLiteral, accountId, subjectTypes] = values;
          const limit = values[values.length - 1];
          const queryVec: number[] = JSON.parse(vectorLiteral);
          return memoryStore
            .filter((m) => m.accountId === accountId && !isExpired(m) && m.embedding?.length === queryVec.length)
            .filter((m) => !subjectTypes || subjectTypes.includes(m.subjectType))
            .map((m) => ({ id: m.id, similarity: localCosineSimilarity(m.embedding, queryVec) }))
            .filter((r) => r.similarity > 0.1)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
        }

        const [accountId, subjectTypes, , query] = values;
        const limit = values[values.length - 1];

        return memoryStore
          .filter((m) => m.accountId === accountId && !isExpired(m))
          .filter((m) => !subjectTypes || subjectTypes.includes(m.subjectType))
          .filter((m) => matchesLexically(m, String(query)))
          .slice(0, limit)
          .map((m) => ({ id: m.id }));
      }),
      $executeRaw: vi.fn().mockImplementation(async () => 1),
    },
  };
});

describe("Account Institutional Memory Engine Suite", () => {
  describe("Embeddings & Cosine Similarity", () => {
    it("should compute vector similarity correctly", () => {
      const v1 = [1, 0, 0];
      const v2 = [1, 0, 0];
      const v3 = [0, 1, 0];

      expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0);
      expect(cosineSimilarity(v1, v3)).toBeCloseTo(0.0);
    });

    it("should generate deterministic normalized embeddings", () => {
      const emb1 = generateDeterministicEmbedding("HTS 8471.49.0000 laptop");
      const emb2 = generateDeterministicEmbedding("HTS 8471.49.0000 laptop");
      const emb3 = generateDeterministicEmbedding("Different product chemical");

      expect(emb1.length).toBe(768);
      expect(emb1).toEqual(emb2);
      expect(cosineSimilarity(emb1, emb2)).toBeCloseTo(1.0);
      expect(cosineSimilarity(emb1, emb3)).toBeLessThan(0.99);
    });
  });

  describe("1. Account isolation -- Account A memory is never retrievable by Account B", () => {
    it("keeps AccountContextBuilder results scoped to the requesting account, even with identical query terms", async () => {
      const memA = await MemoryExtractorWorker.processEvent({
        accountId: "ACCOUNT_ALPHA",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-alpha-1",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.49.0000",
        partNumber: "SKU-ISOLATION",
        productDescription: "Confidential Alpha Hardware Component",
        actionType: "HUMAN_DECISION",
      });
      expect(memA).not.toBeNull();
      expect(memA?.accountId).toBe("ACCOUNT_ALPHA");

      const contextB = await AccountContextBuilder.build({
        accountId: "ACCOUNT_BETA",
        task: "HTS_CLASSIFICATION",
        partNumber: "SKU-ISOLATION",
        productDescription: "Confidential Alpha Hardware Component",
      });

      expect(contextB.accountId).toBe("ACCOUNT_BETA");
      expect(contextB.memories.length).toBe(0);
      expect(contextB.memories.some((m) => m.accountId === "ACCOUNT_ALPHA")).toBe(false);
    });

    it("isolates both the lexical and vector retrieval channels directly, not just the combined context builder", async () => {
      const memory = await MemoryExtractorWorker.processEvent({
        accountId: "ACCOUNT_GAMMA",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-gamma-1",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.49.0000",
        partNumber: "SKU-ISOLATION-2",
        productDescription: "Gamma isolation widget",
        actionType: "HUMAN_DECISION",
      });
      expect(memory).not.toBeNull();

      const lexicalFromOtherAccount = await MemoryRepository.findLexicalMatches("ACCOUNT_DELTA", "Gamma isolation widget", 10);
      expect(lexicalFromOtherAccount.length).toBe(0);

      const vectorFromOtherAccount = await MemoryRepository.findVectorMatches("ACCOUNT_DELTA", memory!.embedding, 10);
      expect(vectorFromOtherAccount.length).toBe(0);

      const lexicalFromOwnAccount = await MemoryRepository.findLexicalMatches("ACCOUNT_GAMMA", "Gamma isolation widget", 10);
      expect(lexicalFromOwnAccount.some((m) => m.id === memory?.id)).toBe(true);
    });
  });

  describe("2. Lexical retrieval finds exact HTS codes, SKUs, and part numbers", () => {
    it("finds a memory by its exact HTS code and by its exact part number", async () => {
      const memory = await MemoryExtractorWorker.processEvent({
        accountId: "acct-lexical",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-lexical-1",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.49.0000",
        partNumber: "PN-77821-A",
        productDescription: "rack-mount server enclosure",
        actionType: "HUMAN_DECISION",
      });
      expect(memory).not.toBeNull();

      const byHtsCode = await MemoryRepository.findLexicalMatches("acct-lexical", "8471.49.0000", 10);
      expect(byHtsCode.some((m) => m.id === memory?.id)).toBe(true);

      const byPartNumber = await MemoryRepository.findLexicalMatches("acct-lexical", "PN-77821-A", 10);
      expect(byPartNumber.some((m) => m.id === memory?.id)).toBe(true);

      const byUnrelatedTerm = await MemoryRepository.findLexicalMatches("acct-lexical", "completely unrelated query zzz", 10);
      expect(byUnrelatedTerm.some((m) => m.id === memory?.id)).toBe(false);
    });
  });

  describe("3. Semantic retrieval finds paraphrases with no lexical overlap", () => {
    it("surfaces a memory via the vector channel when the query shares zero words with its content but means the same thing", async () => {
      // A real embedding model would place these close together; the
      // deterministic offline fallback is a character hash with no semantic
      // property, so it can't be trusted to do that itself. We isolate "does
      // the vector channel surface a semantically-close memory" (our code)
      // from "is Gemini's embedding good" (not our code) by making both the
      // write and the paraphrased query resolve to the same vector.
      const sharedEmbedding = generateDeterministicEmbedding("shared-semantic-anchor");
      const embedSpy = vi.spyOn(HybridMemoryRetriever, "embedQuery");
      embedSpy.mockResolvedValueOnce(sharedEmbedding); // consumed while writing the memory

      const memory = await MemoryExtractorWorker.processEvent({
        accountId: "acct-paraphrase",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-paraphrase-1",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "9018.90.7580",
        partNumber: "SKU-PARAPHRASE",
        productDescription: "surgical forceps with ratcheting locking handle",
        actionType: "HUMAN_DECISION",
      });
      expect(memory).not.toBeNull();

      embedSpy.mockResolvedValueOnce(sharedEmbedding); // consumed while embedding the paraphrased query
      const results = await HybridMemoryRetriever.search({
        accountId: "acct-paraphrase",
        task: "HTS_CLASSIFICATION",
        query: "medical clamping instrument with a ratchet grip",
        limit: 5,
      });
      embedSpy.mockRestore();

      const found = results.find((m) => m.id === memory!.id);
      expect(found).toBeDefined();
      expect(found?.lexicalRank).toBeNull(); // no shared words -- this only came from the vector channel
      expect(found?.vectorRank).not.toBeNull();
    });
  });

  describe("4. RRF fuses lexical and semantic retrieval into one ranked list", () => {
    const baseMemory = (id: string, overrides: Partial<AccountMemoryRecord> = {}): AccountMemoryRecord => ({
      id,
      accountId: "acct-rrf",
      type: "FACT",
      subjectType: "CLASSIFICATION",
      subjectId: id,
      content: `memory ${id}`,
      confidence: 1.0,
      validFrom: new Date(),
      validUntil: null,
      sourceType: "VERIFIED_DOCUMENT",
      sourceId: "src",
      supersedesMemoryId: null,
      embedding: [],
      searchVector: "",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    it("includes a lexical-only hit and a vector-only hit in the same fused result set", () => {
      const lexicalOnly = baseMemory("mem-lex-only");
      const vectorOnly = baseMemory("mem-vec-only");

      const fused = fuseRrfResults([lexicalOnly], [vectorOnly]);

      expect(fused.map((m) => m.id).sort()).toEqual(["mem-lex-only", "mem-vec-only"]);
      expect(fused.find((m) => m.id === "mem-lex-only")?.vectorRank).toBeNull();
      expect(fused.find((m) => m.id === "mem-vec-only")?.lexicalRank).toBeNull();
    });

    it("ranks a memory found by both channels above one found by only one, with identical source/type/confidence/age", () => {
      const foundByBoth = baseMemory("mem-both");
      const foundByOneOnly = baseMemory("mem-one-only");

      const fused = fuseRrfResults([foundByBoth, foundByOneOnly], [foundByBoth]);

      expect(fused[0].id).toBe("mem-both");
      expect(fused[0].score).toBeGreaterThan(fused[1].score);
    });

    it("weights human broker decision overrides higher than agent inferences", () => {
      const memHuman = baseMemory("mem-human", { sourceType: "HUMAN_DECISION", content: "human override" });
      const memAgent = baseMemory("mem-agent", { sourceType: "AGENT_INFERENCE", confidence: 0.7, content: "agent inference" });

      const fused = fuseRrfResults([memAgent, memHuman], [memHuman, memAgent]);

      expect(fused[0].id).toBe("mem-human");
      expect(fused[0].score).toBeGreaterThan(fused[1].score);
    });
  });

  describe("5. Expired and superseded memories are excluded from retrieval, but preserved for audit", () => {
    it("excludes a superseded memory from default lookups and search, but includeSuperseded surfaces it", async () => {
      const oldMemory = await MemoryExtractorWorker.processEvent({
        accountId: "acct-expiry",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-expiry-old",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.30.0000",
        partNumber: "SKU-EXPIRY",
        productDescription: "Legacy widget configuration",
        actionType: "HUMAN_DECISION",
      });
      const newMemory = await MemoryExtractorWorker.processEvent({
        accountId: "acct-expiry",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-expiry-new",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.49.0000",
        originalHtsCode: "8471.30.0000",
        partNumber: "SKU-EXPIRY",
        productDescription: "Legacy widget configuration",
        actionType: "APPROVE_OVERRIDE",
      });
      expect(newMemory?.supersedesMemoryId).toBe(oldMemory?.id);

      const activeOnly = await MemoryRepository.findMemoriesByAccount("acct-expiry", { subjectType: "CLASSIFICATION" });
      expect(activeOnly.some((m) => m.id === oldMemory?.id)).toBe(false);
      expect(activeOnly.some((m) => m.id === newMemory?.id)).toBe(true);

      const withHistory = await MemoryRepository.findMemoriesByAccount("acct-expiry", {
        subjectType: "CLASSIFICATION",
        includeSuperseded: true,
      });
      expect(withHistory.some((m) => m.id === oldMemory?.id)).toBe(true);

      // The raw-SQL search paths must independently exclude the expired memory too.
      const lexicalResults = await MemoryRepository.findLexicalMatches("acct-expiry", "Legacy widget configuration", 10);
      expect(lexicalResults.some((m) => m.id === oldMemory?.id)).toBe(false);
      expect(lexicalResults.some((m) => m.id === newMemory?.id)).toBe(true);
    });
  });

  describe("6. Human decisions outrank weak AI-generated memories", () => {
    it("scores a HUMAN_DECISION-sourced memory above an AGENT_INFERENCE memory even when the inference is ranked first by both channels", () => {
      const memHuman: AccountMemoryRecord = {
        id: "mem-human",
        accountId: "acct-1",
        type: "DECISION",
        subjectType: "CLASSIFICATION",
        subjectId: "8471.49",
        content: "Acme human broker override HTS 8471.49",
        confidence: 1.0,
        validFrom: new Date(),
        validUntil: null,
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-1",
        supersedesMemoryId: null,
        embedding: [],
        searchVector: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const memAgent: AccountMemoryRecord = {
        ...memHuman,
        id: "mem-agent",
        type: "FACT",
        subjectId: "8471.30",
        content: "AI inferred HTS 8471.30",
        confidence: 0.7,
        sourceType: "AGENT_INFERENCE",
        sourceId: "dec-2",
      };

      // Agent inference ranked #1 by both channels; human decision ranked #2.
      // Source weighting alone must still put the human decision on top.
      const fused = fuseRrfResults([memAgent, memHuman], [memAgent, memHuman]);

      expect(fused[0].id).toBe("mem-human");
      expect(fused[0].score).toBeGreaterThan(fused[1].score);
    });
  });

  describe("7. Duplicate memories are consolidated, not multiplied", () => {
    it("reinforces the existing memory with new evidence instead of creating a duplicate row when the same fact is re-observed", async () => {
      const first = await MemoryExtractorWorker.processEvent({
        accountId: "acct-dedup",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-dedup-1",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.49.0000",
        partNumber: "SKU-DEDUP",
        productDescription: "Recurring widget",
        actionType: "HUMAN_DECISION",
      });
      expect(first).not.toBeNull();
      expect(first?.evidence?.length).toBe(1);

      // Same fact, re-derived from a different shipment's decision -- same
      // resulting content, different sourceId.
      const second = await MemoryExtractorWorker.processEvent({
        accountId: "acct-dedup",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-dedup-2",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.49.0000",
        partNumber: "SKU-DEDUP",
        productDescription: "Recurring widget",
        actionType: "HUMAN_DECISION",
      });

      expect(second?.id).toBe(first?.id);
      expect(second?.evidence?.length).toBe(2);

      const all = await MemoryRepository.findMemoriesByAccount("acct-dedup", { subjectType: "CLASSIFICATION" });
      expect(all.filter((m) => m.subjectId === "SKU-DEDUP").length).toBe(1);
    });
  });

  describe("8. Contradictory memories are preserved via supersession, not deleted", () => {
    it("should NOT supersede an unrelated memory that merely shares subjectType and mentions HTS", async () => {
      // A prior, unrelated classification memory for a different SKU. It
      // mentions "HTS" in its content, same as almost every classification
      // memory does -- the old heuristic (`content.includes("HTS")`) treated
      // that as enough to mark it superseded by any new same-subjectType
      // memory, regardless of whether it was actually about the same product.
      const unrelated = await MemoryExtractorWorker.processEvent({
        accountId: "acct-supersede",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-unrelated",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "3926.90.9989",
        partNumber: "SKU-UNRELATED",
        productDescription: "Plastic housing bracket",
        actionType: "HUMAN_DECISION",
      });
      expect(unrelated?.validUntil).toBeNull();

      const newMemory = await MemoryExtractorWorker.processEvent({
        accountId: "acct-supersede",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-100",
        task: "HTS_CLASSIFICATION",
        decisionSummary: "Broker changed HTS code from 8471.30 to 8471.49",
        proposedHtsCode: "8471.49.0000",
        originalHtsCode: "8471.30.0000",
        productDescription: "Enterprise Server Module",
        partNumber: "SKU-8821",
        humanNotes: "Customer verified processing server unit config.",
        actionType: "APPROVE_OVERRIDE",
      });

      expect(newMemory?.supersedesMemoryId).toBeNull();

      const stillActive = await MemoryRepository.findMemoriesByAccount("acct-supersede", {
        subjectType: "CLASSIFICATION",
      });
      const unrelatedRecord = stillActive.find((m) => m.id === unrelated?.id);
      expect(unrelatedRecord?.validUntil).toBeNull();
    });

    it("keeps the contradicted old value queryable with its own closed validity window, rather than deleting it", async () => {
      const oldMemory = await MemoryExtractorWorker.processEvent({
        accountId: "acct-supersede-2",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-old",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.30.0000",
        partNumber: "SKU-SAME",
        productDescription: "Enterprise Server Module",
        actionType: "HUMAN_DECISION",
      });

      const newMemory = await MemoryExtractorWorker.processEvent({
        accountId: "acct-supersede-2",
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-new",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.49.0000",
        originalHtsCode: "8471.30.0000",
        partNumber: "SKU-SAME",
        productDescription: "Enterprise Server Module",
        actionType: "APPROVE_OVERRIDE",
      });

      expect(newMemory?.supersedesMemoryId).toBe(oldMemory?.id);

      const withHistory = await MemoryRepository.findMemoriesByAccount("acct-supersede-2", {
        subjectType: "CLASSIFICATION",
        includeSuperseded: true,
      });
      const oldRecord = withHistory.find((m) => m.id === oldMemory?.id);
      expect(oldRecord).toBeDefined();
      expect(oldRecord?.validUntil).not.toBeNull(); // closed, not erased
      expect(oldRecord?.content).toContain("8471.30.0000"); // the contradicted value is still readable
    });
  });

  describe("9. Memory retrieval failures degrade gracefully and never break the caller", () => {
    it("AccountContextBuilder.build returns an empty context instead of throwing when the DB layer fails", async () => {
      const queryRawMock = vi.mocked(db.$queryRaw);
      queryRawMock.mockRejectedValueOnce(new Error("connection reset"));
      queryRawMock.mockRejectedValueOnce(new Error("connection reset"));

      const context = await AccountContextBuilder.build({
        accountId: "acct-failure",
        task: "HTS_CLASSIFICATION",
        productDescription: "Something that would normally be searched for",
      });

      expect(context.memories).toEqual([]);
      expect(context.memoryCount).toBe(0);
      expect(typeof context.formattedText).toBe("string");
      expect(context.formattedText.length).toBeGreaterThan(0);
    });
  });

  describe("10. Asynchronous memory processing is idempotent", () => {
    it("replaying the same domain event (e.g. an Inngest retry) does not create a duplicate memory or duplicate evidence", async () => {
      const input = {
        accountId: "acct-idempotent",
        sourceType: "HUMAN_DECISION" as const,
        sourceId: "dec-idempotent-1",
        task: "HTS_CLASSIFICATION" as const,
        proposedHtsCode: "8471.49.0000",
        partNumber: "SKU-IDEMPOTENT",
        productDescription: "Retried widget",
        actionType: "HUMAN_DECISION" as const,
      };

      const first = await MemoryExtractorWorker.processEvent(input);
      const retry = await MemoryExtractorWorker.processEvent(input); // identical sourceId -- simulates a retry

      expect(retry?.id).toBe(first?.id);
      expect(retry?.evidence?.length).toBe(1); // not 2 -- the retry is a true no-op, not a second reinforcement

      const all = await MemoryRepository.findMemoriesByAccount("acct-idempotent", { subjectType: "CLASSIFICATION" });
      expect(all.filter((m) => m.subjectId === "SKU-IDEMPOTENT").length).toBe(1);
    });
  });

  describe("11. Task-specific context differs appropriately between agents", () => {
    it("returns task-specific formatted context for HTS, Origin, Valuation, and Filing", async () => {
      const htsContext = await AccountContextBuilder.build({
        accountId: "acct-acme",
        task: "HTS_CLASSIFICATION",
        productDescription: "Custom circuit board assembly",
        partNumber: "PCB-9001",
      });
      expect(htsContext.formattedText).toContain("ACCOUNT HISTORICAL CONTEXT (HTS_CLASSIFICATION)");

      const originContext = await AccountContextBuilder.build({
        accountId: "acct-acme",
        task: "ORIGIN_DETERMINATION",
        supplierName: "Acme Industrial Taiwan Ltd",
      });
      expect(originContext.formattedText).toContain("ACCOUNT HISTORICAL CONTEXT (ORIGIN_DETERMINATION)");

      const valuationContext = await AccountContextBuilder.build({ accountId: "acct-acme", task: "VALUATION" });
      expect(valuationContext.formattedText).toContain("ACCOUNT HISTORICAL CONTEXT (VALUATION)");

      const filingContext = await AccountContextBuilder.build({ accountId: "acct-acme", task: "FILING" });
      expect(filingContext.formattedText).toContain("ACCOUNT HISTORICAL CONTEXT (FILING)");
    });

    it("actually restricts each task to its own relevant memory -- not just different header text over the same results", async () => {
      const accountId = "acct-task-scoped";

      const clsMem = await MemoryExtractorWorker.processEvent({
        accountId,
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-cls",
        task: "HTS_CLASSIFICATION",
        proposedHtsCode: "8471.49.0000",
        partNumber: "SKU-TASKSCOPE",
        productDescription: "task-scoped widget",
        actionType: "HUMAN_DECISION",
      });
      const originMem = await MemoryExtractorWorker.processEvent({
        accountId,
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-origin",
        task: "ORIGIN_DETERMINATION",
        supplierName: "Task Scoped Supplier Co",
        decisionSummary: "Origin confirmed as Vietnam for this supplier",
        actionType: "HUMAN_DECISION",
      });
      const valMem = await MemoryExtractorWorker.processEvent({
        accountId,
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-val",
        task: "VALUATION",
        decisionSummary: "Buyer assist of $4,200 applies to this account's tooling",
        actionType: "HUMAN_DECISION",
      });
      const filingMem = await MemoryExtractorWorker.processEvent({
        accountId,
        sourceType: "HUMAN_DECISION",
        sourceId: "dec-filing",
        task: "FILING",
        decisionSummary: "Account requires a PGA disclaimer on all entries",
        actionType: "HUMAN_DECISION",
      });
      expect([clsMem, originMem, valMem, filingMem].every(Boolean)).toBe(true);

      const htsContext = await AccountContextBuilder.build({
        accountId,
        task: "HTS_CLASSIFICATION",
        partNumber: "SKU-TASKSCOPE",
        productDescription: "task-scoped widget",
      });
      const htsIds = htsContext.memories.map((m) => m.id);
      expect(htsIds).toContain(clsMem?.id);
      expect(htsIds).not.toContain(originMem?.id);
      expect(htsIds).not.toContain(valMem?.id);
      expect(htsIds).not.toContain(filingMem?.id);

      // Valuation and Filing operate at the shipment level, not a specific
      // product/SKU -- they have no natural free-text query to search with,
      // so they must fall back to the account's relevant-subjectType memory
      // rather than always returning zero results.
      const valuationContext = await AccountContextBuilder.build({ accountId, task: "VALUATION" });
      const valIds = valuationContext.memories.map((m) => m.id);
      expect(valIds).toContain(valMem?.id);
      expect(valIds).not.toContain(clsMem?.id);
      expect(valIds).not.toContain(filingMem?.id);

      const filingContext = await AccountContextBuilder.build({ accountId, task: "FILING" });
      const filingIds = filingContext.memories.map((m) => m.id);
      expect(filingIds).toContain(filingMem?.id);
      expect(filingIds).not.toContain(valMem?.id);

      const originContext = await AccountContextBuilder.build({
        accountId,
        task: "ORIGIN_DETERMINATION",
        supplierName: "Task Scoped Supplier Co",
      });
      const originIds = originContext.memories.map((m) => m.id);
      expect(originIds).toContain(originMem?.id);
      expect(originIds).not.toContain(clsMem?.id);
    });
  });
});
