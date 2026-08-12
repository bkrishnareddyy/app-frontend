-- AI usage windows: a shared counter for AI request rate and token spend.
--
-- Entirely additive. One new table and one new foreign key. Nothing is dropped,
-- retyped or backfilled, and no existing table is touched, so applying this to a
-- live database changes no existing behaviour.
--
-- Hand-written rather than generated, so it can be read before it is applied.
-- `CREATE TABLE IF NOT EXISTS` and `IF NOT EXISTS` on the indexes make it
-- idempotent: re-running it on a database that already has the table is a no-op
-- rather than an error.
--
-- Note on "userId": it is NOT NULL and carries the literal '*' for the row that
-- aggregates a whole account. A nullable column would break the unique index,
-- because Postgres treats NULLs as distinct -- ON CONFLICT would never fire for
-- the account row and every request would insert a new one.

CREATE TABLE IF NOT EXISTS "AiUsageWindow" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "windowKind" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageWindow_pkey" PRIMARY KEY ("id")
);

-- The upsert target. Every increment is one INSERT ... ON CONFLICT against this.
CREATE UNIQUE INDEX IF NOT EXISTS "AiUsageWindow_accountId_userId_surface_windowKind_windowStart_key"
    ON "AiUsageWindow"("accountId", "userId", "surface", "windowKind", "windowStart");

-- Retention sweeps read this one.
CREATE INDEX IF NOT EXISTS "AiUsageWindow_windowStart_idx"
    ON "AiUsageWindow"("windowStart");

-- Reporting reads this one: an account's spend on one surface over a period.
CREATE INDEX IF NOT EXISTS "AiUsageWindow_accountId_surface_windowKind_windowStart_idx"
    ON "AiUsageWindow"("accountId", "surface", "windowKind", "windowStart");

DO $$
BEGIN
    ALTER TABLE "AiUsageWindow"
        ADD CONSTRAINT "AiUsageWindow_accountId_fkey"
        FOREIGN KEY ("accountId") REFERENCES "Account"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
