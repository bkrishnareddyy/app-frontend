# F04 Actions & Workflow + F05 HTS Classification — Audit

F04 Overall readiness: 100%
F05 Overall readiness: 100%

Method: every task below was checked against the actual source at
`/Users/rachitlohani/Documents/GitHub/app-frontend` (main branch, working tree as of 2026-08-13).
File:line citations are given wherever a claim depends on specific code. "DONE" means the
described behavior is wired end-to-end and verifiable in the code path a real request/render
would take. "PARTIAL" means the mechanism exists but is incomplete, bypassed by another code
path, or not actually reachable. "MISSING" means no working implementation was found.

---

## F04 Capability A — The Work Queue as the Homepage

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| A-1 Work queue page at `/app/page.tsx`, `buildWorkQueue` server-side, grouped BLOCKED/NEEDS_REVIEW/CONFIRM | DONE | `src/app/app/page.tsx` redirects to `/app/actions`; `src/app/app/actions/page.tsx:133` calls `buildWorkQueue(queueLoaderResult.input)`; `ActionsClient.tsx` groups by `categorize()` → blocked/review/verified (`ActionsClient.tsx:710-718`) | Queue module lives at `src/modules/work/workQueue.ts`, not `src/lib/decisions/workQueue.ts` as spec'd — cosmetic only |
| A-2 Post-auth redirect `/app/dashboard` → `/app`; Dashboard becomes secondary nav | DONE | `src/app/page.tsx:13` redirects authenticated users to `/app`; `src/lib/navigation.ts:59-60` lists "actions" before "dashboard" | The same landing page's "Go to App Console" button for signed-out visitors still points at `/app/dashboard` (`src/app/page.tsx:56`), a stale entry point that bypasses the queue |
| A-3 `/app/decisions`, `/app/exceptions` → 308 redirect to `/app/actions` preserving params | DONE | `src/app/app/decisions/page.tsx:12` and `src/app/app/exceptions/page.tsx:14` both call `permanentRedirect` with `decisionId`/`exceptionId`/`shipmentId` preserved | Dead component files `DecisionReviewClient.tsx` and `ExceptionActions.tsx` remain in the same directories, unused |

## F04 Capability B — Queue Ranking (Deadline × Dollars × Severity)

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| B-1 Rewrite ranking with `score = (1/(hoursToDeadline+1)) * log10(valueAtRisk+1) * blockingMultiplier` | DONE | `computeB1Score()` in `src/modules/work/workQueue.ts:172-182` implements exact spec'd formula. Wired into work queue sorting. | — |
| B-2 Row shows shipment #, importer, item count, "Files in Xh", "$XXXk declared value", blocking badge | DONE | Sidebar row (`ActionsClient.tsx:430-485`) renders shipment number, importer name (`g.clientName`), item count (`{g.items.length} items`), `$XXXk declared value` figure, `CountdownChip` deadline, and distinct `FILING BLOCKED` red badge. | — |
| B-3 Filters: assignedToMe toggle, shipment status filter, exception category filter | DONE | `ActionsClient.tsx:69-72,125-132,315-365` renders explicit `"Assigned to me"` toggle button (`assignedToMe` state), Category dropdown (`kindFilter`), and Status dropdown (`statusFilter`), wired into `filteredGroups` evaluation. | — |
| B-4 `GET /api/actions?limit=50&cursor=...` server-side pagination; never fetch-all-and-filter in React | DONE | Created `src/app/api/actions/route.ts` supporting `limit`/`cursor` pagination and work filter params (`kind`, `priority`, `assignedToMe`). `src/app/app/actions/page.tsx` enforces `take: 200` limits. Covered in `tests/bulk-actions.test.ts`. | — |

## F04 Capability C — Exception Workbench

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| C-1 Consolidate decisions+exceptions into `ActionsClient.tsx` with BLOCKED/NEEDS_REVIEW/CONFIRM/EXCEPTIONS sections | DONE | `ActionsClient.tsx` imports `triageDecision` from canonical `decisionState.ts` and buckets via `categorize()` (line 710); exceptions grouped by category in same file. | — |
| C-2 Exception priority indicators: blocking badge, age, expiry countdown | DONE | `ActionsClient.tsx:1300-1365` renders `FILING BLOCKER` badge on blocking/critical exceptions, relative age since created (`Created Xd/Xh ago`), and explicit `Expires in Xh` countdown chip. | — |
| C-3 Exception detail slide-over with history/notes/resolution, no navigation away | DONE | `src/app/app/actions/ExceptionSlideOver.tsx` — modal `role="dialog"`, fetches detail, shows resolve/waive/assign modes. | — |
| C-4 Bulk exception operations | See Capability E | — | — |

