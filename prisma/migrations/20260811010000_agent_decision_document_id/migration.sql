-- AgentDecision has no documentId, so the Decisions page has to guess which
-- document a decision belongs to by clustering same-shipment decisions that
-- landed within 15 minutes of each other. That guess breaks for
-- shipment-scoped agents (Origin, Valuation, Compliance, Filing Readiness --
-- each pulls every line item on the shipment, not one document's), where
-- every edit/reconcile/reattach reruns them and each run becomes its own
-- fake "document" cluster. A real documentId lets the UI join instead of
-- guess, and stops force-fitting shipment-scoped runs into per-document cards
-- at all.
--
-- Guarded (IF NOT EXISTS) per this project's established migration pattern,
-- since `prisma migrate dev`'s shadow-database replay cannot rebuild this
-- schema from scratch (see 20260810140000_declare_out_of_band_schema) --
-- this migration is applied directly via `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "AgentDecision" ADD COLUMN IF NOT EXISTS "documentId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentDecision_documentId_idx" ON "AgentDecision"("documentId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentDecision_documentId_fkey') THEN
        ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_documentId_fkey"
            FOREIGN KEY ("documentId") REFERENCES "ShipmentDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
