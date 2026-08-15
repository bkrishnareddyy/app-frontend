# Qubere API Implementation Status

> [!CAUTION]
> **Status definitions:**
> - **Production Foundation** — tenant-scoped, validated, idempotent, tested against real routes.
> - **Prototype** — functional logic, but incomplete (missing validation, coverage, or authorization).
> - **Mock / Stub** — returns synthetic data; must NOT be presented to customers as real outcomes.
> - **Dummy** — logic is fabricated (fixed heuristics, seeded lists, hard-coded values).

> [!NOTE]
> This table covers a subset of session-authenticated `/api/*` routes, not the full surface
> (~239 route files exist under `src/app/api` at last count). Treat a route's absence as an
> undocumented gap, not a clean bill of health — same caveat as the Partner API table below.

| Domain | Endpoint | Status | Validation | Auth Guard | Tenant Isolation | Idempotent | Concurrency | Tests |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Bonds** | `GET /api/bonds` | Production Foundation | Zod Query | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Bonds** | `POST /api/bonds` | Production Foundation | Zod Schema | `bonds.manage` | Yes (`accountId`) | Yes | Yes | Included |
| **Classification** | `POST /api/classification/classify` | Disabled by default — returns 503 `CLASSIFICATION_ENGINE_MIGRATION` unless `ENABLE_LEGACY_CLASSIFICATION_MOCK=true`; when enabled, calls `ClassificationService` against real ingested HTS data (no fixed output) | Zod Schema | Authenticated | Yes (`accountId`) | Yes | N/A | Included |
| **Products** | `POST /api/products/normalize` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | Yes | Included |
| **Reconciliation** | `POST /api/reconcile` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | Yes | Included |
| **Exceptions** | `GET /api/exceptions` | Production Foundation | Zod Query | Authenticated | Yes (`accountId`) | N/A (No Mutate) | N/A | Included |
| **Exceptions** | `PATCH /api/exceptions/[id]` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | N/A | Versioned (409) | Included |
| **Audits** | `POST /api/compliance/audits/run` | Production Foundation — fixed 5-item checklist, but risk score is computed per-run from live filing/shipment/reconciliation/bond/broker data, not fixed | Zod Schema | `audits.run` | Yes (`accountId`) | Yes | Yes | Included |
| **Audits** | `GET /api/compliance/audits/[id]` | Production Foundation | Zod Path | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Drawback** | `POST /api/drawback/match` | Production Foundation — lot reservation is a real `Serializable` transaction (`reservedQty`/`availableQty`, throws on shortfall); duty rate comes from `calculateDutyStack` against ingested HTS data, not assumed | Zod Schema | `drawback.claim` | Yes (`accountId`) | Yes | Yes | Included |
| **Drawback** | `POST /api/drawback/claims` | Production Foundation — confirms reservations by moving `reservedQty`→`claimedQty` inside a transaction; over-allocation is prevented, not unprevented | Zod Schema | `drawback.claim` | Yes (`accountId`) | Yes | Yes | Included |
| **Shipments** | `GET /api/shipments` | Production Foundation | Zod Query | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Shipments** | `POST /api/shipments` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | Yes | Included |
| **Shipments** | `GET /api/shipments/[id]` | Production Foundation | Zod Path | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Shipments** | `PATCH /api/shipments/[id]` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | N/A | Versioned (409) | Included |
| **Documents** | `POST /api/documents/upload` | Production Foundation — enforces a MIME allowlist and size cap, stores originals outside `public/`, runs signature validation and an explicit `NOT_SCANNED`/`QUARANTINE` malware policy gate (`DOCUMENT_MALWARE_SCAN_MODE`); no scanner engine is wired up yet, but the gap is disclosed, not silent | FormData Zod | `documents.create` | Yes (`accountId`) | Yes | N/A | Mock only |
| **Documents** | `GET /api/documents/[id]/extractions`| Production Foundation — reads results from `DocumentIntelligenceAgent`, which runs live IBM Docling OCR against the uploaded file (see `docs/document-intelligence.md`) | Zod Path | Authenticated | Yes (`accountId`) | N/A (No Mutate) | N/A | Included |
| **Filings** | `POST /api/filing` | Production Foundation — creates DRAFT only (QPR-001 fixed) | Zod Schema | `filings.create` | Yes (`accountId`) | Yes | Yes | Mock only |
| **Filings** | `GET /api/filing/[id]` | Production Foundation | Zod Path | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Filings** | `POST /api/filing/[id]/transmit` | Mock / Stub — MockCustomsTransmissionProvider only; no real CBP | Zod Path | `filings.submit` | Yes (`accountId`) | Yes | Versioned (409) | Mock only |
| **Tariff** | `POST /api/simulator/scenarios/[id]/calculate` | Production Foundation — rates load from DB-backed HTS data via `calculateDutyStack`, all money uses `Decimal`/`roundToCents` (not Float), and scenarios pin to a published `htsRelease` (source versioning exists) | Zod Path/Body | `intel.read` | Yes (`accountId`) | N/A | N/A | Included |
| **Refunds** | `POST /api/refunds/opportunities/scan` | Production Foundation — computes real duty stacks against DB-backed HTS/Section 301 data and runs the real origin engine for trade-agreement opportunities; leaves `estimatedRefundAmount: null` rather than fabricating a figure | No schema (no request body) | `refunds.manage` | Yes (`accountId`) | No (`checkIdempotency` not called) | N/A | Mock only |
| **Refunds** | `POST /api/refunds/psc` | Production Foundation — original duty is the filing's real `totalDuties` (422 if none on file); corrected duty is computed via the real duty-stack engine on HTS code change, not a heuristic | Zod Schema | `psc.create` (GET: `psc.read`) | Yes (`accountId`) | No (`checkIdempotency` not called) | No (no version field) | Mock only |
| **Screening** | `POST /api/demo/screening/dps` | Production Foundation (demo path) — queries the real `DeniedPartyWatchlist` table and returns `INDETERMINATE`/503 when it's empty rather than a fabricated PASSED clearance; matching is still substring/fuzzy, not a seeded toy list. Path moved from `/api/screening/dps`; a separate legacy `POST /api/screening/embargo` (ad-hoc `EmbargoRule` engine) also exists and is undocumented here | Zod Schema | `ai.use` | Yes (`accountId`) | N/A | N/A | Mock only |
| **Advisory** | `POST /api/advisory/query` | Production Foundation — bare HTS codes get a direct DB lookup (no LLM); free-text queries are grounded in real `RegulatoryUpdate` rows and account metrics before being passed to a real Anthropic/Gemini call. A second undocumented surface, `POST /api/advisory/origin-determination`, also exists | Zod Schema | `ai.use` | Yes (`accountId`) | N/A | N/A | Mock only |
| **Admin** | `POST /api/admin/users` | Production Foundation | Zod Schema | `users.manage` | Yes (`accountId`) | Yes | N/A | Token Hashed |
| **Health** | `GET /api/health` | Production Foundation — blocks mock provider in production | None | Public | N/A | N/A | N/A | N/A |

