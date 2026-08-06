# Qubere API Implementation Status

| Domain | Endpoint | Status | Validation | Auth Guard | Tenant Isolation | Idempotent | Concurrency | Tests |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Bonds** | `GET /api/bonds` | Production Foundation | Zod Query | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Bonds** | `POST /api/bonds` | Production Foundation | Zod Schema | `bonds.manage` | Yes (`accountId`) | Yes | Yes | Included |
| **Classification** | `POST /api/classification/classify` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | N/A | Included |
| **Products** | `POST /api/products/normalize` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | Yes | Included |
| **Reconciliation** | `POST /api/reconcile` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | Yes | Included |
| **Exceptions** | `GET /api/exceptions` | Production Foundation | Zod Query | Authenticated | Yes (`accountId`) | N/A (No Mutate) | N/A | Included |
| **Exceptions** | `PATCH /api/exceptions/[id]` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | N/A | Versioned (409) | Included |
| **Audits** | `POST /api/compliance/audits/run` | Production Foundation | Zod Schema | `audits.run` | Yes (`accountId`) | Yes | Yes | Included |
| **Audits** | `GET /api/compliance/audits/[id]` | Production Foundation | Zod Path | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Drawback** | `POST /api/drawback/match` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | Yes | Included |
| **Drawback** | `POST /api/drawback/claims` | Production Foundation | Zod Schema | `drawback.claim` | Yes (`accountId`) | Yes | Yes | Included |
| **Shipments** | `GET /api/shipments` | Production Foundation | Zod Query | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Shipments** | `POST /api/shipments` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | Yes | Included |
| **Shipments** | `GET /api/shipments/[id]` | Production Foundation | Zod Path | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Shipments** | `PATCH /api/shipments/[id]` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | N/A | Versioned (409) | Included |
| **Documents** | `POST /api/documents/upload` | Production Foundation | FormData Zod | Authenticated | Yes (`accountId`) | Yes | N/A | Included |
| **Documents** | `GET /api/documents/[id]/extractions`| Production Foundation | Zod Path | Authenticated | Yes (`accountId`) | N/A (No Mutate) | N/A | Included |
| **Filings** | `POST /api/filing` | Production Foundation | Zod Schema | `filings.create` | Yes (`accountId`) | Yes | Yes | Included |
| **Filings** | `GET /api/filing/[id]` | Production Foundation | Zod Path | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Filings** | `POST /api/filing/[id]/transmit` | Production Foundation | Zod Path | `filings.submit` | Yes (`accountId`) | Yes | Versioned (409) | Included |
| **Tariff** | `POST /api/simulator/scenarios/[id]/calculate` | Production Foundation | Zod Path/Body | Authenticated | Yes (`accountId`) | N/A | N/A | Included |
| **Refunds** | `POST /api/refunds/opportunities/scan` | Production Foundation | Zod Schema | Authenticated | Yes (`accountId`) | Yes | N/A | Included |
| **Refunds** | `POST /api/refunds/psc` | Production Foundation | Zod Schema | `refunds.manage` | Yes (`accountId`) | Yes | Yes | Included |
| **Admin** | `POST /api/admin/users` | Production Foundation | Zod Schema | `users.manage` | Yes (`accountId`) | Yes | N/A | Token Hashed |

---
*Documented by Antigravity AI - Implementation Status Tracker*
