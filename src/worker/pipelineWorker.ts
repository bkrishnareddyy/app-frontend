import { PgQueue } from "../lib/queue/pgQueue";
import { ComplianceWorkflowEngine } from "../modules/agents/workflowEngine";
import { AgentState } from "../modules/agents/agentState";
import { PipelineOrchestrationInput } from "../modules/agents/workflowEngine";

/**
 * PG Queue Worker Daemon
 * Continually polls the 'PipelineJob' table for PENDING or STALLED jobs.
 * Executes a single AI Agent Step and pushes the state back to the DB.
 */
async function startWorker() {
  console.log("🚀 Starting PG Queue Pipeline Worker...");
  
  const engine = new ComplianceWorkflowEngine();

  // Infinite polling loop
  while (true) {
    try {
      const job = await PgQueue.dequeueNextJob();
      
      if (!job) {
        // No pending jobs, wait for 2 seconds before polling again
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      console.log(`[Worker] Picked up Job ${job.id} for Shipment ${job.shipmentId} (Step ${job.currentStep}/${job.totalSteps})`);

      // Rehydrate the AgentState
      const state = AgentState.fromJSON(job.state);
      
      const input: PipelineOrchestrationInput = {
        accountId: job.accountId,
        userId: job.userId,
        shipmentId: job.shipmentId,
        fileName: state.intakeOutput?.fileName,
      };

      try {
        const { state: updatedState, output: resultOutput } = await engine.executePipeline(input);

        await PgQueue.logStepExecution({
          jobId: job.id,
          stepNumber: job.currentStep,
          agentName: "Pipeline Orchestrator",
          status: resultOutput.status,
          output: resultOutput,
        });

        console.log(`[Worker] Job ${job.id} COMPLETED.`);
        await PgQueue.completeJob(job.id, updatedState.toJSON());

      } catch (stepError: any) {
        console.error(`[Worker] Job ${job.id} FAILED at step ${job.currentStep}:`, stepError);
        await PgQueue.logStepExecution({
          jobId: job.id,
          stepNumber: job.currentStep,
          agentName: `Agent Step ${job.currentStep}`,
          status: "FAILED",
          errorMessage: stepError.message || "Unknown Error",
        });
        await PgQueue.failJob(job.id, stepError.message || "Unknown Error", state.toJSON());
      }
      
    } catch (err) {
      console.error("[Worker] Polling error:", err);
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Backoff on critical failure
    }
  }
}

// Allow running directly via ts-node
if (require.main === module) {
  startWorker().catch(console.error);
}

export { startWorker };
