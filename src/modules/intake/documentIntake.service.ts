import {
  DocumentIntakeAgent,
  DocumentIntakeAgentInput,
  DocumentIntakeAgentOutput,
  DocumentType,
  PageAnalysisResult,
  agentEventBus,
} from "./documentIntakeAgent";

export type {
  DocumentType,
  PageAnalysisResult as DocumentPageClassification,
  DocumentIntakeAgentInput as IngestDocumentInput,
  DocumentIntakeAgentOutput as DocumentPacketResult,
};

export class DocumentIntakeService {
  /**
   * Delegates ingestion and packet stitching to DocumentIntakeAgent.
   */
  static async ingestDocumentPacket(
    input: DocumentIntakeAgentInput
  ): Promise<DocumentIntakeAgentOutput> {
    return DocumentIntakeAgent.execute(input);
  }
}

export { DocumentIntakeAgent, agentEventBus };
