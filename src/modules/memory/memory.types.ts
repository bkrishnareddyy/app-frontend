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
  agentAcceptanceRateBeforeAfter: {
    beforeRate: number;
    afterRate: number;
  };
  overrideReductionRate: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
}
