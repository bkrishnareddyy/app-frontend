import { HybridMemoryRetriever } from "./memory.retriever";
import type {
  AgentTask,
  AccountContext,
  ScoredMemory,
} from "./memory.types";

export class AccountContextBuilder {
  /** Build task-specific AccountContext for an agent run. */
  static async build(params: {
    accountId: string;
    task: AgentTask;
    shipmentId?: string;
    productId?: string;
    partNumber?: string;
    productDescription?: string;
    supplierName?: string;
  }): Promise<AccountContext> {
    const {
      accountId,
      task,
      productId,
      partNumber,
      productDescription,
      supplierName,
    } = params;

    // Memory is a derived intelligence layer, never the system of record --
    // a retrieval failure (DB hiccup, bad query) must degrade to "no account
    // context available" rather than take down the classify/file/value
    // request that's waiting on it. Every current caller also wraps this in
    // its own try/catch, but that's one guarantee that shouldn't depend on
    // four call sites all remembering to add it -- it belongs here.
    let memories: ScoredMemory[] = [];
    try {
      memories = await HybridMemoryRetriever.search({
        accountId,
        task,
        query: productDescription || partNumber || "",
        productId,
        partNumber,
        supplierName,
        limit: 6,
      });
    } catch (err) {
      console.error("[AccountContextBuilder] Memory retrieval failed, continuing without account context:", err);
    }

    const formattedText = this.formatContextPrompt(task, memories);

    return {
      accountId,
      task,
      memories,
      formattedText,
      memoryCount: memories.length,
    };
  }

  /** Format retrieved memories into a clean prompt section for LLM agents. */
  private static formatContextPrompt(task: AgentTask, memories: ScoredMemory[]): string {
    if (memories.length === 0) {
      return `ACCOUNT HISTORICAL CONTEXT (${task}): None on file for this account/product.`;
    }

    const lines: string[] = [`ACCOUNT HISTORICAL CONTEXT (${task}):`];

    memories.forEach((m, idx) => {
      const sourceTag =
        m.sourceType === "HUMAN_DECISION"
          ? "[HUMAN BROKER APPROVED]"
          : m.sourceType === "FILING_OUTCOME"
          ? "[CUSTOMS FILING CONFIRMED]"
          : "[FACT]";

      const evidenceStr =
        m.evidence && m.evidence.length > 0
          ? ` (Evidence: "${m.evidence[0].excerpt}")`
          : "";

      lines.push(
        `${idx + 1}. ${sourceTag} ${m.content}${evidenceStr} (Confidence: ${(
          m.confidence * 100
        ).toFixed(0)}%)`
      );
    });

    lines.push(
      "Note: Prior human broker approvals and account decisions carry higher authority than default agent inferences."
    );

    return lines.join("\n");
  }

  /**
   * Compact form of retrieved memories for agents that have no LLM prompt to
   * inject `formattedText` into (the deterministic rules engines). Callers
   * attach this to `evidenceItems`/`dataSources` so retrieval is at minimum
   * visible on the decision record, instead of being fetched and discarded.
   */
  static summarizeForEvidence(context: AccountContext): Array<{
    content: string;
    sourceType: ScoredMemory["sourceType"];
    confidence: number;
  }> {
    return context.memories.map((m) => ({
      content: m.content,
      sourceType: m.sourceType,
      confidence: m.confidence,
    }));
  }
}
