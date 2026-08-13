# Qubere Implementation Plan
> Last updated: 2026-08-12

## 1. Guiding Principles

1. **No fake data, ever.** If real data isn't available, the UI surfaces an honest empty state with a clear explanation. Seed data in the database is fine for development; fallbacks to heuristic values in production are not.
2. **Every UI action is a chat tool call.** APIs are designed as typed tool endpoints first, rendered in the UI second. The AI assistant calls the same routes a browser does.
3. **Money is always Decimal.** Every monetary field — duty, MPF, HMF, drawback refunds, landed cost — uses `Decimal.js`. `roundToCents()` is the only arithmetic function that may produce a `number`.
4. **Stored state, not computed prose.** Agent reasoning that affects routing (triage state, confidence band, blocking reason) is written to columns, not parsed back out of summary strings.
5. **Audit everything.** Every data write that materially affects a customs entry produces an `AuditLog` row with a `requestId`, actor, action, and diff. Auto-approvals are explicitly labeled.
6. **Scale without breaking changes.** Collection endpoints always paginate. IDs are CUIDs. Multi-tenant isolation is enforced at the query layer, never by convention.

---

## 2. Technology Decisions

### 2.1 Retain (already correct)
| Technology | Reason |
|---|---|
| Next.js 16 App Router | Established, team knows it; no migration benefit |
| PostgreSQL + Prisma | Correct choice for relational compliance data with audit trails |
| Clerk auth | Multi-tenant account model, invitation flow, JWTs already integrated |
| Vercel Blob | Document storage; S3-compatible; fine for current scale |
| Inngest | Reliable background job orchestration; retries, fan-out, event sourcing built-in |
| Tailwind CSS 4 + custom UI | Component library in `packages/ui`; extend, don't replace |
| Zod 4 | Already used for validation; extend coverage, do not introduce a second schema library |
| Vitest + Playwright | Extend test coverage; do not introduce Jest or Cypress |

### 2.2 Add
| Technology | Why | Where |
|---|---|---|
| `Decimal.js` | Float money is legally inadmissible for duty calculations | `packages/db`, `src/lib/tariff/` |
| `pdf.js` (pdfjs-dist) | PDF viewer that supports canvas overlay for bbox highlights | `src/components/DocumentReviewPanel` |
| Claude API (Anthropic) | Superior reasoning for GRI analysis, CROSS ruling retrieval, trade agreement qualification, valuation narrative | `packages/ai/` — new agents alongside Gemini |
| OpenAPI 3.1 spec | Machine-readable API contract for chat tool calling and external integrations | `docs/openapi.yaml` — generated via `zod-to-openapi` |
| `zod-to-openapi` | Generate OpenAPI spec from existing Zod schemas; no manual sync | Build step |
| Inngest Functions (expand) | Document pipeline DAG, regulatory ingest, deadline sweep, metric snapshots | `src/inngest/` |

### 2.3 Remove / Replace
| Current | Replace With | Why |
|---|---|---|
| `<iframe>` PDF viewer | `pdf.js` canvas | Overlays impossible in iframe |
| Float arithmetic in duty/drawback/landed-cost routes | `Decimal.js` | Precision required |
| Hardcoded confidence thresholds per agent | `autoApprovalPolicy.ts` (configurable) | Auditable, testable, account-configurable |
| GET endpoint database seeding | Seed scripts only | Violates HTTP semantics |
| String literal decision status | `decisionState.ts` union + `triageState` column | Eliminates vocabulary drift |

---

## 3. Architecture

### 3.1 Layered Request Flow
```
Browser / Chat Tool Call
        │
        ▼
Next.js Route Handler
  - Zod validation (body, query, path)
  - Auth guard (getAccountContext → accountId)
  - Permission check (hasPermission / requirePermission)
  - Idempotency gate (POST/PATCH only)
        │
        ▼
Domain Service (src/lib/<domain>/ or src/modules/<domain>/)
  - Business rules
  - Decimal-safe arithmetic
  - Transaction boundary
  - AuditLog write (every material mutation)
        │
        ▼
Prisma (PostgreSQL)
  - Every query filters by accountId
  - Optimistic concurrency: version checks on mutable entities
```

### 3.2 AI Agent Architecture
```
Inngest Event trigger (document.uploaded / shipment.created / etc.)
        │
        ▼
agentOrchestrator (packages/ai/orchestrator/)
  - Reads PipelineJob to determine next stage
  - Dispatches to specific agent function
        │
  ┌─────┴──────────────┐
  ▼                    ▼
Gemini agents        Claude agents
(OCR, extraction,    (GRI reasoning,
 screening,          ruling retrieval,
 HTS draft)          trade agreement)
  │                    │
  ▼                    ▼
AgentDecision row (structured output, triageState column)
ExtractionField rows (bbox, pageNumber, confidence)
PipelineStepExecution row (timing, cost, model version)
AuditLog row (for auto-approvals: policy id, confidence)
```

