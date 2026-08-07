# ADR 0001: Database Portability & Repository Pattern Abstraction

## Status
Approved

## Context
Qubere requires an enterprise-grade database layer that allows multi-tenant customers or cloud deployments to be hosted across diverse PostgreSQL/relational database engines (Supabase, AWS RDS/Aurora, Google Cloud SQL, Neon, CockroachDB) without vendor lock-in or fragile migration code.

## Decision
1. Application and worker logic will strictly access persistent data via **Repository Interfaces** (`src/repositories/` / `packages/database`). No raw database queries or vendor-specific extensions may leak into business services.
2. All Prisma data models must adhere to ANSI SQL standard structures supported portably by Prisma ORM across PostgreSQL dialects and relational storage.
3. Semantic/vector retrieval for CBP CROSS rulings and HTS nodes is abstracted via a `VectorSearchProvider` interface so PostgreSQL `pgvector` can be replaced with standalone vector engines (Pinecone, Qdrant, Milvus) if required.
4. Heterogeneous extracted facts and GRI analysis steps are validated using Zod schemas before being stored as portable JSON objects.

## Consequences
- Clean separation between business logic and database persistence.
- Zero vendor lock-in to specific cloud managed database offerings.
- Easy integration of unit tests using mock repository implementations.
