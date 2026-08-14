# F02 + F03 Audit — Live Status

> Baseline audit: 2026-08-13. F02 at 74%, F03 at 71%.  
> This file tracks what has been fixed vs. what remains open.

---

## What was fixed this session (session 2 additions below)

### F02 Capability E — Shipment-Document Candidate Matching (was 33%)

**E-1: `confidenceScore` added to `DocumentShipmentCandidate`**  
`prisma/schema.prisma` — new field `confidenceScore Float @default(1.0)`.  
`src/modules/shipments/shipmentMatching.ts` — `CandidateRecord` interface gains optional `confidenceScore`; `recordCandidate` writes it (defaults to 1.0 for exact-identifier matches).  
`npx prisma db push` applied — column is live.

**E-2: Unattached documents endpoint joins candidates + pagination**  
`src/app/api/documents/unattached/route.ts` — complete rewrite:
- Includes `shipmentCandidates` (with nested `shipment.{ id, shipmentNumber, portOfEntry }`) sorted by `confidenceScore desc`, top 3.
- Cursor-based pagination (`take: 25`, `nextCursor` in response).
- Response shape: `{ documents: [...], pagination: { nextCursor, hasMore } }`.

**E-3: Audit action standardised**  
`src/lib/audit/auditActions.ts` — added `AUTO_ATTACH_DOCUMENT = "AUTO_ATTACH_DOCUMENT"`.  
`src/modules/documents/processing/documentProcessingWorker.ts:724` — `"document.auto_matched"` → `AuditAction.AUTO_ATTACH_DOCUMENT`.

### F03 F-4 — Document attach reconciliation-only (was 55%)

`src/app/api/documents/[id]/attach/route.ts` — full rewrite:
- After updating `shipmentId`, queries whether the shipment already has other documents with `extractionFields`.
- **If yes**: runs `runReconciliationEngine` + `computeReadinessBreakdown` + `recomputeShipmentDeadlines` directly — no full pipeline, no re-OCR/re-classification.
- **If no**: runs `PipelineOrchestrator.processEvent(DOCUMENT_UPLOADED)` as before so the new doc gets classified/extracted.

### F02 A-2 — External document-ingest API (was 0%)

`src/app/api/v1/intake/document/route.ts` — built from scratch:
- `POST /api/v1/intake/document` authenticated via `authenticateApiKey` + scope `documents:write`.
- Body: `{ url, documentType?, shipmentReference?, fileName? }`.
- Validates `url` against `resolveStorageOrigin` allowlist (returns 400 on untrusted origin).
- Resolves optional `shipmentReference` against `Shipment.shipmentNumber` / `Shipment.poReference`.
- Creates `ShipmentDocument` row with `status: "Received"`.
- Writes `AuditLog(DOCUMENT_QUEUED)`.
- Fire-and-forget: fetches the URL, runs `DocumentIntelligenceAgent.execute()`.
- Response `202 { documentId, processingStatus: "QUEUED", shipmentId, requestId }`.

---

## What was fixed this session (session 1)

### F03 Capability C — Conflict Detection (was 50%)

**C-1: ReconciliationIssue → ExceptionItem(CONFLICT) feed**  
`src/app/api/shipments/[id]/reconcile/route.ts`  
- After every reconciliation run, each discrepancy now also creates or updates an `ExceptionItem` with `category: "CONFLICT"`, `type: "data_mismatch"`, and `code: "CONFLICT:<ruleId>"`.  
- When the engine finds no conflict for a rule that previously fired, its `ExceptionItem` is auto-resolved alongside the `ReconciliationIssue`.  
- Conflict items now surface in the unified Exceptions tab without any frontend changes.

**C-2: ReconciliationIssue resolution fields**  
`prisma/schema.prisma` — added to `ReconciliationIssue`:
- `resolution String?` — `ACCEPTED_A | ACCEPTED_B | BOTH_WRONG | ACKNOWLEDGED`
- `note String?` — free-text reviewer note
- `resolvedByUserId String?`
- `resolvedByUserName String?`