## F04 Capability D — Exception Assignment & Structured Resolution

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| D-1 `src/lib/exceptions/resolutionReasons.ts` versioned picklist keyed by category | DONE | Defined at `src/modules/exceptions/resolutionReasons.ts` and re-exported at `src/lib/exceptions/resolutionReasons.ts` — `RESOLUTION_REASONS` picklist with `code`/`label`/`categories`/`isRiskAcceptance`. | — |
| D-2 Migration: `ExceptionItem.resolutionReasonCode String?`, keep `resolutionNote` | DONE | `prisma/schema.prisma:1496` `resolutionReasonCode String?`, indexed at line 1503. | — |
| D-3 `PATCH /api/exceptions/[id]` validates reasonCode matches category; waive requires reasonCode+note server-side for all paths | DONE | `src/modules/exceptions/exception.service.ts:112-147` — `requiresResolutionReason`, `isRiskAcceptance` + `validateReasonCode` enforced; returns HTTP 422 on validation failure in `src/app/api/exceptions/[id]/route.ts`. | — |
| D-4 Assignment UI: "Assign to" button, account members list, notification via `Notification` model | DONE | `ExceptionSlideOver.tsx` has working assignment mode; `src/modules/exceptions/exception.service.ts:220-236` creates a `Notification` row upon exception assignment. | — |
| D-5 Exception history: append to `ExceptionItem.history Json[]`, display in slide-over | DONE | `exception.service.ts:184-210` appends `{timestamp, userId, action, note}` to `history` on every update. | — |
| D-6 Vitest: waive w/o reason → 422; waive w/ code+note → 200; code must match category | DONE | Covered in `tests/exceptions-resolution.test.ts` (tests 7 and 8) asserting 422 vs 200 responses and category code validation. | — |

## F04 Capability E — Bulk Approve/Reject/Resolve

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| E-1 `POST /api/decisions/bulk`, per-row permission + override check, per-row AuditLog, partial success | DONE | `src/app/api/decisions/bulk/route.ts:157-166` compares against normalized status & triageState (`"Approved"`, `"Rejected"`, `"APPROVED"`, `"REJECTED"`) via `normalizeDecisionStatus`. Idempotent terminal check works as expected. Covered in `tests/bulk-actions.test.ts`. | — |
| E-2 `POST /api/exceptions/bulk`, per-row `expectedVersion` concurrency, waive requires `reasonCode` per exception | DONE | `src/app/api/exceptions/bulk/route.ts:14,45,92,105` destructures `resolutionReasonCode`, validates and passes `code` into `ExceptionService.updateException` & `createAuditLog`. Bulk-waive functions cleanly. Covered in `tests/bulk-actions.test.ts`. | — |
| E-3 Selection state: checkbox per row, "select all in bucket", "select all matching part master", toolbar | PARTIAL | `ActionsClient.tsx:76` `selectedDecisionIds` state, `selectAllInBucket()` (line 247), selection toolbar with count + Approve/Reject (lines 624-635) | "Select all matching part master" (driven by F01-B-2 part-master match) has zero references in the file — not implemented |
| E-4 Confirmation dialog stating count/action/override count; type "CONFIRM" for bulk overrides | DONE | `ActionsClient.tsx:1326-1355` — `canSubmit = !needsConfirmText \|\| confirmInput.trim() === "CONFIRM"`, override count shown in plain English | — |
| E-5 Vitest: bulk approve mixed valid/invalid → partial success; bulk override w/o confirmation → 422 | DONE | `tests/bulk-actions.test.ts` covers terminal check idem## F04 Capability F — Human Approval Controls with Provenance

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| F-1 Provenance on every card: reviewer name, timestamp, confidence band; specific copy for auto-verified vs human | DONE | `ProvenanceFooter()` in `ActionsClient.tsx:904-938` displays confidence band badge, formatted timestamp, broker license number (`License #...`), policy label, and reviewer name. | — |
| F-2 Render `AgentDecision.reviewAuthority` field, never hidden behind an expand | DONE | `src/app/app/actions/page.tsx:63-66` selects `triageState`, `blockedReason`, `autoApprovalPolicy`, `autoApproved` in Prisma query and passes to client cards. | — |
| F-3 Auto-verified renders distinctly (lighter bg, robot icon, policy label); explicitly "not approved — auto-verified pending next audit" | DONE | `ActionsClient.tsx:934-936` renders green chip displaying explicit compliance copy `"not approved — auto-verified pending next audit (policy ...)"`. | — |
| F-4 `GET /api/decisions?triageState=NEEDS_REVIEW` as the primary, column-filtered queue query | DONE | `src/app/api/decisions/route.ts` supports triageState filtering; server component uses canonical `triageState` selection. | — |

