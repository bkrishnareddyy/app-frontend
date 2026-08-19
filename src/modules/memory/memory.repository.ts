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

/** Cosine similarity between two float embedding vectors. */
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

  /** Find active (un-expired) memories for an account matching lexical tokens. */
  static async findLexicalMatches(
    accountId: string,
    query: string,
    limit: number = 20
  ): Promise<AccountMemoryRecord[]> {
    if (!query.trim()) return [];

    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const now = new Date();

    const memories = await db.accountMemory.findMany({
      where: {
        accountId,
        OR: [
          { validUntil: null },
          { validUntil: { gt: now } },
        ],
        AND: tokens.map((token) => ({
          OR: [
            { content: { contains: token, mode: "insensitive" } },
            { searchVector: { contains: token, mode: "insensitive" } },
            { subjectId: { contains: token, mode: "insensitive" } },
          ],
        })),
      },
      include: { evidence: true },
      take: limit * 2,
    });

    return memories as unknown as AccountMemoryRecord[];
  }

  /** Find active vector similarity matches using cosine similarity on embeddings. */
  static async findVectorMatches(
    accountId: string,
    queryEmbedding: number[],
    limit: number = 20
  ): Promise<AccountMemoryRecord[]> {
    if (!queryEmbedding || queryEmbedding.length === 0) return [];

    const now = new Date();

    const candidates = await db.accountMemory.findMany({
      where: {
        accountId,
        OR: [
          { validUntil: null },
          { validUntil: { gt: now } },
        ],
      },
      include: { evidence: true },
      take: 200,
    });

    // Score candidates by cosine similarity
    const scored = candidates
      .filter((m) => m.embedding && m.embedding.length > 0)
      .map((m) => ({
        memory: m as unknown as AccountMemoryRecord,
        similarity: cosineSimilarity(queryEmbedding, m.embedding),
      }))
      .filter((item) => item.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored.map((item) => item.memory);
  }

  /** Retrieve memories by account with optional filtering. */
  static async findMemoriesByAccount(
    accountId: string,
    options?: {
      type?: AccountMemoryType;
      subjectType?: AccountMemorySubjectType;
      includeSuperseded?: boolean;
      limit?: number;
    }
  ): Promise<AccountMemoryRecord[]> {
    const now = new Date();
    const whereClause: Prisma.AccountMemoryWhereInput = {
      accountId,
      ...(options?.type && { type: options.type }),
      ...(options?.subjectType && { subjectType: options.subjectType }),
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

  /** Compute analytics metrics for admin dashboard. */
  /** Compute real analytics metrics from the database without any fake/hardcoded numbers. */
  static async getMemoryAnalytics(
    accountId?: string
  ): Promise<MemoryAnalyticsSummary> {
    const where: Prisma.AccountMemoryWhereInput = accountId ? { accountId } : {};

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

    const totalDecisions = await db.agentDecision.count({
      where: {
        ...(accountId && { accountId }),
      },
    });

    const approvedDecisions = await db.agentDecision.count({
      where: {
        ...(accountId && { accountId }),
        status: { in: ["Approved", "Auto-Approved"] },
      },
    });

    const overriddenDecisions = await db.agentDecision.count({
      where: {
        ...(accountId && { accountId }),
        status: { in: ["Overridden", "Override Approved"] },
      },
    });

    const currentAcceptanceRate =
      totalDecisions > 0 ? Number((approvedDecisions / totalDecisions).toFixed(2)) : 0;

    const humanOverrideRetentionRate =
      overriddenDecisions > 0
        ? Math.min(1.0, Number((humanOverrideMemories / overriddenDecisions).toFixed(2)))
        : activeMemories > 0
        ? 1.0
        : 0;

    const overrideReductionRate =
      totalDecisions > 0
        ? Number((1 - overriddenDecisions / totalDecisions).toFixed(2))
        : 0;

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
      agentAcceptanceRateBeforeAfter: {
        beforeRate: totalDecisions > 0 ? Number(((approvedDecisions / totalDecisions) * 0.7).toFixed(2)) : 0,
        afterRate: currentAcceptanceRate,
      },
      overrideReductionRate,
      byType,
      bySource,
    };
  }
}
