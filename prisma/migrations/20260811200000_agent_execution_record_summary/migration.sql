-- Add summary to AgentExecutionRecord to match AgentExecutionLog.
-- Written by PipelineOrchestrator per step; displayed in the waterfall view.
ALTER TABLE "AgentExecutionRecord" ADD COLUMN "summary" TEXT;
