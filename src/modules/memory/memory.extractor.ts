import { MemoryRepository } from "./memory.repository";
import { HybridMemoryRetriever } from "./memory.retriever";
import type {
  MemoryExtractionInput,
  AccountMemoryRecord,
} from "./memory.types";
import {
  AccountMemoryType,
  AccountMemorySubjectType,
} from "@prisma/client";

export class MemoryExtractorWorker {
  /** Asynchronously process domain event to extract durable account knowledge. */
  static async processEvent(input: MemoryExtractionInput): Promise<AccountMemoryRecord | null> {
    try {
      const {
        accountId,
        sourceType,
        sourceId,
        task = "HTS_CLASSIFICATION",
        decisionSummary,
        proposedHtsCode,
        originalHtsCode,
        productDescription,
        partNumber,
        supplierName,
        humanNotes,
        actionType,
      } = input;

      if (!accountId) return null;

      // Idempotency: the same domain event (accountId + sourceType +
      // sourceId) must produce the same end state whether it's processed
      // once or replayed -- an Inngest retry after a transient failure must
      // not create a second memory or a second evidence row for a write that
      // actually already landed.
      if (sourceId) {
        const alreadyProcessed = await MemoryRepository.findMemoryByEvidenceSource(
          accountId,
          sourceType,
          sourceId
        );
        if (alreadyProcessed) return alreadyProcessed;
      }

      // Determine subjectType & subjectId
      let subjectType: AccountMemorySubjectType = "CLASSIFICATION";
      let subjectId: string | null = partNumber || proposedHtsCode || null;

      if (task === "ORIGIN_DETERMINATION" || supplierName) {
        subjectType = "SUPPLIER";
        subjectId = supplierName || subjectId;
      } else if (task === "VALUATION") {
        subjectType = "VALUATION";
      } else if (task === "FILING") {
        subjectType = "FILING";
      }

      // Synthesize durable memory statement
      let content = "";
      let memoryType: AccountMemoryType = "DECISION";

      if (proposedHtsCode) {
        if (originalHtsCode && originalHtsCode !== proposedHtsCode) {
          content = `Account classified product "${productDescription || partNumber || "item"}" as HTS ${proposedHtsCode} (overriding previous AI recommendation ${originalHtsCode}).`;
          memoryType = "DECISION";
        } else {
          content = `Account uses HTS ${proposedHtsCode} for product "${productDescription || partNumber || "item"}".`;
          memoryType = "FACT";
        }
      } else if (humanNotes) {
        content = `Account procedure for ${task}: ${humanNotes}`;
        memoryType = "PROCEDURE";
      } else if (decisionSummary) {
        content = `Account historical decision (${task}): ${decisionSummary}`;
        memoryType = "DECISION";
      } else {
        return null;
      }

      if (humanNotes && !content.includes(humanNotes)) {
        content += ` Reason: ${humanNotes}`;
      }

      // Check if a prior memory already exists for this exact account & subject.
      // Supersession must key on subject identity (same product/SKU/supplier),
      // not on loose text matching -- a broader "content contains HTS" check
      // used to mark any same-subjectType memory as superseded, which could
      // silently expire an unrelated product's valid classification just
      // because both memories happened to mention "HTS".
      let supersedesMemoryId: string | null = null;
      if (subjectId) {
        const existingMemories = await MemoryRepository.findMemoriesByAccount(accountId, {
          subjectType,
          limit: 25,
        });

        // Same subject, same fact re-observed (e.g. the same HTS code
        // re-approved on another shipment): consolidate into the existing
        // memory's evidence trail instead of spawning a duplicate row.
        const exactDuplicate = existingMemories.find(
          (existing) => existing.subjectId === subjectId && existing.content === content
        );
        if (exactDuplicate) {
          return MemoryRepository.reinforceMemory(exactDuplicate.id, accountId, {
            sourceType: sourceType || "HUMAN_DECISION",
            sourceId,
            excerpt: humanNotes || decisionSummary || `Decision record ${sourceId}`,
            confidence: actionType === "APPROVE_OVERRIDE" || actionType === "HUMAN_DECISION" ? 1.0 : 0.8,
          });
        }

        const supersedeTarget = existingMemories.find(
          (existing) => existing.subjectId === subjectId && existing.content !== content
        );
        supersedesMemoryId = supersedeTarget?.id ?? null;
      }

      // Generate embedding vector
      const embedding = await HybridMemoryRetriever.embedQuery(content);

      // Create new memory record with evidence
      const newMemory = await MemoryRepository.createMemory({
        accountId,
        type: memoryType,
        subjectType,
        subjectId,
        content,
        confidence: actionType === "APPROVE_OVERRIDE" || actionType === "HUMAN_DECISION" ? 1.0 : 0.8,
        validFrom: new Date(),
        validUntil: null,
        sourceType: sourceType || "HUMAN_DECISION",
        sourceId,
        supersedesMemoryId,
        embedding,
        searchVector: `${content} ${partNumber || ""} ${proposedHtsCode || ""}`.toLowerCase(),
        evidenceExcerpt: humanNotes || decisionSummary || `Decision record ${sourceId}`,
      });

      // Handle supersession of old memory if found
      if (supersedesMemoryId) {
        await MemoryRepository.supersedeMemory(supersedesMemoryId, newMemory.id);
      }

      return newMemory;
    } catch (err) {
      console.error("[MemoryExtractorWorker] Error extracting memory:", err);
      // Non-blocking for core API callers
      return null;
    }
  }
}
