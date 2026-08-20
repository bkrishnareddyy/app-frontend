-- Enable pgvector (ships natively on Supabase; safe no-op if already enabled elsewhere).
CREATE EXTENSION IF NOT EXISTS vector;

-- Real pgvector column for AccountMemory embeddings. Dimension (768) must
-- match EMBEDDING_DIMENSIONS in src/modules/memory/memory.types.ts and the
-- Gemini embedContent outputDimensionality config in memory.retriever.ts.
ALTER TABLE "AccountMemory" ADD COLUMN "embeddingVector" vector(768);

-- Backfill from the legacy Float[] column so memories written before this
-- migration are still retrievable by vector search. float8[] has no direct
-- cast to vector; round-tripping through its text array representation is
-- the standard pgvector backfill pattern.
UPDATE "AccountMemory"
SET "embeddingVector" = ('[' || array_to_string(embedding, ',') || ']')::vector
WHERE array_length(embedding, 1) = 768;

-- HNSW over ivfflat: no upfront training-list tuning needed, and it performs
-- well immediately even while this table is still small (ivfflat's
-- recommended list count depends on row count, which is not yet known here).
CREATE INDEX IF NOT EXISTS "AccountMemory_embeddingVector_hnsw_idx"
ON "AccountMemory"
USING hnsw ("embeddingVector" vector_cosine_ops);
