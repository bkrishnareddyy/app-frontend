-- Add broker-set filing deadline to Shipment for queue urgency ranking.
ALTER TABLE "Shipment" ADD COLUMN "filingDeadline" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Shipment_filingDeadline_idx" ON "Shipment" ("filingDeadline");
