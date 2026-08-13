-- Exception history log: chronological array of { timestamp, userId, action, note }
ALTER TABLE "ExceptionItem" ADD COLUMN "history" JSONB NOT NULL DEFAULT '[]';

-- Shipment workflow stage tracking
ALTER TABLE "Shipment" ADD COLUMN "currentStage" TEXT;

-- Index for stage-based queries
CREATE INDEX "Shipment_currentStage_idx" ON "Shipment"("currentStage");
