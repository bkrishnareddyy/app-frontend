-- Phase 1: stored triage state on AgentDecision and structured resolution codes on ExceptionItem.
--
-- AgentDecision: three new nullable columns.
--   triageState       — server-computed domain state, written by agents at creation time.
--                       Replaces four client-side categorizers that each guessed differently.
--   blockedReason     — stable sentinel code when the agent declined to run.
--   autoApprovalPolicy — policy id when triageState = AUTO_VERIFIED, for audit traceability.
--
-- Existing rows are left with NULL triageState. A backfill job should be run
-- separately using normalizeDecisionStatus() over the existing status column.
-- Until it completes, triageDecision() in decisionState.ts falls back to the
-- status-string normalizer, so the queue remains correct.
--
-- ExceptionItem: one new nullable column.
--   resolutionReasonCode — picklist code from resolutionReasons.ts, stored alongside
--                          the free-text resolutionNote so analytics are query-able.

ALTER TABLE "AgentDecision"
  ADD COLUMN "triageState" TEXT,
  ADD COLUMN "blockedReason" TEXT,
  ADD COLUMN "autoApprovalPolicy" TEXT;

-- Hot path: queue queries filter on (accountId, triageState).
CREATE INDEX IF NOT EXISTS "AgentDecision_triageState_idx"
  ON "AgentDecision" ("triageState");

CREATE INDEX IF NOT EXISTS "AgentDecision_accountId_triageState_idx"
  ON "AgentDecision" ("accountId", "triageState");

ALTER TABLE "ExceptionItem"
  ADD COLUMN "resolutionReasonCode" TEXT;

CREATE INDEX IF NOT EXISTS "ExceptionItem_resolutionReasonCode_idx"
  ON "ExceptionItem" ("resolutionReasonCode");