### 3.3 API Design Contract (Chat Tool Interface)
Every API endpoint follows this contract so the chat assistant can call it as a tool:
```typescript
// Request: fully typed Zod schema
// Response: typed success envelope OR ApiErrorResponse
{
  data: T,
  meta: { requestId: string, timestamp: string, pagination?: { cursor, total, hasMore } }
}
```
All endpoints are documented in `docs/openapi.yaml` (generated). The chat assistant receives the OpenAPI spec as its tool definition.

### 3.4 Event-Driven Pipeline
Document processing is a DAG, not a waterfall:
```
document.uploaded
  → OCR (Gemini Vision)
  → classify_document_type
  → extract_structured_fields (persist ExtractionField rows with bbox)
  → attach_to_shipment (if candidate found)
  → trigger_reconciliation (if shipment has ≥ 2 docs)
  → update_readiness_score
  → notify_if_blockers
```
Each step is an Inngest function with retry/backoff. The DAG is encoded in `PipelineStepExecution` dependencies, not hardcoded in the orchestrator body.

---

## 4. Domain Module Structure

Every domain follows this file layout under `src/lib/<domain>/`:

```
src/lib/<domain>/
  <domain>.service.ts     # Business logic, no HTTP, no Prisma imports (uses db injected)
  <domain>.schema.ts      # Zod schemas for API input/output
  <domain>.types.ts       # TypeScript types derived from schema
  <domain>.queries.ts     # Prisma query helpers (accountId always in where clause)
  <domain>.events.ts      # Inngest event definitions this domain emits/consumes
  index.ts                # Re-exports
```

Existing `src/modules/` directory is the legacy location; new work goes in `src/lib/` and migrates modules there.

---

## 5. Key Implementation Decisions by Domain

### 5.1 Document Intelligence
- **OCR**: Gemini Vision for PDFs and images. Confidence threshold determines whether human review is required.
- **ExtractionField persistence**: Pipeline writes one `ExtractionField` row per extracted value with `pageNumber`, `bbox` (JSONB: `{x, y, w, h}` in PDF points), `confidence`, `source: "AI"`. Human corrections write `source: "HUMAN"`, `correctedFrom: {previous value}`.
- **PDF viewer**: `pdfjs-dist` renders into `<canvas>`. A React overlay div (absolute positioned, pointer-events-none) holds highlight rectangles scaled from PDF-point bbox to canvas-pixel coordinates.
- **Document type classification**: Closed enum `DocumentType` (`INVOICE | PACKING_LIST | BILL_OF_LADING | CERTIFICATE_OF_ORIGIN | ...`). Agent writes to this enum; no free-text type.

### 5.2 Decision State & Auto-Approval
- **`DecisionState` union**: `AUTO_VERIFIED | NEEDS_REVIEW | BLOCKED | APPROVED | REJECTED | IN_PROGRESS`
- **`autoApprovalPolicy.ts`**: Pure function `(confidence: number, partMasterMatch: boolean, agentName: string) → "AUTO" | "CONFIRM" | "REVIEW"`. Thresholds are stored in account settings (`AgentPolicyConfig` — new model), not hardcoded.
- **`AgentDecision` new columns**: `triageState DecisionState`, `autoApproved Boolean @default(false)`, `autoApprovalPolicy String?`, `blockedReason String?`
- **`AuditLog` for auto-approvals**: Every `AUTO_VERIFIED` decision writes an audit row with `action: "AUTO_APPROVE"`, `metadata: { policy, confidence, agentName }`.

### 5.3 Reconciliation Engine
- Each document type has a typed field extractor that normalizes values into a common `ReconciliationFact` structure.
- The engine compares facts across documents using a rule table (not code): `{field, docTypeA, docTypeB, tolerance, blocksFiling}`.
- Discrepancies write `ReconciliationIssue` rows with `fieldName`, `valueA`, `valueB`, `docTypeA`, `docTypeB`, `severity`.

### 5.4 HTS Classification
- **`ClassificationCase`** is the workflow object. One case per product/line item needing classification.
- **`ClassificationProposal`** holds candidate HTS codes with confidence, GRI analysis, and ruling citations.
- **`GriAnalysisStep`** holds one row per GRI rule applied (1 through 6), with reasoning, accepted/rejected flag.
- **CROSS ruling retrieval**: Search `Ruling` by embedding similarity (pgvector extension or Gemini embedding API) against product description. Return top-5 with similarity score and citation.
- Human approver picks a proposal; `ClassificationDecision` is written; `ProductClassification` is updated with effective date and superseded chain.

