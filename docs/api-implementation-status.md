# Qubere API Implementation Status

> [!CAUTION]
> **Status definitions:**
> - **Production Foundation** — tenant-scoped, validated, idempotent, tested against real routes.
> - **Prototype** — functional logic, but incomplete (missing validation, coverage, or authorization).
> - **Mock / Stub** — returns synthetic data; must NOT be presented to customers as real outcomes.
> - **Dummy** — logic is fabricated (fixed heuristics, seeded lists, hard-coded values).

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
| **Drawback** | `POST /api/drawback/match` | Prototype — no inventory lot reservation, duty rate assumed | Zod Schema | Authenticated | Yes (`accountId`) | Yes | Yes | Mock only |
| **Drawback** | `POST /api/drawback/claims` | Prototype — legally unsafe, no over-allocation prevention | Zod Schema | `drawback.claim` | Yes (`accountId`) | Yes | Yes | Mock only |
| **Shipments** | `GET /api/shipments` | Production Foundation | Zod Query | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Shipments** | `POST /api/shipments` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | Yes | Included |
| **Shipments** | `GET /api/shipments/[id]` | Production Foundation | Zod Path | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Shipments** | `PATCH /api/shipments/[id]` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | N/A | Versioned (409) | Included |
| **Documents** | `POST /api/documents/upload` | Prototype — public storage, no MIME/size validation, no malware scan | FormData Zod | Authenticated | Yes (`accountId`) | Yes | N/A | Mock only |
| **Documents** | `GET /api/documents/[id]/extractions`| Production Foundation — reads results from `DocumentIntelligenceAgent`, which runs live IBM Docling OCR against the uploaded file (see `docs/document-intelligence.md`) | Zod Path | Authenticated | Yes (`accountId`) | N/A (No Mutate) | N/A | Included |
| **Filings** | `POST /api/filing` | Production Foundation — creates DRAFT only (QPR-001 fixed) | Zod Schema | `filings.create` | Yes (`accountId`) | Yes | Yes | Mock only |
| **Filings** | `GET /api/filing/[id]` | Production Foundation | Zod Path | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Filings** | `POST /api/filing/[id]/transmit` | Mock / Stub — MockCustomsTransmissionProvider only; no real CBP | Zod Path | `filings.submit` | Yes (`accountId`) | Yes | Versioned (409) | Mock only |
| **Tariff** | `POST /api/simulator/scenarios/[id]/calculate` | Prototype — inline static rates, Float money, no source versioning | Zod Path/Body | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Refunds** | `POST /api/refunds/opportunities/scan` | Dummy — applies arbitrary 15%/40% heuristic factors | Zod Schema | Authenticated | Yes (`accountId`) | Yes | N/A | Mock only |
| **Refunds** | `POST /api/refunds/psc` | Dummy — corrected-duty heuristics, not actual paid duty | Zod Schema | `refunds.manage` | Yes (`accountId`) | Yes | Yes | Mock only |
| **Screening** | `POST /api/screening/dps` | Dummy — seeded toy denied-party list, substring match only | Zod Schema | Authenticated | Yes (`accountId`) | N/A | N/A | Mock only |
| **Advisory** | `POST /api/advisory` | Dummy — keyword template answer, no real regulatory data | Zod Schema | Authenticated | Yes (`accountId`) | N/A | N/A | Mock only |
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
*Last updated: 2026-08-15 — corrected stale Classification/Documents-extractions/Audits-run rows, which described mock/fixed behavior that no longer matches the code.*
*Documented by Antigravity AI — Implementation Status Tracker*

