import type {
  AccountMemoryType,
  AccountMemorySubjectType,
  AccountMemorySourceType,
} from "@prisma/client";

export type AgentTask =
  | "HTS_CLASSIFICATION"
  | "ORIGIN_DETERMINATION"
  | "VALUATION"
  | "FILING";

/** Dimensionality of stored embeddings -- must match the pgvector column (vector(768)) and the Gemini outputDimensionality config. */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Which memory subjectTypes are relevant to each agent task -- e.g. a
 * VALUATION agent has no use for a SUPPLIER-origin memory. Used to scope
 * retrieval so every agent doesn't see the same undifferentiated pile of
 * account memory (spec: "Do not send the same giant memory context to every
 * agent"). Also doubles as the retrieval path for tasks with no natural
 * free-text query (Valuation, Filing operate at the shipment level, not a
 * specific product/SKU) -- see HybridMemoryRetriever.search's recency
 * fallback.
 */
export const TASK_SUBJECT_TYPES: Record<AgentTask, AccountMemorySubjectType[]> = {
  HTS_CLASSIFICATION: ["CLASSIFICATION", "PRODUCT"],
  ORIGIN_DETERMINATION: ["ORIGIN", "SUPPLIER"],
  VALUATION: ["VALUATION"],
  FILING: ["FILING", "SHIPMENT"],
};

export interface MemoryEvidenceRecord {
  id: string;
  accountId: string;
  memoryId: string;
  sourceType: AccountMemorySourceType;
  sourceId: string | null;
  excerpt: string;
  confidence: number;
  createdAt: Date;
}

export interface AccountMemoryRecord {
  id: string;
  accountId: string;
  type: AccountMemoryType;
  subjectType: AccountMemorySubjectType;
  subjectId: string | null;
  content: string;
  confidence: number;
  validFrom: Date;
  validUntil: Date | null;
  sourceType: AccountMemorySourceType;
  sourceId: string | null;
  supersedesMemoryId: string | null;
  embedding: number[];
  searchVector: string | null;
  createdAt: Date;
  updatedAt: Date;
  evidence?: MemoryEvidenceRecord[];
}

export interface MemorySearchQuery {
  accountId: string;
  task: AgentTask;
  query?: string;
  productId?: string;
  partNumber?: string;
  supplierName?: string;
  limit?: number;
  /** Restricts retrieval to these subjectTypes; defaults to TASK_SUBJECT_TYPES[task] when omitted by the caller. */
  subjectTypes?: AccountMemorySubjectType[];
}

export interface ScoredMemory extends AccountMemoryRecord {
  score: number;
  lexicalRank: number | null;
  vectorRank: number | null;
  rrfScore: number;
}

export interface AccountContext {
  accountId: string;
  task: AgentTask;
  memories: ScoredMemory[];
  formattedText: string;
  memoryCount: number;
}

export interface MemoryExtractionInput {
  accountId: string;
  sourceType: AccountMemorySourceType;
  sourceId: string;
  task?: AgentTask;
  decisionSummary?: string;
  proposedHtsCode?: string;
  originalHtsCode?: string;
  productDescription?: string;
  partNumber?: string;
  supplierName?: string;
  humanNotes?: string;
  actionType: "APPROVE_OVERRIDE" | "EDIT_VALUE" | "HUMAN_DECISION" | "AGENT_INFERENCE";
}

export interface MemoryAnalyticsSummary {
  totalMemories: number;
  activeMemories: number;
  supersededMemories: number;
  humanOverrideRetentionRate: number;
  /**
   * Real before/after decision-approval rates, split at the timestamp of the
   * account's first durable memory. Null (not 0 or a synthesized ratio) when
   * there isn't enough decision history on one side of that cutoff to compute
   * a rate -- callers must render that as "not enough data yet", not "0%".
   */
  agentAcceptanceRateBeforeAfter: {
    beforeRate: number | null;
    afterRate: number | null;
  };
  overrideReductionRate: number | null;
  byType: Record<string, number>;
  bySource: Record<string, number>;
}