### 5.5 Duty & Tariff Engine
- `src/lib/tariff/dutyEngine.ts` is refactored to use `Decimal.js`.
- Duty stack layers: `{ base, section301, section232, adcvd, antidumping, countervailing }` — all separate fields, never summed before storing.
- MPF: `min(max(declared_value × 0.003464, $32.71), $634.62)` — use Decimal, clamp with exact statutory values.
- HMF: `declared_value × 0.00125` — Decimal.
- Source version: every calculation records `htsReleaseId` so the rates can be reproduced.

### 5.6 Filing Gate
- `POST /api/filing/[id]/transmit` checks server-side: all required docs present, all blocking exceptions resolved, all blocking decisions approved, bond sufficient, readiness score ≥ threshold. Rejects with `422` and structured blocker list if any check fails. The client-side gate in `PreFilingReadiness` is a convenience preview only.

### 5.7 Drawback
- `DrawbackLot` model: tracks `importedQty`, `availableQty`, `reservedQty`, `claimedQty` in Decimal. FIFO allocation.
- `POST /api/drawback/match` runs inside a serializable transaction with a `SELECT FOR UPDATE` on the lot. Returns 422 if over-allocation would occur.
- CBP claim numbers generated server-side following the `ENTRY-YYYY-NNNNNN` format from the ACE entry number, not random strings.

### 5.8 Chat Interface Tool Calling
- The assistant's system prompt includes the OpenAPI spec (compressed) and account context.
- Each API endpoint is a callable tool: `list_shipments`, `get_shipment`, `upload_document`, `classify_product`, `approve_decision`, etc.
- Mutations via chat go through the same API routes as the UI — same auth, same audit logging, same validation. No separate "chat-only" codepath.
- Streaming: `POST /api/assistant/chat` uses SSE (Server-Sent Events) via Next.js streaming response. Tool calls are streamed as structured events.

---

## 6. Security Model

| Layer | Enforcement |
|---|---|
| Authentication | Clerk JWT; middleware rejects unauthenticated requests |
| Account isolation | Every Prisma query: `where: { accountId: ctx.accountId }` |
| Permission checks | `requirePermission(ctx, "filings.submit")` before consequential operations |
| Optimistic concurrency | `expectedVersion` param on PATCH; 409 if version mismatch |
| Idempotency | `Idempotency-Key` header on all POST mutations; replay returns cached response |
| Token security | Invitation tokens hashed with SHA-256 before storage; never in logs |
| Document access | Vercel Blob URLs are scoped; proxy route (`/api/documents/proxy`) re-validates accountId before streaming |
| Audit completeness | Every material write: actor, timestamp, entity, diff, requestId |
| Data mode isolation | `DEMO` and `SANDBOX` data never appears in `PRODUCTION` workspace queries |

---

## 7. Testing Strategy

| Test type | Scope | Tool | Target Coverage |
|---|---|---|---|
| Unit | Pure functions (duty engine, state normalizers, reconciliation rules, scoring) | Vitest | 80%+ on all `src/lib/*/` |
| Integration | API routes with real Prisma against test DB | Vitest + Prisma test client | All production-foundation routes |
| Cross-tenant | Every route that touches data: verify account B cannot read account A's data | Vitest integration | 100% of collection + detail routes |
| Idempotency | POST same idempotency key twice → same response, single DB write | Vitest integration | All POST mutation routes |
| Concurrency | Concurrent PATCH with same version → exactly one succeeds, one gets 409 | Vitest integration | All versioned entities |
| E2E | Critical user journeys | Playwright | Upload doc → extract → approve HTS → file |

---

## 8. Observability

- **Request IDs**: Every response includes `X-Request-Id` header. Errors include `requestId` in payload.
- **Agent execution logging**: `AgentExecutionRecord` captures model, input token count, output token count, latency, cost, step name.
- **AI quota metering**: `AiUsageWindow` per account per day; `aiQuotaGate.ts` rejects at limit.
- **Pipeline job tracking**: `PipelineJob` + `PipelineStepExecution` are the source of truth for background work status.
- **Performance metrics**: `WorkMetricSnapshot` (new model) captures daily: cycle time median, first-pass acceptance rate, exception age, touch rate.

---

## 9. Deployment Constraints (Vercel Hobby)

| Constraint | Impact | Mitigation |
|---|---|---|
| Max 2 cron jobs/day | Deadline sweep runs at most once/day; regulatory ingest runs at most once/day | Inngest handles sub-daily retriggers if needed |
| Serverless function timeout | Long AI pipeline steps must be Inngest functions, not inline API route logic | All AI calls go through Inngest |
| No persistent connections | Prisma connection pooling via `pgBouncer` in DATABASE_URL | Already handled by Supabase/Neon |
| Edge runtime limitations | No Node.js crypto in edge; keep auth middleware pure | Middleware uses Clerk edge-compatible client |

Upgrade to Vercel Pro is recommended when: (a) any enterprise client is in production, (b) cron count exceeds 2, or (c) function timeouts become an issue.
