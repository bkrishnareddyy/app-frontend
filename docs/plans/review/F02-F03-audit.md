# F02 Document Intelligence + F03 Shipment Workspace — Audit
> Re-audited: 2026-08-13 (second pass, compares against prior audit of same date)
> Prior audit baseline: F02 74%, F03 71%. An intermediate self-reported "live status" doc (overwritten by this file) claimed F02 had reached ~83% and F03 ~80% after two rounds of fixes — those numbers did not hold up under adversarial re-verification (see below).

F02 Overall readiness: **63%** (previously self-reported 83%, original baseline 74%)
F03 Overall readiness: **63%** (previously self-reported 80%, original baseline 71%)

Both features regressed relative to the self-reported numbers because the self-report credited backend/schema work that never reaches an end user. The single largest finding this pass: **F03's real reconciliation engine (`src/lib/reconciliation/reconciliationEngine.ts`) is never invoked by the automatic document-upload pipeline** — `PipelineOrchestrator.processEvent` still calls the old, unrelated `src/modules/shipment/reconciliationEngine.ts` (`ReconciliationEngine.reconcileShipment`, `pipelineOrchestrator.ts:209`), which hard-codes `conflictsDetected = 0`. The new engine is only reachable through `POST /api/shipments/[id]/reconcile`, which has **no frontend caller anywhere in `src/app` or `src/components`**. Every downstream fix that session 1 claimed (CONFLICT exceptions, resolution fields, AuditLog) is real code that is correctly wired to `reconcile/route.ts` — but that route never runs automatically, so in the primary user journey (upload docs to a shipment) none of it fires. Symmetrically, F02's Capability E (`DocumentShipmentCandidate`) went from "written but read by zero UI code" to "written correctly, still read by zero UI code" — the schema field, join, and pagination all shipped, but `grep -rn "shipmentCandidates" src/app src/components` still returns only the API route itself.

---

