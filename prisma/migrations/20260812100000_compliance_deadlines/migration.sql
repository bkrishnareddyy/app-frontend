-- Add anchor date fields and transport mode to Shipment for deadline computation.
ALTER TABLE "Shipment" ADD COLUMN "ladingDate" TIMESTAMP(3);
ALTER TABLE "Shipment" ADD COLUMN "arrivalDate" TIMESTAMP(3);
ALTER TABLE "Shipment" ADD COLUMN "transportMode" TEXT;

-- Deadline type, anchor, status, and class enums.
CREATE TYPE "DeadlineType" AS ENUM (
  'ISF_10_2',
  'ENTRY_FILING',
  'ENTRY_SUMMARY',
  'DUTY_PAYMENT',
  'PMS_STATEMENT',
  'LAST_FREE_DAY',
  'PSC_WINDOW',
  'LIQUIDATION',
  'PROTEST',
  'CF28_RESPONSE',
  'CF29_RESPONSE'
);

CREATE TYPE "DeadlineAnchor" AS ENUM (
  'LADING',
  'ARRIVAL',
  'RELEASE',
  'ENTRY',
  'LIQUIDATION',
  'CBP_NOTICE',
  'CARRIER_TERMS'
);

CREATE TYPE "DeadlineStatus" AS ENUM (
  'OPEN',
  'SATISFIED',
  'MISSED',
  'WAIVED',
  'NOT_APPLICABLE'
);

CREATE TYPE "DeadlineClass" AS ENUM (
  'REGULATORY',
  'COMMERCIAL'
);

-- ComplianceDeadline: every statutory and commercial clock on a shipment.
CREATE TABLE "ComplianceDeadline" (
  "id"              TEXT NOT NULL,
  "accountId"       TEXT NOT NULL,
  "shipmentId"      TEXT,
  "type"            "DeadlineType" NOT NULL,
  "deadlineClass"   "DeadlineClass" NOT NULL DEFAULT 'REGULATORY',
  "status"          "DeadlineStatus" NOT NULL DEFAULT 'OPEN',
  "anchorEvent"     "DeadlineAnchor" NOT NULL,
  "anchorAt"        TIMESTAMP(3),
  "estimated"       BOOLEAN NOT NULL DEFAULT false,
  "dueAt"           TIMESTAMP(3),
  "ruleId"          TEXT NOT NULL,
  "ruleCitation"    TEXT NOT NULL,
  "penaltyEstimate" DECIMAL(14,2),
  "penaltyBasis"    TEXT,
  "satisfiedAt"     TIMESTAMP(3),
  "satisfiedBy"     TEXT,
  "waivedReason"    TEXT,
  "version"         INTEGER NOT NULL DEFAULT 1,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ComplianceDeadline_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "ComplianceDeadline"
  ADD CONSTRAINT "ComplianceDeadline_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ComplianceDeadline"
  ADD CONSTRAINT "ComplianceDeadline_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "ComplianceDeadline_accountId_status_dueAt_idx"
  ON "ComplianceDeadline"("accountId", "status", "dueAt");

CREATE INDEX "ComplianceDeadline_shipmentId_status_idx"
  ON "ComplianceDeadline"("shipmentId", "status");
