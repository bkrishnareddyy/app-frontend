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

    // Search hybrid memory DB
    const memories = await HybridMemoryRetriever.search({
      accountId,
      task,
      query: productDescription || partNumber || "",
      productId,
      partNumber,
      supplierName,
      limit: 6,
    });

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
}