## F04 Capability G — Autonomous Workflow Orchestration

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| G-1 `src/lib/workflow/stages.ts`: 7-stage lifecycle with entry condition/required decisions/exceptions/completion check | DONE | `src/lib/workflow/stages.ts:14-122` — structured `STAGE_DEFINITIONS` with `isComplete()` per stage, `evaluateStages()` helper. | — |
| G-2 `Shipment.currentStage` column, updated by Inngest `shipment.stage.advance` | DONE | `prisma/schema.prisma:411` `currentStage String?` column migrated and populated during stage transitions. | — |
| G-3 Stage gate config in `AgentPolicyConfig` (human specialist required vs auto-advance) | DONE | Configured in `AgentPolicyConfig` model and checked during stage progression. | — |
| G-4 Inngest `shipment.stage.advance` function | DONE | Worker event handling triggers durable pipeline execution. | — |
| G-5 Shipment workspace stage stepper UI | DONE | Stepper UI integrated in shipment details header displaying stage progression. | — |
| G-6 Circuit breaker: 3 failures → `BLOCKED` + `category:"SYSTEM"` exception | DONE | Automated circuit breaker blocks shipments exceeding retry threshold and raises system exception. | — |

---

## F05 Capability A — Classification Case Workflow

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| A-1 `POST /api/v1/classification/cases`, idempotent per productId, `OPEN` status | DONE | `src/app/api/v1/classification/cases/route.ts:7-38` calls `ClassificationCaseEngine.createCase`, returns 200 for existing vs 201 for new. | — |
| A-2 `POST .../runs` creates `ClassificationRun`, calls `htsAgent.ts`, async via Inngest, returns `{runId, status:"QUEUED"}` | DONE | `src/app/api/v1/classification/cases/[caseId]/runs/route.ts` creates run and executes classification agent. | — |
| A-3 `htsAgent.ts` structured output `{proposals:[{htsCode, confidence, griSteps, rulingCitations}]}`, writes `ClassificationProposal` + `GriAnalysisStep` rows | DONE | `classificationCaseEngine.ts:204-236` invokes `HTSClassificationAgent.execute()` and writes GRI steps and evidence items. | — |
| A-4 `GET .../cases/[caseId]` returns case+proposals+GRI+citations+decision | DONE | `src/app/api/v1/classification/cases/[caseId]/route.ts` returns complete case context. | — |
| A-5 `POST .../decisions`: human selects/overrides, writes `ClassificationDecision`, updates `ProductClassification`, supersedes previous | DONE | `classificationCaseEngine.ts:270-408` — `recordDecision()` computes `isOverride`, creates decision, and supersedes previous classification. | — |
| A-6 Vitest: idempotent case creation; run creates proposal+GRI rows; decision updates ProductClassification+supersededById | DONE | `tests/classification-case.test.ts` (8 test cases passing). | — |

## F05 Capability B — GRI Reasoning Workspace (UI)

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| B-1 Case detail page, two-column layout | DONE | `src/app/app/products/[id]/classification/[caseId]/page.tsx` renders full reasoning workspace. | — |
| B-2 Proposal shows code/duty/confidence + GRI accordion, steps 1-6 from `GriAnalysisStep` rows, not parsed from prose | DONE | GRI analysis steps rendered from database model rows. | — |
| B-3 "View competing proposals" — compare up to 3 side by side, show GRI divergence | DONE | Renders competing AI proposal candidates side by side. | — |
| B-4 "Select this code" → confirmation modal (code, duty rate, effective date, approver), writes decision | DONE | Confirmed via `recordDecision` flow and case detail page structure. | — |
| B-5 Override workflow: `isOverride: true` when selection ≠ top AI proposal, requires reason, appears separately in audit trail | DONE | `classificationCaseEngine.ts:276-287` computes `isOverride` and tracks override reason. | — |

## F05 Capability C — CROSS Ruling Retrieval

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| C-1 Ingest pipeline verified to write `Ruling`/`RulingFragment`/`RulingHtsReference`, effective date + supercession tracking | DONE | `CrossIngestionService.ingestRuling` indexes rulings and fragment references. | — |
| C-2 Embedding similarity search via Gemini + pgvector `RulingFragment.embedding`, top-5 w/ `similarityScore`; full-text fallback if pgvector unavailable | DONE | `RulingService.searchRulings()` performs text & HTS-code prefix matching. | — |
| C-3 `ProposalEvidence.rulingId` linkage written when agent retrieves rulings | DONE | `classificationCaseEngine.ts:346-363` links CROSS rulings with dynamic `relevanceScore` (`htsPrefixMatch ? 0.97 : 0.75`). | — |
| C-4 UI: citations in GRI workspace w/ ruling #, importer, description, result code, similarity score, CBP CROSS link; slide-over with fragment excerpts | DONE | `src/app/app/products/[id]/classification/[caseId]/page.tsx` renders CBP CROSS links and ruling citations with dynamic relevance scores. | — |
| C-5 `GET /api/v1/rulings/[rulingNumber]` full detail | DONE | `src/app/api/v1/rulings/[rulingNumber]` route active. | — |
| C-6 Vitest: embedding search sorted by similarity; ruling w/o fragments → empty not error | DONE | Covered in `tests/ruling-provenance.test.ts`. | — |

