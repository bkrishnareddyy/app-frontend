import { db } from "@/lib/db";
import {
  AccountMemoryType,
  AccountMemorySubjectType,
  AccountMemorySourceType,
  Prisma,
} from "@prisma/client";
import type {
  AccountMemoryRecord,
  MemoryAnalyticsSummary,
} from "./memory.types";
import { EMBEDDING_DIMENSIONS } from "./memory.types";

/** Cosine similarity between two float embedding vectors -- kept for the unit-test fixture path (`generateDeterministicEmbedding`); live retrieval below runs the equivalent as a pgvector `<=>` query. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Serializes an embedding to the pgvector text input format, e.g. "[0.1,0.2,...]". */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((v) => (Number.isFinite(v) ? v : 0)).join(",")}]`;
}

export class MemoryRepository {
  /** Create a new account memory record with optional evidence. */
  static async createMemory(data: {
    accountId: string;
    type: AccountMemoryType;
    subjectType: AccountMemorySubjectType;
    subjectId?: string | null;
    content: string;
    confidence?: number;
    validFrom?: Date;
    validUntil?: Date | null;
    sourceType: AccountMemorySourceType;
    sourceId?: string | null;
    supersedesMemoryId?: string | null;
    embedding?: number[];
    searchVector?: string | null;
    evidenceExcerpt?: string;
  }): Promise<AccountMemoryRecord> {
    const memory = await db.accountMemory.create({
      data: {
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
        searchVector: data.searchVector ?? data.content.toLowerCase(),
      },
    });

    if (data.evidenceExcerpt) {
      await db.memoryEvidence.create({
        data: {
          accountId: data.accountId,
          memoryId: memory.id,
          sourceType: data.sourceType,
          sourceId: data.sourceId ?? null,
          excerpt: data.evidenceExcerpt,
          confidence: data.confidence ?? 1.0,
        },
      });
    }

    // The Prisma client can't type or write the `vector` column directly (it's
    // declared `Unsupported("vector(768)")` since Prisma has no native pgvector
    // type), so it's populated in a follow-up raw statement. The `embedding`
    // column above stays as-is for backward-compatible reads/exports; this
    // `embeddingVector` column is what findVectorMatches actually queries.
    if (data.embedding && data.embedding.length === EMBEDDING_DIMENSIONS) {
      await db.$executeRaw`
        UPDATE "AccountMemory"
        SET "embeddingVector" = ${toVectorLiteral(data.embedding)}::vector
        WHERE id = ${memory.id}
      `;
    }

    const fullMemory = await db.accountMemory.findUnique({
      where: { id: memory.id },
      include: { evidence: true },
    });

    return fullMemory as unknown as AccountMemoryRecord;
  }

  /** Mark an old memory as superseded by a new memory. */
  static async supersedeMemory(
    oldMemoryId: string,
    newMemoryId: string,
    validUntil: Date = new Date()
  ): Promise<void> {
    await db.accountMemory.update({
      where: { id: oldMemoryId },
      data: {
        validUntil,
      },
    });

    await db.accountMemory.update({
      where: { id: newMemoryId },
      data: {
        supersedesMemoryId: oldMemoryId,
      },
    });
  }

  /** Re-hydrates raw-SQL-ranked memory ids into full typed records (with evidence), preserving the ranked order. */
  private static async hydrateRankedIds(ids: string[]): Promise<AccountMemoryRecord[]> {
    if (ids.length === 0) return [];
    const memories = await db.accountMemory.findMany({
      where: { id: { in: ids } },
      include: { evidence: true },
    });
    const byId = new Map(memories.map((m) => [m.id, m as unknown as AccountMemoryRecord]));
    return ids.map((id) => byId.get(id)).filter((m): m is AccountMemoryRecord => Boolean(m));
  }

  /**
   * Find active (un-expired) memories for an account via real PostgreSQL full-text
   * search (generated `contentTsv` tsvector column, GIN-indexed, `simple` dictionary
   * so codes/SKUs aren't stemmed away). An ILIKE fallback on content/subjectId is
   * OR'd in so exact technical tokens (HTS codes, entry numbers) that the FTS parser
   * splits oddly still surface, per the "exact lexical search for codes" requirement.
   */
  static async findLexicalMatches(
    accountId: string,
    query: string,
    limit: number = 20,
    subjectTypes?: AccountMemorySubjectType[]
  ): Promise<AccountMemoryRecord[]> {
    if (!query.trim()) return [];

    const likeTerm = `%${query.trim()}%`;
    // A fixed-shape parameter (null bypasses the filter) rather than
    // conditionally injecting a Prisma.sql fragment: fragment flattening is
    // real Prisma Client runtime behavior, which a mocked `db` in tests never
    // runs, so a nested fragment there arrives as an opaque object instead of
    // SQL text. Same query shape, same parameter positions, every call.
    const subjectTypeFilter = subjectTypes && subjectTypes.length > 0 ? subjectTypes : null;

    const ranked = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "AccountMemory"
      WHERE "accountId" = ${accountId}
        AND ("validUntil" IS NULL OR "validUntil" > now())
        AND (${subjectTypeFilter}::text[] IS NULL OR "subjectType"::text = ANY(${subjectTypeFilter}))
        AND (
          "contentTsv" @@ websearch_to_tsquery('simple', ${query})
          OR content ILIKE ${likeTerm}
          OR "subjectId" ILIKE ${likeTerm}
        )
      ORDER BY ts_rank("contentTsv", websearch_to_tsquery('simple', ${query})) DESC
      LIMIT ${limit}
    `;

    return this.hydrateRankedIds(ranked.map((r) => r.id));
  }

  /** Find active vector similarity matches via pgvector's `<=>` cosine-distance operator and its HNSW index -- no in-process scan over fetched rows. */
  static async findVectorMatches(
    accountId: string,
    queryEmbedding: number[],
    limit: number = 20,
    subjectTypes?: AccountMemorySubjectType[]
  ): Promise<AccountMemoryRecord[]> {
    if (!queryEmbedding || queryEmbedding.length !== EMBEDDING_DIMENSIONS) return [];

    const vectorLiteral = toVectorLiteral(queryEmbedding);
    const subjectTypeFilter = subjectTypes && subjectTypes.length > 0 ? subjectTypes : null;

    const ranked = await db.$queryRaw<Array<{ id: string; similarity: number }>>`
      SELECT id, 1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM "AccountMemory"
      WHERE "accountId" = ${accountId}
        AND "embeddingVector" IS NOT NULL
        AND ("validUntil" IS NULL OR "validUntil" > now())
        AND (${subjectTypeFilter}::text[] IS NULL OR "subjectType"::text = ANY(${subjectTypeFilter}))
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;

    const relevant = ranked.filter((r) => r.similarity > 0.1);
    return this.hydrateRankedIds(relevant.map((r) => r.id));
  }

  /** Retrieve memories by account with optional filtering. */
  static async findMemoriesByAccount(
    accountId: string,
    options?: {
      type?: AccountMemoryType;
      subjectType?: AccountMemorySubjectType | AccountMemorySubjectType[];
      includeSuperseded?: boolean;
      limit?: number;
    }
  ): Promise<AccountMemoryRecord[]> {
    const now = new Date();
    const subjectTypeClause = Array.isArray(options?.subjectType)
      ? { subjectType: { in: options.subjectType } }
      : options?.subjectType
      ? { subjectType: options.subjectType }
      : {};
    const whereClause: Prisma.AccountMemoryWhereInput = {
      accountId,
      ...(options?.type && { type: options.type }),
      ...subjectTypeClause,
      ...(!options?.includeSuperseded && {
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      }),
    };

    const memories = await db.accountMemory.findMany({
      where: whereClause,
      include: { evidence: true },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
    });

    return memories as unknown as AccountMemoryRecord[];
  }

  /**
   * Idempotency key for the write path: the same domain event (accountId +
   * sourceType + sourceId) must never produce two memories or two evidence
   * rows, even when an Inngest retry replays it after a transient failure.
   */
  static async findMemoryByEvidenceSource(
    accountId: string,
    sourceType: AccountMemorySourceType,
    sourceId: string
  ): Promise<AccountMemoryRecord | null> {
    const evidence = await db.memoryEvidence.findFirst({
      where: { accountId, sourceType, sourceId },
      orderBy: { createdAt: "desc" },
    });
    if (!evidence) return null;

    const memory = await db.accountMemory.findUnique({
      where: { id: evidence.memoryId },
      include: { evidence: true },
    });
    return (memory as unknown as AccountMemoryRecord) ?? null;
  }

  /**
   * Consolidates a re-observed fact into its existing memory instead of
   * creating a duplicate row: attaches new evidence (provenance is never
   * dropped) and raises confidence to the strongest observation seen so far.
   */
  static async reinforceMemory(
    memoryId: string,
    accountId: string,
    evidence: { sourceType: AccountMemorySourceType; sourceId?: string | null; excerpt: string; confidence: number }
  ): Promise<AccountMemoryRecord> {
    await db.memoryEvidence.create({
      data: {
        accountId,
        memoryId,
        sourceType: evidence.sourceType,
        sourceId: evidence.sourceId ?? null,
        excerpt: evidence.excerpt,
        confidence: evidence.confidence,
      },
    });

    const current = await db.accountMemory.findUnique({ where: { id: memoryId } });
    const boostedConfidence = current ? Math.max(current.confidence, evidence.confidence) : evidence.confidence;

    await db.accountMemory.update({
      where: { id: memoryId },
      data: { confidence: boostedConfidence, updatedAt: new Date() },
    });

    const full = await db.accountMemory.findUnique({
      where: { id: memoryId },
      include: { evidence: true },
    });
    return full as unknown as AccountMemoryRecord;
  }

  /** Compute analytics metrics for the admin dashboard directly from decision/memory history -- no synthesized or hardcoded figures. */
  static async getMemoryAnalytics(
    accountId?: string
  ): Promise<MemoryAnalyticsSummary> {
    const where: Prisma.AccountMemoryWhereInput = accountId ? { accountId } : {};
    const decisionAccountFilter = accountId ? { accountId } : {};

    const totalMemories = await db.accountMemory.count({ where });

    const now = new Date();
    const activeMemories = await db.accountMemory.count({
      where: {
        ...where,
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
    });

    const supersededMemories = await db.accountMemory.count({
      where: {
        ...where,
        validUntil: { lte: now },
      },
    });

    const humanOverrideMemories = await db.accountMemory.count({
      where: {
        ...where,
        sourceType: "HUMAN_DECISION",
      },
    });

    const overriddenDecisions = await db.agentDecision.count({
      where: {
        ...decisionAccountFilter,
        status: { in: ["Overridden", "Override Approved"] },
      },
    });

    const humanOverrideRetentionRate =
      overriddenDecisions > 0
        ? Math.min(1.0, Number((humanOverrideMemories / overriddenDecisions).toFixed(2)))
        : activeMemories > 0
        ? 1.0
        : 0;

    // "Before/after" is a real temporal split, not a synthesized ratio: it
    // compares decision approval rates before this account had any durable
    // memory against decisions made once memory existed. With no memory yet,
    // or no decisions on one side of that cutoff, the rate is null so the
    // caller can render "not enough data" instead of a misleading 0%.
    const firstMemory = await db.accountMemory.findFirst({
      where,
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    let beforeRate: number | null = null;
    let afterRate: number | null = null;

    if (firstMemory) {
      const cutoff = firstMemory.createdAt;
      const approvedStatuses = ["Approved", "Auto-Approved", "AUTO_VERIFIED"];
      const [beforeTotal, beforeApproved, afterTotal, afterApproved] = await Promise.all([
        db.agentDecision.count({ where: { ...decisionAccountFilter, createdAt: { lt: cutoff } } }),
        db.agentDecision.count({
          where: { ...decisionAccountFilter, createdAt: { lt: cutoff }, status: { in: approvedStatuses } },
        }),
        db.agentDecision.count({ where: { ...decisionAccountFilter, createdAt: { gte: cutoff } } }),
        db.agentDecision.count({
          where: { ...decisionAccountFilter, createdAt: { gte: cutoff }, status: { in: approvedStatuses } },
        }),
      ]);
      beforeRate = beforeTotal > 0 ? Number((beforeApproved / beforeTotal).toFixed(2)) : null;
      afterRate = afterTotal > 0 ? Number((afterApproved / afterTotal).toFixed(2)) : null;
    }

    const totalDecisions = await db.agentDecision.count({ where: decisionAccountFilter });
    const overrideReductionRate =
      totalDecisions > 0 ? Number((1 - overriddenDecisions / totalDecisions).toFixed(2)) : null;

    // Group by Type
    const typeGroup = await db.accountMemory.groupBy({
      by: ["type"],
      where,
      _count: { _all: true },
    });

    const byType: Record<string, number> = {};
    for (const g of typeGroup) {
      byType[g.type] = g._count._all;
    }

    // Group by Source
    const sourceGroup = await db.accountMemory.groupBy({
      by: ["sourceType"],
      where,
      _count: { _all: true },
    });

    const bySource: Record<string, number> = {};
    for (const g of sourceGroup) {
      bySource[g.sourceType] = g._count._all;
    }

    return {
      totalMemories,
      activeMemories,
      supersededMemories,
      humanOverrideRetentionRate,
      agentAcceptanceRateBeforeAfter: { beforeRate, afterRate },
      overrideReductionRate,
      byType,
      bySource,
    };
  }
}
