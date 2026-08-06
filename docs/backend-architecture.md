# Qubere Backend Architecture Specification

## 1. Architecture Overview

Qubere uses a modular, layered architecture designed to isolate HTTP handling, request validation, authentication, domain business logic, data persistence, and external/AI provider integrations.

```
                    ┌─────────────────────────┐
                    │ Next.js App Router API  │
                    │   (Route Handlers)      │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Shared Middleware     │
                    │ Auth / Guards / Zod /   │
                    │ Idempotency / Audit     │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ Application Services    │
                    │   (Domain Modules)      │
                    └────────────┬────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
┌───────────▼──────────┐ ┌───────▼──────────┐ ┌───────▼──────────┐
│ Data Repositories    │ │ Regulatory &     │ │ Transmission &   │
│ (Prisma / PostgreSQL)│ │ Tariff Providers │ │ Storage Adapters │
└──────────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## 2. Shared Backend Layer Specification

### 2.1 Standard API Response & Error Envelope
All API endpoints return standard HTTP status codes and structured response envelopes.

#### Error Payload (`ApiErrorResponse`)
```ts
export interface ApiErrorResponse {
  error: {
    code: string;        // e.g. "INVALID_INPUT", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "BUSINESS_RULE_FAILURE"
    message: string;     // Human-readable error description
    details?: unknown;   // Field validation errors or diagnostic details
    requestId: string;   // Unique correlation request ID
  };
}
```

#### Status Code Mapping:
- **400 Bad Request**: Malformed JSON or invalid schema parameters.
- **401 Unauthorized**: Missing or invalid session credentials.
- **403 Forbidden**: Insufficient role or fine-grained permission.
- **404 Not Found**: Resource does not exist or does not belong to active account.
- **409 Conflict**: Idempotency key conflict or optimistic concurrency version mismatch.
- **422 Unprocessable Entity**: Business rule violation (e.g. over-allocating drawback inventory, missing required document for filing submission).
- **429 Rate Limit**: Excessive request volume.
- **500 Internal Error**: Unexpected server error (sanitized without exposing stack traces).
- **503 Service Unavailable**: Third-party provider dependency unavailable.

---

### 2.2 Validation Infrastructure
Validation is enforced at the route edge using Zod schemas for `params`, `query`, and `body`.

Example route wrapper pattern:
```ts
import { validateRequest } from "@/lib/api/validation";
import { z } from "zod";

const createShipmentSchema = z.object({
  importerName: z.string().min(1),
  poReference: z.string().optional(),
  entryType: z.string().default("Consumption Entry"),
  incoterm: z.string().default("CIF Los Angeles"),
});
```

---

### 2.3 Authorization & Multi-Tenant Isolation
1. **Tenant Isolation**: Every database read/write query must filter by `accountId`.
2. **Permission Guards**: Access is governed by `hasPermission(perm)` and explicit role guards (`requireBroker`, `requireAdmin`).

---

### 2.4 Idempotency Engine
State-modifying POST operations (filings, claims, drawback runs, document processing) evaluate the `Idempotency-Key` header:
1. Hash incoming request payload + account ID + idempotency key.
2. Check `IdempotencyRecord` table:
   - If key exists with matching hash: Return cached response directly (200/201).
   - If key exists with conflicting hash: Reject with `409 CONFLICT`.
   - If key does not exist: Execute transaction, save result to `IdempotencyRecord`, and return response.

---

### 2.5 Decimal-Safe Monetary Arithmetic
All monetary figures (customs value, duties, MPF, HMF, drawback refunds) are represented as `Decimal` types or calculated using decimal-safe scaling functions (`roundToCents(amount)`) to eliminate floating-point drift.

---

## 3. Data Provider Strategy & Interfaces

External integrations are decoupled via Provider Interfaces:

```ts
export interface ProviderMetadata {
  providerName: string;
  datasetVersion: string;
  retrievedAt: Date;
  effectiveDateRange?: { start: Date; end?: Date };
  completenessStatus: "COMPLETE" | "PARTIAL" | "DATA_UNAVAILABLE";
}

export interface HtsDataProvider {
  getHeadingCandidates(description: string): Promise<{ candidates: HtsCandidate[]; metadata: ProviderMetadata }>;
}

export interface CustomsTransmissionProvider {
  submitEntry(filingCase: FilingCasePayload): Promise<{ submissionId: string; status: string; responseCode: string; metadata: ProviderMetadata }>;
}
```

When no external service is connected, providers explicitly return `completenessStatus: "DATA_UNAVAILABLE"` or use a mock test double labeled `MockCustomsTransmissionProvider`.

---

## 4. Module Directory Structure

```text
src/
  lib/
    api/
      error.ts
      validation.ts
      auth-guards.ts
      idempotency.ts
      concurrency.ts
      logger.ts
  modules/
    bonds/
    classification/
    products/
    reconciliation/
    exceptions/
    compliance/
    drawback/
    refunds/
    shipments/
    filings/
    tariff/
    advisory/
    providers/
      hts-provider.ts
      transmission-provider.ts
      rulings-provider.ts
```

---
*Documented by Antigravity AI - Qubere Backend Architecture Specification*