## Partner API (`/api/v1`, API-key authenticated)

> The table above tracks only session-authenticated `/api/*` routes. This is the
> first `/api/v1/*` entry added here — the other existing `/api/v1/*` routes
> (intake, HTS, classification-cases, etc.) predate this table and are not yet
> inventoried; treat their absence as a gap, not a clean bill of health.

| Domain | Endpoint | Status | Validation | Auth Guard | Tenant Isolation | Idempotent | Concurrency | Tests |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Compliance** | `GET /api/v1/compliance/embargo-screening` | Production Foundation — reads persisted Country Embargo Screening evidence only, never reruns | Zod Query | API Key (`embargo.read` scope) | Yes (`accountId` from key) | N/A (No Mutate) | N/A | Included |
| **Compliance** | `POST /api/v1/compliance/embargo-screening` | Production Foundation — reuses last completed screening unless `forceRescreen`; rescreen requires `embargo.screen` scope | Zod Schema | API Key (`embargo.read` + `embargo.screen` scopes) | Yes (`accountId` from key) | N/A | Yes (pipeline-serialized) | Included |

---
*Last updated: 2026-08-15 — corrected stale Drawback/Documents-upload/Simulator-calculate/Refunds/Screening-dps/Advisory rows (several had been upgraded from Dummy/Prototype to real duty-engine/lot-reservation logic without the doc being updated), fixed wrong paths (`/api/advisory`→`/api/advisory/query`, `/api/screening/dps`→`/api/demo/screening/dps`) and wrong Auth Guard permission names, and added a disclosure that the main table is not an exhaustive route inventory.*
*Documented by Antigravity AI — Implementation Status Tracker*

