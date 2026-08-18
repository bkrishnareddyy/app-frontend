import { MemoryRepository } from "./memory.repository";
import { HybridMemoryRetriever, generateDeterministicEmbedding } from "./memory.retriever";
import type {
  MemoryExtractionInput,
  AccountMemoryRecord,
} from "./memory.types";
import {
  AccountMemoryType,
  AccountMemorySubjectType,
  AccountMemorySourceType,
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

      // Check if a similar active memory already exists for this account & subject
      const existingMemories = await MemoryRepository.findLexicalMatches(
        accountId,
        partNumber || proposedHtsCode || productDescription || "",
        10
      );

      let supersedesMemoryId: string | null = null;
      for (const existing of existingMemories) {
        if (
          existing.subjectType === subjectType &&
          existing.content !== content &&
          (existing.content.includes("HTS") || existing.subjectId === subjectId)
        ) {
          supersedesMemoryId = existing.id;
          break;
        }
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
