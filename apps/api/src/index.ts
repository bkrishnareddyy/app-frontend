import { AgentOrchestrator } from "@qubere/ai";

console.log("Starting Qubere API Gateway Service...");

export async function handleDocumentClassificationRequest(documentId: string, fileUrl: string) {
  const jobId = `job_${Date.now()}`;
  console.log(`[API Gateway] Received classification request for Document ${documentId}. Triggering Orchestrator...`);
  
  const result = await AgentOrchestrator.runTradeCompliancePipeline(jobId, documentId, fileUrl);
  return result;
}