`src/app/api/shipments/[id]/reconcile/issues/[issueId]/route.ts` — rewritten:
- Body now accepts `resolution` (required for `action: "resolve"`) and `note`.
- Writes all four new fields to `ReconciliationIssue` on resolution.
- Resolves the paired `ExceptionItem(CONFLICT)` in the same transaction.
- Returns `{ resolved, status, resolution }`.

**Quality Standard #5: Missing AuditLog on reconcile routes**  
- `reconcile/route.ts` now calls `createAuditLog(RECONCILIATION_RUN)` with `{ issuesFound, issuesAutoResolved, blockingIssues, readinessScore }`.
- `reconcile/issues/[issueId]/route.ts` now calls `createAuditLog(RECONCILIATION_ISSUE_RESOLVED)` or `createAuditLog(RECONCILIATION_ISSUE_IGNORED)` with `{ field, resolution, note, previousStatus, newStatus }`.

**New AuditAction values** (`src/lib/audit/auditActions.ts`):
- `RECONCILIATION_RUN`
- `RECONCILIATION_ISSUE_RESOLVED`
- `RECONCILIATION_ISSUE_IGNORED`

**Migration needed**: Run `prisma migrate dev` to apply the four new nullable columns on `ReconciliationIssue`. No data migration required (columns are nullable).

---

## Remaining open items (ranked by severity)

### Priority 1 — F02 Capability E ✅ CLOSED (session 2)

E-1: `confidenceScore Float @default(1.0)` added to `DocumentShipmentCandidate`; written by `shipmentMatching.ts`.  
E-2: `GET /api/documents/unattached` now joins `shipmentCandidates` (top 3 by confidence) with pagination.  
E-3: Auto-attach audit action standardised to `AuditAction.AUTO_ATTACH_DOCUMENT`.  
Remaining frontend work: a UI component to render the candidate list and one-click attach button.

### Priority 2 — F03 F-4 ✅ CLOSED (session 2)

`attach/route.ts` rewritten — uses reconciliation-only when other extracted docs already exist on the shipment; full pipeline only when this is the first document.

### Priority 3 — F02 A-2 ✅ CLOSED (session 2)

`POST /api/v1/intake/document` built at `src/app/api/v1/intake/document/route.ts`.  
Auth: API key + `documents:write` scope. Body: `{ url, documentType?, shipmentReference?, fileName? }`.  
Response: `202 { documentId, processingStatus: "QUEUED" }`. Fires background extraction.

### Priority 4 — F02 D-5: Evidence viewer in decision cards (was 0%)

`PdfCanvas` is only imported in `DocumentReviewPanel.tsx`. Decision cards in `ActionsClient.tsx` show no slide-over with the source document pre-scrolled to the evidence field/page.

Fix: Add a `<EvidenceSlideOver>` component wrapping `PdfCanvas`, triggered from the `AgentDecision` card when `evidenceItems` includes a document reference. Wire `fileUrl + pageNumber + bbox` from the decision's `evidenceItems`.

### Priority 5 — Quality violations remaining

