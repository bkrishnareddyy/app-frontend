import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  cosineSimilarity,
  fuseRrfResults,
  generateDeterministicEmbedding,
  AccountContextBuilder,
  MemoryExtractorWorker,
} from "@/modules/memory";
import type { AccountMemoryRecord } from "@/modules/memory/memory.types";

// Mock db for testing
vi.mock("@/lib/db", () => {
  const memoryStore: AccountMemoryRecord[] = [];
  const evidenceStore: any[] = [];

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
            if (where.subjectType && m.subjectType !== where.subjectType) return false;
            if (where.validUntil === null && m.validUntil !== null) return false;
            return true;
          });
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
          }
          return rec;
        }),
        count: vi.fn().mockImplementation(async () => memoryStore.length),
        groupBy: vi.fn().mockImplementation(async () => []),
      },
      memoryEvidence: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          const ev = { id: `ev-${Date.now()}`, ...data, createdAt: new Date() };
          evidenceStore.push(ev);
          return ev;
        }),
      },
      agentDecision: {
        count: vi.fn().mockImplementation(async () => 10),
      },
    },
  };
});

describe("Account Institutional Memory Engine Suite", () => {

  describe("1. Cosine Similarity & Deterministic Embedding", () => {
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

  describe("2. Reciprocal Rank Fusion & Source Weighting", () => {
    it("should weight human broker decision overrides higher than agent inferences", () => {
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
        id: "mem-agent",
        accountId: "acct-1",
        type: "FACT",
        subjectType: "CLASSIFICATION",
        subjectId: "8471.30",
        content: "AI inferred HTS 8471.30",
        confidence: 0.7,
        validFrom: new Date(),
        validUntil: null,
        sourceType: "AGENT_INFERENCE",
        sourceId: "dec-2",
        supersedesMemoryId: null,
        embedding: [],
        searchVector: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const lexicalResults = [memAgent, memHuman];
      const vectorResults = [memHuman, memAgent];

      const fused = fuseRrfResults(lexicalResults, vectorResults);

      expect(fused.length).toBe(2);
      // Human decision override should be top ranked due to 1.5x source weight
      expect(fused[0].id).toBe("mem-human");
      expect(fused[0].score).toBeGreaterThan(fused[1].score);
    });
  });

  describe("3. Account Isolation & Context Building", () => {
    it("should build task-specific context tailored to HTS vs Origin vs Valuation", async () => {
      const context = await AccountContextBuilder.build({
        accountId: "acct-acme",
        task: "HTS_CLASSIFICATION",
        productDescription: "Custom circuit board assembly",
        partNumber: "PCB-9001",
      });

      expect(context.accountId).toBe("acct-acme");
      expect(context.task).toBe("HTS_CLASSIFICATION");
      expect(typeof context.formattedText).toBe("string");
      expect(context.formattedText).toContain("ACCOUNT HISTORICAL CONTEXT (HTS_CLASSIFICATION)");
    });
  });

  describe("4. Async Memory Extraction & Supersession", () => {
    it("should process domain event and store durable memory with evidence", async () => {
      const memory = await MemoryExtractorWorker.processEvent({
        accountId: "acct-acme",
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

      expect(memory).not.toBeNull();
      expect(memory?.accountId).toBe("acct-acme");
      expect(memory?.content).toContain("8471.49.0000");
      expect(memory?.sourceType).toBe("HUMAN_DECISION");
    });
  });
});