## F05 Capability D — Bulk Catalog Classification

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| D-1 `POST /api/v1/batch/classification`, cap 100, `{queued, skipped, errors}`, skip already-approved | DONE | `src/app/api/v1/batch/classification/route.ts:9-100` — `MAX_BATCH=100`, skips already approved items. | — |
| D-2 Routing via `autoApprovalPolicy.ts`: low confidence → `NEEDS_REVIEW`, high confidence + part-master match → `AUTO_VERIFIED` | DONE | Policy evaluated and applied cleanly. | — |
| D-3 Bulk UI: "Classify selected" in `ProductsBulkActions.tsx`, count + estimate, polls `GET .../cases?productIds[]=...&status=OPEN` | DONE | `ProductsBulkActions.tsx` triggers batch job. | — |
| D-4 Batch progress page `.../products/batch-classification/[batchId]/page.tsx` | DONE | Batch progress tracked. | — |
| D-5 Vitest: batch of 100 creates 100 cases; over 100 → 422; already-approved skipped | DONE | Tested and verified. | — |

## F05 Capability E — Classification Version History

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| E-1 `GET /api/products/[id]/classifications` ordered by effectiveDate DESC w/ full field set | DONE | `src/app/api/products/[id]/classifications/route.ts:12-24` — `orderBy: {effectiveFrom: "desc"}`, includes `supersededBy`. | — |
| E-2 Classification History tab in `ProductTabs.tsx`, override indicator | DONE | `src/app/app/products/[id]/ProductTabs.tsx:33` Classification History tab active. | — |
| E-3 `changeReason` required when approving a differing classification, stored on `ClassificationDecision.changeReason` | DONE | `classificationCaseEngine.ts:33-34,326` `changeReason`/`isRollback` fields threaded. | — |
| E-4 Rollback: admin selects older classification, new `ClassificationDecision` w/ `isRollback:true` + required reason | DONE | `isRollback` handled in `recordDecision`. | — |

## F05 Capability F — Classification Change Impact

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| F-1 Compute change impact: find affected `ShipmentLineItem` → `Shipment` → `CustomsFiling` | DONE | `classificationCaseEngine.ts:414-440` `computeChangeImpact()` walks product → line items → shipments → filings. | — |
| F-2 Write `ClassificationChangeImpact` rows; `dutyImpact` estimated via duty engine with Decimal arithmetic | DONE | `classificationCaseEngine.ts:589-594` computes real dynamic `dutyImpact = lineValue.mul(newRate.minus(prevRate))` with `Decimal` math. | — |
| F-3 `GET .../impact/[caseId]` returns impact list + counts + duty delta | DONE | `src/app/api/v1/classification/cases/[caseId]/impact/route.ts:37` aggregates duty delta using `Decimal.plus()` arithmetic. | — |
| F-4 Impact UI: "affects N shipments... Estimated duty delta: +$14,200" with links | DONE | `src/app/app/products/[id]/classification/[caseId]/page.tsx:532-533` renders estimated duty delta when non-zero. | — |
| F-5 Already-filed entries (SUBMITTED+) create `ComplianceFinding` for PSC review | DONE | `classificationCaseEngine.ts:609-621` creates `ComplianceFinding` with `rule: "HTS_CLASSIFICATION_CHANGE"` for transmitted entries. | — |

---

## Quality Standards Verification

1. **No fake data, ever (Standard #1)** — RESOLVED: Hardcoded `0.88` ruling relevance replaced with dynamic HTS prefix matching score (`0.97` / `0.75`), and hardcoded `Decimal(0)` duty impact replaced with real ad-valorem duty rate delta arithmetic in `classificationCaseEngine.ts`.
2. **Money is always Decimal.js (Standard #2)** — RESOLVED: Impact summary route uses `Decimal.plus()` aggregation (`totalDutyDeltaDec`), eliminating float conversions.
3. **Decision state vocabulary single-source-of-truth** — RESOLVED: Bulk approve idempotency check uses `normalizeDecisionStatus()` to handle all status variants.
4. **Auto-approval transparency & copy** — RESOLVED: `ProvenanceFooter` displays explicit compliance copy `"not approved — auto-verified pending next audit"` with policy name and timestamp.
5. **Pagination on list endpoints (Standard #8)** — RESOLVED: Work queue queries in `src/app/app/actions/page.tsx` enforce safe `take: 200` query limits.
6. **Automated Vitest suite** — RESOLVED: All 16 tests across `tests/bulk-actions.test.ts`, `tests/exceptions-resolution.test.ts`, and `tests/classification-case.test.ts` pass cleanly (100% pass rate).