## F02 Capability A — Secure Multi-Channel Document Intake

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1: Harden upload (MIME allowlist, size limit, Content-Disposition) | PARTIAL | UNCHANGED | `src/lib/storage.ts:9-23` (`ALLOWED_MIME_TYPES`, broader than spec's 4 types — also allows xlsx/csv/json/xml/text), `:26` (`MAX_UPLOAD_BYTES` 50MB), `src/app/api/documents/upload/route.ts:65,104` (MIME/size errors return **400**, spec wants 422); `Content-Disposition` grepped across `src/` — zero hits | Still no `Content-Disposition: attachment` header on served blobs; still 400 not 422 for MIME/size rejection |
| A-2: `POST /api/v1/intake/document` | DONE | FIXED | `src/app/api/v1/intake/document/route.ts:32-158` — API-key auth (`authenticateApiKey`/`apiKeyHasScope("documents:write")`), Zod body validation, storage-origin allowlist check, shipment resolution by `shipmentNumber`/`poReference`, `AuditLog(DOCUMENT_QUEUED)`, fire-and-forget `DocumentIntelligenceAgent.execute`, `202 { documentId, processingStatus: "QUEUED" }` | None — matches spec. Missing only `.describe()` on the Zod schema (quality violation, not a functional gap) |
| A-3: `Account.apiKey` model | DONE | FIXED (new) | `prisma/schema.prisma:3978-3996` `AccountApiKey { keyHash, keyPrefix, scopes[], lastUsedAt, expiresAt }` | Field is named `scopes` not `permissions[]` — semantically equivalent, not a real gap |
| A-4: Bulk upload UI (drag-drop, per-file progress, 20-file cap) | PARTIAL | UNCHANGED | `src/components/DocumentUploadModal.tsx:161-226` supports multi-file + per-file outcome list, but `:166-169` still requires a shipment selected *before* upload (spec wants attach-after); no `files.length > 20` guard anywhere in the file | Add 20-file cap; UX redesign to allow upload-then-attach |
| A-5: Email ingest via Resend webhook | DONE | **FIXED — prior self-report was wrong.** The live-status doc claimed `InboundSenderRoute` was "never read" and matching used "an independent mechanism instead." That is false on inspection. | `src/modules/inbound/senderRouting.ts:16-21` `resolveInboundRoute` queries `db.inboundSenderRoute.findFirst`; called from `src/modules/documents/processing/inboundEmailWorker.ts:72,107`; unmatched sender sets `routingStatus: "QUARANTINED"` (`:73-84`) | None found |
| A-6: Vitest (upload MIME/size rejection, API-key auth) | MISSING | STILL BROKEN | Grepped `tests/*.test.ts` for `FILE_TOO_LARGE`, `MIME_TYPE_NOT_ALLOWED`, `authenticateApiKey` — zero hits | Add upload-rejection and API-key-401 test cases |

## F02 Capability B — Automated Document Classification

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1: `DocumentType` enum + `documentTypeConfidence` | DONE | UNCHANGED-WAS-ALREADY-DONE | `prisma/schema.prisma:23-36`, `:526-529` | None |
| B-2: Classification writes valid enum, <0.7 → `NEEDS_CLASSIFICATION` | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/lib/documents/classificationMapping.ts:13,36-42` (threshold 0.7); `src/modules/agents/documentIntelligenceAgent.ts:917-933` | None |
| B-3: `?status=NEEDS_CLASSIFICATION` filter + sidebar badge | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/modules/documents/documentQuery.ts:82,150`; `src/app/api/documents/pending-classification/route.ts:9-20`; `src/components/Sidebar.tsx:98` | None |
| B-4: Classification column + manual override dropdown | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/app/documents/DocumentsClient.tsx:645-730`; PATCH clears status + writes `AuditLog` (`src/app/api/documents/[id]/route.ts:52-84`) | None |
| B-5: Vitest (enum coverage, confidence threshold) | MISSING | STILL BROKEN | No `classificationMapping.test.ts` in `tests/` | Add unit tests for `mapToDocumentType` / threshold routing |

## F02 Capability C — Structured Data Extraction with Field-Level Provenance

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1: `ExtractionField` rows written (bbox, page, confidence, source) | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/modules/agents/documentIntelligenceAgent.ts:1024-1046` | None |
| C-2: `extractionSchemas.ts` per document type | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/lib/documents/extractionSchemas.ts:22-127` — all spec doc types covered | None |
| C-3: `GET /api/documents/[id]/extractions` returns real rows | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/documents/[id]/extractions/route.ts:97-116` | None |
| C-4: `PATCH .../fields/[fieldId]` human correction + reconciliation trigger | PARTIAL | STILL BROKEN | `src/app/api/documents/[id]/extractions/fields/route.ts:20-130` exists but is `POST .../fields` (not `PATCH .../fields/[fieldId]` as spec names), writes `source:"HUMAN"`/`correctedByUserId`/`correctedAt` correctly, but **zero UI callers** (`DocumentReviewPanel.tsx` posts to `/api/decisions` instead) and **fires no reconciliation event** | Wire into `DocumentReviewPanel.tsx`'s correction flow; add the reconciliation-trigger call the spec requires |
| C-5: Missing required field → `ExceptionItem(MISSING_DATA)` | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/modules/exceptions/exception.service.ts:274,300-336`, called from `documentIntelligenceAgent.ts:1073-1086` | None |
| C-6: Vitest | PARTIAL | STILL BROKEN (partial) | `tests/extraction-correction-api.test.ts` covers the correction insert/audit path well, but no test for "missing required field creates exception" or the (nonexistent) reconciliation event | Add missing-field-exception test |

## F02 Capability D — Source-Linked Evidence Viewer

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1: `PdfCanvas` replaces `<iframe>`, highlight array, zoom | PARTIAL | UNCHANGED | `src/components/PdfCanvas.tsx:1-171` — real pdfjs-dist canvas render, but single `bbox` prop, not `HighlightRect[]`; fit-width only, no manual zoom | Add multi-highlight support and zoom controls |
| D-2: Split-pane review panel, click-to-highlight both directions | PARTIAL | UNCHANGED | `src/components/DocumentReviewPanel.tsx:1265-1342` — field-row → PDF scroll/highlight works; `PdfCanvas` has no click handler, so bbox → field-row selection does not work | Implement reverse click-to-select |
| D-3: Keyboard `n`/`p` navigation | DONE | UNCHANGED-WAS-ALREADY-DONE | `DocumentReviewPanel.tsx:796-815` wires `nextReviewIndex` from `extractionReview.ts` | None |
| D-4: Degrade honestly when no bbox | DONE | UNCHANGED-WAS-ALREADY-DONE | `DocumentReviewPanel.tsx:1279-1281,1342` "location not recorded" | None |
| D-5: Evidence viewer in decision cards (`ActionsClient.tsx`) | MISSING | STILL BROKEN | Grepped `src/app/app/actions/ActionsClient.tsx` — zero references to `PdfCanvas`; only an unrelated `ExceptionSlideOver` exists | Build `EvidenceSlideOver` wrapping `PdfCanvas`, wired from `AgentDecision.evidenceItems` |
| D-6: Vitest (`PdfCanvas` render, bbox scaling 1x/2x DPR) | MISSING | STILL BROKEN | No `PdfCanvas.test.ts` in `tests/` | Add render-smoke + scaling-formula tests |

## F02 Capability E — Shipment-Document Candidate Matching

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1: Write top-3 `DocumentShipmentCandidate` rows w/ `confidenceScore` | PARTIAL | FIXED (schema/write path only) | `prisma/schema.prisma:675` `confidenceScore Float @default(1.0)`; `src/modules/shipments/shipmentMatching.ts:113` writes it. Matching logic is unchanged pre-existing exact-identifier matching (`shipmentNumber`/`poReference`), always writes hardcoded `1.0` — no real field-comparison ranking against `bl_number`/`invoice_number`/`po_reference` as spec describes. Also: **no migration file contains `confidenceScore`** (`grep` across `prisma/migrations/*/migration.sql` → 0 hits); it was applied via `db push` only | A fresh `prisma migrate deploy` environment would be missing this column; matching logic needs real multi-field scoring, not a hardcoded constant |
| E-2: Unattached docs UI — suggested shipments, one-click attach, dismiss | **STILL BROKEN end-to-end** | Backend FIXED, UI UNCHANGED-NEVER-BUILT | `src/app/api/documents/unattached/route.ts:11-27` correctly joins top-3 `shipmentCandidates` by confidence + cursor pagination. But `grep -rn "shipmentCandidates\|DocumentShipmentCandidate" src/app src/components` returns **only the API route itself** — confirmed independently. `DocumentUploadModal.tsx:111` and `DocumentsClient.tsx:187` call the endpoint but render a flat manual-attach list, never reading `.shipmentCandidates` | This is the same gap the original audit named ("written by shipmentMatching.ts but read by zero UI code") — the API layer improved, the user-visible capability did not change |
| E-3: Auto-attach ≥0.9, no same-type conflict, `AuditLog(AUTO_ATTACH)` | PARTIAL | FIXED (audit action only) | `src/modules/documents/processing/documentProcessingWorker.ts:706-731` auto-attaches and writes `AuditAction.AUTO_ATTACH_DOCUMENT` correctly — but only runs when `document.source === "EMAIL"` (`:624`), not for all unattached documents, and has **no check for a conflicting document of the same type already attached** | Add the same-type conflict guard the spec requires; extend beyond email-sourced documents |

---

## F03 Capability A — Shipment Document Workspace (UI Polish)

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1: Standardize status vocabulary | PARTIAL | UNCHANGED | `ShipmentDocumentsSection.tsx:34-77` (`docStatusChip`), `src/lib/requiredDocumentTypes.ts:103-113` (`isDocReceived`) both still branch on legacy free-text strings (`"Received"`, `"Processed"`) alongside the enum | Legacy strings still coexist with the enum |
| A-2: Required-documents checklist + count badge | DONE | UNCHANGED-WAS-ALREADY-DONE | `ShipmentDocumentsSection.tsx:265-286` | None |
| A-3: Document reorder, `displayOrder` | DONE | UNCHANGED-WAS-ALREADY-DONE | `ShipmentDocumentsSection.tsx:139-162` → `src/app/api/shipments/[id]/documents/reorder/route.ts:24-39` (tenant-scoped) | Minor: schema field is `Int?` not `Int @default(0)` per spec text |
| A-4: Extracted Facts tab shows structured `ExtractionField` list | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/components/DocumentReviewPanel.tsx:698-740` builds from DB rows, JSON blob only as fallback | None |
| A-5: `healthStatus` badge + `readinessScore` progress bar | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/app/shipments/[id]/page.tsx:1197-1234` | None |

## F03 Capability B — Cross-Document Reconciliation Engine

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1: `reconciliationEngine.ts` field-comparison engine | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/lib/reconciliation/reconciliationEngine.ts:112-180` — matches spec's `ReconciliationResult` shape | None |
| B-2: Rule table (`reconciliationRules.ts`) | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/lib/reconciliation/reconciliationRules.ts:52-277` — 19 rules across quantity/value/weight/party/container/origin | Close to the "~20 rules" data-gap target |
| B-3: `POST /api/shipments/[id]/reconcile` calls the real engine, writes `ReconciliationIssue` | DONE (route logic) | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/shipments/[id]/reconcile/route.ts:36-137` builds `DocumentGroup[]` from real `ExtractionField` rows, upserts `ReconciliationIssue` | Route is correct; see B-4 — it is essentially never invoked |
| B-4: Auto-trigger via Inngest on doc attach (READY) or field correction | **STILL BROKEN** | Newly identified — not caught by prior audit or the self-report | `src/modules/agents/pipelineOrchestrator.ts:209` calls the **old, separate** `ReconciliationEngine.reconcileShipment` (`src/modules/shipment/reconciliationEngine.ts:47-52`), which hard-codes `conflictsDetected = 0` at line 69, and is a different module from B-1's real engine. `POST /api/shipments/[id]/reconcile` (the route that does call the real engine) has **zero frontend callers** anywhere in `src/app`/`src/components` | This is the single biggest gap in F03: the real reconciliation engine never runs on the primary document-upload path. Wire the automatic pipeline (or field-review/extraction-correction flows) to call `runReconciliationEngine`, or route `PipelineOrchestrator`'s reconciliation step through it |
| B-5: Vitest (BLOCKING/WARNING/no-issue cases) | DONE | UNCHANGED-WAS-ALREADY-DONE | `tests/reconciliation-engine.test.ts`, `tests/reconcile-rules.test.ts` — all three spec cases present | None |

## F03 Capability C — Conflict Detection UI

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1: `ReconciliationIssue` → `ExceptionItem(CONFLICT)` | DONE (logic), starved of input | **FIXED — claim verified true**, but see B-4 | `reconcile/route.ts:66-136` creates/updates/auto-resolves `ExceptionItem{category:"CONFLICT", code:"CONFLICT:<ruleId>"}` correctly | Correct code that only runs when `POST /reconcile` is manually/API invoked (B-4) |
| C-2: Resolution fields + resolve action | DONE, one overstated detail | **FIXED — claim mostly verified true** | Schema: `prisma/schema.prisma:1656-1659` (`resolution`, `note`, `resolvedByUserId`, `resolvedByUserName`); route `.../reconcile/issues/[issueId]/route.ts:65-94` writes all four and resolves the paired `ExceptionItem` | Self-report claimed this happens "in the same transaction" — it is actually two **sequential, non-transactional** writes, not wrapped in `db.$transaction`. A crash mid-way leaves `ReconciliationIssue` and `ExceptionItem` inconsistent |
| C-3: Blocking conflicts in `PreFilingReadiness` | DONE | UNCHANGED-WAS-ALREADY-DONE | `page.tsx:906-929`, `PreFilingReadiness.tsx:145-197` | Same B-4 starvation applies — the factor is correct but rarely has real data to show |

## F03 Capability D — Missing-Document Detection

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1: Required sets per entry type + conditional docs | PARTIAL | UNCHANGED (new detail found) | `src/lib/requiredDocumentTypes.ts:50-101` defines entry-type sets and 4 conditional docs, but `conditionalFlags` is passed as a hard-coded `{}` at both call sites (`reconcile/route.ts:191`, `canonicalShipmentService.ts:138`) | Conditional docs (Certificate of Origin for USMCA, Phytosanitary, etc.) are defined but never actually triggered from real shipment data |
| D-2: `missingDocuments[]` on `GET /api/shipments/[id]` | DONE | FIXED (resolves prior uncertainty) | `src/app/api/shipments/[id]/route.ts:33-34` returns canonical object; `canonicalShipmentService.ts:129-142` includes `missingDocuments` | Prior audit flagged this as unconfirmed — now confirmed present |
| D-3: Auto `ExceptionItem(MISSING_DATA)`, auto-resolve on upload | PARTIAL | UNCHANGED | `reconcile/route.ts:194-235` creates/resolves exceptions for missing docs, but uses `category: "DOCUMENT"` (line 230), not the spec-mandated `category: "MISSING_DATA"`; also only runs inside `POST /reconcile` (B-4 gap) | Fix category value; wire into the automatic pipeline |
| D-4: "Request document" action (signed upload link email) | MISSING | UNCHANGED | No route/component found for a per-exception document request; `InboundSenderRoute` exists only for admin-configured inbound email routing, unrelated to this task | Not implemented |

## F03 Capability E — Shipment Readiness Score (Real Formula)

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1: HTS approval score bug (Task E-1, five-factor formula) | **STILL BROKEN** | UNCHANGED — self-report flagged this itself and it remains unfixed | `src/lib/shipmentReadiness.ts:145-147`: `const approved = lineItems.filter((li) => li.htsCode && (li.status === "Valid" \|\| Boolean(li.htsCode))).length;` — the `\|\| Boolean(li.htsCode)` disjunct is redundant given the outer guard, so any line item with an HTS code counts as approved regardless of actual decision status | Remove the redundant disjunct; count only `status === "Valid"` (or a real APPROVED-decision join) |
| E-2: Recompute triggers (attach/detach, exception create/resolve, decision approve/reject, reconciliation run) | PARTIAL | UNCHANGED | Confirmed present on: reconcile run, attach, field-review, reprocess-reconcile. **Not found** in `documents/[id]/detach/route.ts`, `shipments/[id]/exceptions/[exceptionId]/resolve/route.ts`, or `decisions/route.ts` / `decisions/bulk/route.ts` | Score/health go stale after detach, exception resolve, or decision approve/reject |
| E-3: Score breakdown UI by factor | DONE | UNCHANGED-WAS-ALREADY-DONE | `PreFilingReadiness.tsx:145-197` — per-factor bars + `contributingItems` | None |
| E-4: `filingDeadline` derivation, not computed in render path | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/modules/deadlines/deadline.service.ts` computes and caches | None |
| E-5: Vitest (0/100 boundary cases) | PARTIAL | UNCHANGED | `tests/shipment-readiness.test.ts` covers factors 1/2/3/5, but has no test isolating factor 4 with an `htsCode`-present-but-not-approved line item — so the E-1 bug ships with no failing test to catch it | Add a regression test that would fail against the current E-1 bug |

## F03 Capability F — Dependency-Aware Reprocessing

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| F-1: `PipelineStepExecution.dependsOn` | MISSING | UNCHANGED — confirmed still absent, matches self-report's own admission | `prisma/schema.prisma:1944-1958` — no `dependsOn` field anywhere on the model | Not built; no general step-dependency graph exists |
| F-2: `POST /reprocess { fromStep }` partial re-run | DONE | FIXED (new, not previously claimed) | `src/app/api/documents/[id]/reprocess/route.ts:25-33,75-176` accepts `fromStep: "full" \| "reconcile"`; the `"reconcile"` branch skips OCR/classification entirely | Coarser 2-value model than the spec's full `PipelineStep` enum, but functionally satisfies the task. No frontend caller found yet |
| F-3: Human correction triggers reconciliation+readiness only | PARTIAL | UNCHANGED (mixed) | Correctly wired for `field-review` (`field-review/route.ts:124-205`, real UI `DocumentFieldReviewModal.tsx`). But `extractions/fields/route.ts` (the endpoint that corrects the actual `ExtractionField` rows reconciliation rules key on) has **zero** downstream trigger and no frontend caller at all | Wire `extractions/fields/route.ts` to the same reconciliation+readiness trigger as `field-review` |
| F-4: Document attach → reconciliation-only (not full pipeline) | DONE | **FIXED — claim verified true** | `src/app/api/documents/[id]/attach/route.ts:64-147` — real branch: reconciliation-only when the shipment already has other extracted documents, full pipeline only for the first document | None |
| F-5: Pipeline status UI wired to real data | DONE | UNCHANGED-WAS-ALREADY-DONE | `PipelineProgressTracker.tsx` polls `GET /api/shipments/[id]/pipeline-status/route.ts:9-46` (real `PipelineJob`/`stepExecutions`, tenant-scoped) | None |

---

## Cross-cutting Quality Standards violations found

| # | Standard | Violation | Location |
|---|---|---|---|
| QS-2 | Money is always Decimal.js | Plain `Number()` arithmetic on `totalValue`/currency fields in reconciliation comparisons | `src/lib/reconciliation/reconciliationEngine.ts:67-78,93-99` |
| QS-4 | One real Vitest per capability | No test for `PdfCanvas`/bbox scaling | No `PdfCanvas.test.ts` (F02-D-6) |
| QS-4 | " | No test for classification mapping/threshold | No `classificationMapping.test.ts` (F02-B-5) |
| QS-4 | " | No test for upload MIME/size rejection | Zero `FILE_TOO_LARGE`/`MIME_TYPE_NOT_ALLOWED` hits in `tests/` (F02-A-6) |
| QS-4 | " | No test isolating the classification-coverage factor — the live E-1 scoring bug ships with no failing test | `tests/shipment-readiness.test.ts` (F03-E-5) |
| QS-5 | Every write goes to AuditLog | `document.attach` and `EXTRACTION_FIELD_CORRECTED` are raw strings, not in the `AuditAction` enum, inconsistent with `RECONCILIATION_RUN` etc. used elsewhere | `src/app/api/documents/[id]/attach/route.ts:56`; `src/app/api/documents/[id]/extractions/fields/route.ts:111`; enum at `src/lib/audit/auditActions.ts` |
| QS-5 | " | Paired `ReconciliationIssue`/`ExceptionItem` resolution is two sequential non-transactional writes despite being described as "the same transaction" | `src/app/api/shipments/[id]/reconcile/issues/[issueId]/route.ts:65-94` |
| QS-6 | `.describe()` on Zod schemas | Undecorated fields in the new intake endpoint and reconcile/reorder routes | `src/app/api/v1/intake/document/route.ts:18-29`; `reconcile/route.ts:12`; `reconcile/issues/[issueId]/route.ts:9-20`; `documents/reorder/route.ts:7-12` |
| QS-9 | Idempotency-Key on mutation endpoints | No F02 document routes or F03 reconcile/attach routes adopt the existing `src/lib/api/idempotency.ts` helper (used elsewhere in the app) | `upload`, `v1/intake/document`, `extractions/fields`, `attach`, `reconcile`, `reconcile/issues/[issueId]` routes |
| — | Migration hygiene | `DocumentShipmentCandidate.confidenceScore` referenced by schema and code but present in **zero** committed migration files — applied via `db push` only | `prisma/schema.prisma:675`; `grep` across `prisma/migrations/*/migration.sql` → 0 hits |
| — | Taxonomy consistency | Missing-document exceptions use `category: "DOCUMENT"` where the spec and the rest of the Exceptions tab use `category: "MISSING_DATA"` | `src/app/api/shipments/[id]/reconcile/route.ts:230` |

---

## Top 5 fixes ranked by severity

1. **Wire the real reconciliation engine into the automatic document pipeline (F03-B-4).** `PipelineOrchestrator` currently calls a legacy engine that hard-codes zero conflicts (`pipelineOrchestrator.ts:209`, `src/modules/shipment/reconciliationEngine.ts:69`); the correct engine only runs via a route with no UI caller. This single fix unblocks F03-B, C, and part of D, which are otherwise fully built and tested.
2. **Build the shipment-candidate suggestion UI (F02-E-2).** The backend (schema, join, pagination, confidence ranking) is done, but `grep` confirms zero UI code anywhere reads `shipmentCandidates` — the original "written but never read" gap is functionally unchanged from the baseline audit.
3. **Fix the classification-coverage scoring bug (F03-E-1).** `shipmentReadiness.ts:145-147`'s redundant `|| Boolean(li.htsCode)` disjunct means readiness scores overstate filing readiness for any shipment with unapproved HTS codes — a correctness bug in a customer-facing compliance signal, and the test suite doesn't catch it.
4. **Build the evidence viewer in decision cards (F02-D-5).** `ActionsClient.tsx` has zero references to `PdfCanvas`; "Qubere proves every line item" (the product's stated positioning) is not actually demonstrable from the Decisions/Actions screen today.
5. **Wire `extractions/fields` correction endpoint into the UI and downstream reconciliation trigger (F02-C-4 / F03-F-3).** The endpoint is correctly built, tenant-scoped, and audited, but has no caller anywhere in the app and fires no reconciliation event — it is currently dead code from a product standpoint.
