-- Capability B: Auditable Auto-Approval
--
-- AgentDecision: two new columns.
--   autoApproved          — distinguishes machine approvals (AUTO_VERIFIED) from
--                           human approvals (APPROVED). Clients and reports must
--                           never collapse these two states.
--   autoApprovalPolicy    — already added in the triage_state migration; included
--                           here for reference. No-op if it already exists.
--
-- AgentPolicyConfig: per-account, per-agent threshold overrides. When absent
-- the auto-approval module falls back to the hardcoded defaults in
-- src/modules/decisions/autoApprovalPolicy.ts.

ALTER TABLE "AgentDecision"
  ADD COLUMN IF NOT EXISTS "autoApproved" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "AgentDecision_autoApproved_idx"
  ON "AgentDecision" ("autoApproved");

CREATE TABLE IF NOT EXISTS "AgentPolicyConfig" (
  "id"                    TEXT NOT NULL,
  "accountId"             TEXT NOT NULL,
  "agentName"             TEXT NOT NULL,
  "autoThreshold"         INTEGER NOT NULL DEFAULT 85,
  "confirmThreshold"      INTEGER NOT NULL DEFAULT 60,
  "requirePartMasterMatch" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentPolicyConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentPolicyConfig_accountId_agentName_key"
  ON "AgentPolicyConfig" ("accountId", "agentName");

CREATE INDEX IF NOT EXISTS "AgentPolicyConfig_accountId_idx"
  ON "AgentPolicyConfig" ("accountId");

ALTER TABLE "AgentPolicyConfig"
  ADD CONSTRAINT "AgentPolicyConfig_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