| # | Violation | Location | Fix |
|---|---|---|---|
| QS-2 | Float arithmetic on money at intake boundary | `api/v1/intake/shipment/route.ts:126` — `(li.quantity ?? 0) * (li.unitPrice ?? 0)` | Import `Decimal` from `decimal.js`; compute `new Decimal(li.quantity).times(li.unitPrice).toNumber()` before Prisma write |
| QS-4 | No Vitest for `PdfCanvas` | No `PdfCanvas.test.ts` exists | Add render-smoke test + bbox-formula unit test for 1×/2× DPR |
| QS-4 | No Vitest for `classificationMapping` | No `classificationMapping.test.ts` exists | Unit-test `mapToDocumentType` + `normaliseConfidence` + <0.7 → `NEEDS_CLASSIFICATION` path |
| QS-4 | No Vitest for upload MIME/size rejection | No test asserts `FILE_TOO_LARGE` or `MIME_TYPE_NOT_ALLOWED` | Add test cases to `document-processing-integrity.test.ts` |
| QS-6 | No `.describe()` on Zod schemas | `intake/shipment/route.ts`, `reprocess/route.ts` spot-checked | Add `.describe("…")` to all Zod field definitions used in public routes |
| QS-8 | ~~No pagination on `/api/documents/unattached`~~ | ✅ Fixed session 2 — cursor pagination added | — |
| QS-9 | No `Idempotency-Key` header enforcement | Zero hits across all mutation routes | Add header parsing + short-circuit in `withAuthenticatedRoute` or per-route |

### Lower priority / architectural notes

| Item | Note |
|---|---|
| F02 A-1: 400 vs 422 on upload rejection | `upload/route.ts:103` returns 400; spec says 422. One-line change. |
| F02 A-1: No `Content-Disposition` header | `storage.ts` never sets it. Add `Content-Disposition: attachment` to served file responses. |
| F02 A-4: Shipment-first vs. post-upload attach | `DocumentUploadModal.tsx` requires shipment selected before upload; spec wants attach after. UX redesign required. |
| F02 A-4: No 20-file cap | `DocumentUploadModal.tsx` has no file-count validation. Add `if (files.length > 20)` guard. |
| F02 A-5: InboundSenderRoute never read | Sender routing model exists in DB but webhook never reads it; matching uses independent mechanism instead. Acceptable substitute but spec deviation. |
| F03 A-1: Legacy status strings coexist | `"Received"`, `"Processed"` etc. checked alongside new enum values in `shipmentReadiness.ts` and `requiredDocumentTypes.ts`. |
| F03 B-4/E-2: Inngest not used | Event-driven architecture described in plan was replaced with direct-call architecture. Functionally equivalent but no event bus. |
| F03 D-2: No `missingDocuments[]` on `GET /api/shipments/[id]` | `getMissingDocuments()` is computed internally but not confirmed to be echoed on the shipment detail GET response. |
| F03 E-1: HTS approval score bug | `classificationCoverageScore` counts any line item with an `htsCode` as approved regardless of actual approval status (`Boolean(li.htsCode)` disjunct is redundant). |
| F03 F-1: No `PipelineStepExecution.dependsOn` | Schema field never added; no general step-dependency graph exists. |
| F02 D-1: No zoom control | `PdfCanvas` only supports fit-width; no manual zoom %. |
| F02 D-2: No bbox→field reverse click | Clicking a highlighted region on the PDF canvas does not select the corresponding field row. |

---

## Current score estimates (cumulative)

| Feature | Capability | Baseline | After S1 | After S2 | Notes |
|---|---|---|---|---|---|
| F02 | A — Intake | 58% | 58% | **~75%** | A-2 built; A-4/A-5/A-6 still open |
| F02 | B — Classification | 90% | 90% | ~90% | unchanged |
| F02 | C — Extraction | 92% | 92% | ~92% | unchanged |
| F02 | D — Evidence Viewer | 83% | 83% | ~83% | D-5 still missing |
| F02 | E — Candidate Matching | 33% | 33% | **~80%** | schema + API done; frontend card not yet built |
| F03 | C — Conflict Detection | 50% | **~85%** | ~85% | S1 fixed |
| F03 | F — Reprocessing | 55% | 55% | **~75%** | F-4 fixed; F-1 still open |
| F03 | Quality AuditLog | violating | compliant | compliant | both reconcile routes + E-3 fixed |
| QS-8 | Pagination | missing | missing | **done** | unattached endpoint paginated |

**F02 overall:** ~74% → **~83%**  
**F03 overall:** ~71% → **~80%** (unchanged from S1 — S2 fixes were mostly F02)
