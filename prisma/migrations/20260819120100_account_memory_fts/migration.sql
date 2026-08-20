-- Real PostgreSQL full-text search for AccountMemory, replacing the ILIKE
-- token-AND scan MemoryRepository.findLexicalMatches used to run.
--
-- 'simple' (not 'english') dictionary: no stemming/stopword removal, so
-- technical tokens this system must match exactly -- HTS codes, SKUs, part
-- numbers, entry numbers, ECCNs, PGA codes -- survive the tsvector as typed
-- instead of being stemmed or dropped.
ALTER TABLE "AccountMemory"
ADD COLUMN "contentTsv" tsvector
GENERATED ALWAYS AS (
  to_tsvector('simple', coalesce(content, '') || ' ' || coalesce("subjectId", ''))
) STORED;

CREATE INDEX IF NOT EXISTS "AccountMemory_contentTsv_gin_idx"
ON "AccountMemory" USING gin ("contentTsv");
