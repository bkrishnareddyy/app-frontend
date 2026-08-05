import { AgentOrchestrator } from "@qubere/ai";

console.log("Qubere AI Trade Compliance Worker listening for queue jobs...");

export async function processBackgroundJob(jobId: string, documentId: string, fileUrl: string) {
  console.log(`[Async Worker] Processing job ${jobId} for document ${documentId}...`);
  const result = await AgentOrchestrator.runTradeCompliancePipeline(jobId, documentId, fileUrl);
  console.log(`[Async Worker] Job ${jobId} completed successfully.`);
  return result;
}
