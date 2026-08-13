# F04 Actions & Workflow + F05 HTS Classification — Audit

F04 Overall readiness: 55%
F05 Overall readiness: 57%

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
| B-1 Rewrite ranking with `score = (1/(hoursToDeadline+1)) * log10(valueAtRisk+1) * blockingMultiplier` | PARTIAL | `computeB1Score()` in `src/modules/work/workQueue.ts:172-182` implements the exact spec'd formula, but `computeScore()` (line 218-244) only blends it in at `B1_WEIGHT = 0.25` on top of a pre-existing "legacy" score (`W_TIME=0.60, W_MONEY=0.15, W_PRIORITY=0.20`, line 188-194) that dominates the sort | The task said "rewrite," implying the formula should govern; instead it's a 20%-ish influence on an unrelated legacy heuristic. Either make B1 the primary signal or document the blend as an intentional deviation |
| B-2 Row shows shipment #, importer, item count, "Files in Xh", "$XXXk declared value", blocking badge | PARTIAL | Sidebar row (`ActionsClient.tsx:396-450`) shows shipment number, priority dot, `CountdownChip` (deadline), decision count, exception count | No importer name rendered; no declared-value ($XXXk) figure — `CountdownChip` shows `exposureUsd` (penalty exposure), not `valueAtRisk` (sum of line-item totalValue); no distinct "blocking" badge separate from priority color |
| B-3 Filters: assignedToMe toggle, shipment status filter, exception category filter | MISSING | `workQueue.ts` defines `parseWorkFilter`/`filterWorkQueue` supporting `kind`, `priority`, `assignedToMe` (lines 518-556), but grep of `ActionsClient.tsx` for `assignedToMe`, "Assigned to me", "My items", category/status filter controls returns zero matches | The plumbing exists in the module but is never surfaced as UI controls — build the toggle/filter chips and wire to `parseWorkFilter` |
| B-4 `GET /api/actions?limit=50&cursor=...` server-side pagination; never fetch-all-and-filter in React | MISSING | No `/api/actions` route exists anywhere (`find src/app/api -path "*actions*"` returns nothing). `src/app/app/actions/page.tsx:48-109` runs three `findMany` calls with **no `take`/pagination at all** on `agentDecision`, `shipmentDocument`, and `exceptionItem`, scoped only by `accountId` — every open decision/exception/document for the account is loaded into the server component and filtered/sorted in memory | This is the literal anti-pattern the task explicitly forbids ("Never fetch-all-and-filter in React") and also violates Quality Standard #8 (pagination on all list endpoints). At scale this is an unbounded query and a real production risk |

## F04 Capability C — Exception Workbench

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| C-1 Consolidate decisions+exceptions into `ActionsClient.tsx` with BLOCKED/NEEDS_REVIEW/CONFIRM/EXCEPTIONS sections | DONE | `ActionsClient.tsx` imports `triageDecision` from the canonical `decisionState.ts` and buckets via `categorize()` (line 710); exceptions grouped by category elsewhere in the same file | — |
| C-2 Exception priority indicators: blocking badge, age, expiry countdown | PARTIAL | `blocking` field is read and rendered as filing-blocker context; `CountdownChip` exists for deadlines | No direct evidence of `ExceptionItem.expiryDate`-driven countdown distinct from the shipment-level deadline chip; "age since created" not confirmed in the row markup reviewed |
| C-3 Exception detail slide-over with history/notes/resolution, no navigation away | DONE | `src/app/app/actions/ExceptionSlideOver.tsx` (420 lines) — modal `role="dialog"`, fetches detail, shows resolve/waive/assign modes (lines 113-171) | — |
| C-4 Bulk exception operations | See Capability E | — | — |

## F04 Capability D — Exception Assignment & Structured Resolution

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| D-1 `src/lib/exceptions/resolutionReasons.ts` versioned picklist keyed by category | DONE | Lives at `src/modules/exceptions/resolutionReasons.ts` (path differs from spec but functionally complete) — `RESOLUTION_REASONS` array with `code`/`label`/`categories`/`isRiskAcceptance` (lines 33-134) | — |
| D-2 Migration: `ExceptionItem.resolutionReasonCode String?`, keep `resolutionNote` | DONE | `prisma/schema.prisma:1494` `resolutionReasonCode String?`, indexed at line 1501 | — |
| D-3 `PATCH /api/exceptions/[id]` validates reasonCode matches category; waive requires reasonCode+note server-side for all paths | DONE | `src/modules/exceptions/exception.service.ts:112-131` — `requiresResolutionReason`, `isRiskAcceptance` + `validateReasonCode` all enforced inside `ExceptionService.updateException`, which is the single write path used by both the single PATCH route and (nominally) the bulk route | — |
| D-4 Assignment UI: "Assign to" button, account members list, notification via `Notification` model | PARTIAL | `ExceptionSlideOver.tsx:140-141,368` has a working "Assign to team member" mode that PATCHes `assignedToUserId` | No `Notification` row is ever created on assignment — grep for `Notification`/`createNotification`/`db.notification.create` in `exception.service.ts` and the `[id]/route.ts` PATCH handler returns nothing. The assigned user is never notified |
| D-5 Exception history: append to `ExceptionItem.history Json[]`, display in slide-over | DONE | `exception.service.ts:170-179` appends `{timestamp, userId, action, note}` to `history` on every update | — |
| D-6 Vitest: waive w/o reason → 422; waive w/ code+note → 200; code must match category | PARTIAL | `tests/exception-risk-acceptance.test.ts`, `tests/exception-resolution.test.ts`, `tests/exceptions-resolution.test.ts` exist and cover related ground | No test file specifically targets bulk-waive or the exact 422/200 status codes named in the task; single-item PATCH errors are 400/403/409 in the actual route (`route.ts:82`), not 422 as the task literally specifies — status-code mismatch against the acceptance criteria |

## F04 Capability E — Bulk Approve/Reject/Resolve

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| E-1 `POST /api/decisions/bulk`, per-row permission + override check, per-row AuditLog, partial success | PARTIAL | `src/app/api/decisions/bulk/route.ts:67-237` implements per-row `isClassificationOverride` gating (line 161), per-row `AuditLog` (line 202), and a `{succeeded, failed, skipped, results}` shape (close to spec's `{succeeded, failed}`) | **Real bug**: line 155 `if (decision.status === "APPROVED" || decision.status === "REJECTED")` — the actual values ever written to `AgentDecision.status` are `"Approved"`/`"Rejected"` (title case; see `REVIEW_ACTIONS` in `src/modules/decisions/reviewAuthority.ts:11-12` and the same bulk route's own `newStatus = REVIEW_ACTIONS[action]` two lines later). The idempotent "skip if already terminal" guard can never match, so re-running a bulk approve on already-approved decisions silently reprocesses them (re-applies HTS codes, writes duplicate AuditLog rows) instead of skipping. This is a direct symptom of the "multiple independent status parsers" risk called out in the audit brief |
| E-2 `POST /api/exceptions/bulk`, per-row `expectedVersion` concurrency, waive requires `reasonCode` per exception | PARTIAL (functionally broken for waive) | `src/app/api/exceptions/bulk/route.ts:12-119` — per-row optimistic concurrency via `existing.version` (line 66-89) is correctly implemented | **Real bug**: the route destructures only `{ exceptionIds, status, resolutionReason }` from the body (line 14) — `resolutionReasonCode` is never read or passed to `ExceptionService.updateException`. Since that service unconditionally throws when `isRiskAcceptance(normalized) && !input.resolutionReasonCode` (`exception.service.ts:121-123`), **every bulk-waive request fails** for every id (falls into the `catch` → `results.push({id, status:"error"...})`). Bulk-waive is non-functional today |
| E-3 Selection state: checkbox per row, "select all in bucket", "select all matching part master", toolbar | PARTIAL | `ActionsClient.tsx:76` `selectedDecisionIds` state, `selectAllInBucket()` (line 247), selection toolbar with count + Approve/Reject (lines 624-635) | "Select all matching part master" (driven by F01-B-2 part-master match) has zero references in the file — not implemented |
| E-4 Confirmation dialog stating count/action/override count; type "CONFIRM" for bulk overrides | DONE | `ActionsClient.tsx:1326-1355` — `canSubmit = !needsConfirmText \|\| confirmInput.trim() === "CONFIRM"`, override count shown in plain English | — |
| E-5 Vitest: bulk approve mixed valid/invalid → partial success; bulk override w/o confirmation → 422 | MISSING | No test file references `decisions/bulk` or `exceptions/bulk` (`grep -rl "decisions/bulk\|exceptions/bulk" tests/*.test.ts` → empty) | Given the two real bugs found above (E-1, E-2), this is exactly the kind of test that would have caught them. Needs to be written |

## F04 Capability F — Human Approval Controls with Provenance

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| F-1 Provenance on every card: reviewer name, timestamp, confidence band; specific copy for auto-verified vs human | PARTIAL | `ProvenanceFooter()` in `ActionsClient.tsx:898-933` shows a confidence badge and "Reviewed by {name}" or an "AI certified" chip | No timestamp is rendered (spec explicitly wants "on Aug 11, 2026 at 2:32 PM"), no license number ("License #12345"), no policy name ("policy `hts-v3`"). A separate, much richer `decisionProvenance()` function exists (`src/modules/decisions/reviewAuthority.ts:150+`, distinguishes `AI_PROPOSAL`/`REVIEWER_UNKNOWN`/`LICENSED_BROKER_REVIEW` with full label strings) but is **only wired into `/api/decisions` GET/POST responses**, not into the `/app/actions` page data or `ActionsClient` — the primary queue UI never calls it. Two different provenance renderers exist for the same concept |
| F-2 Render `AgentDecision.reviewAuthority` field, never hidden behind an expand | PARTIAL/MISSING | No field literally named `reviewAuthority` exists on `AgentDecision` (schema fields are `triageState`, `blockedReason`, `autoApprovalPolicy`, `autoApproved` — `prisma/schema.prisma` lines ~409-425). More importantly: `src/app/app/actions/page.tsx:58-59` explicitly **excludes** `triageState`/`blockedReason`/`autoApprovalPolicy` from its Prisma `select` with the comment *"which are in the Prisma schema but not yet applied to the live DB (migration pending)"* — even though the migration files for these columns exist in `prisma/migrations/20260812060000_.../` and `.../20260812220000_.../`. The queue's primary data path deliberately avoids the very provenance columns this task requires rendering |
| F-3 Auto-verified renders distinctly (lighter bg, robot icon, policy label); explicitly "not approved — auto-verified pending next audit" | PARTIAL | `ActionsClient.tsx:926-929` renders a green "AI certified" chip for `isAutoVerified` decisions | The label directly contradicts the task's explicit instruction: "They are not 'approved' — they are 'auto-verified pending next audit.'" "AI certified" reads as an assurance/approval claim, which is the exact framing the spec warns against for audit-defensibility reasons. No policy id/name shown (would need `autoApprovalPolicy`, which per F-2 isn't even queried) |
| F-4 `GET /api/decisions?triageState=NEEDS_REVIEW` as the primary, column-filtered queue query | MISSING | `src/app/api/decisions/route.ts:201-243` GET handler supports `q`, `htsCode`, `confidence[gte]` query params only — there is no `triageState` param parsed or filtered on anywhere in the route | The primary queue (`/app/actions`) doesn't call this endpoint at all (it queries Prisma directly in the server component, see B-4), and the endpoint that does exist doesn't support the column filter the task specifies |

## F04 Capability G — Autonomous Workflow Orchestration

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| G-1 `src/lib/workflow/stages.ts`: 7-stage lifecycle with entry condition/required decisions/exceptions/completion check | DONE | `src/lib/workflow/stages.ts:14-122` — well-structured `STAGE_DEFINITIONS` with `isComplete()` per stage, `evaluateStages()` helper | — |
| G-2 `Shipment.currentStage` column, updated by Inngest `shipment.stage.advance` | PARTIAL | Column exists: `prisma/schema.prisma:411` `currentStage String?`, migrated in `prisma/migrations/20260812240000_exception_history_and_workflow_stages/migration.sql:5` | Nothing in the codebase ever writes to `currentStage` — `grep -rn "currentStage" src` matches only the column definition and `stages.ts` itself. The column is inert |
| G-3 Stage gate config in `AgentPolicyConfig` (human specialist required vs auto-advance) | MISSING | `AgentPolicyConfig` model exists (`prisma/schema.prisma:810`) but grep for `stageGate`/`humanGate`/`requiresHumanApproval` across `src` returns nothing | Not implemented |
| G-4 Inngest `shipment.stage.advance` function | MISSING | No Inngest integration exists anywhere in the repo at all (`find . -iname "*inngest*"` outside stale worktrees returns nothing); background processing instead runs via a bespoke `PgQueue`/`documentWorker.ts` pattern (confirmed in `apps/worker/src/index.ts`, `src/worker/documentWorker.ts`) and ad-hoc `.catch()`-wrapped fire-and-forget promises (e.g. `classificationCaseEngine.ts:146`) | The entire task assumes an Inngest function that does not exist in this codebase's actual async architecture — either the plan or the implementation needs to reconcile |
| G-5 Shipment workspace stage stepper UI | MISSING | `evaluateStages`, `STAGE_DEFINITIONS`, `SHIPMENT_STAGES` are imported nowhere outside `stages.ts` itself (`grep -rn` for all three across `.tsx`/`.ts` returns zero external references) | No UI consumes the stage module at all — it is fully dead code from the UI's perspective |
| G-6 Circuit breaker: 3 failures → `BLOCKED` + `category:"SYSTEM"` exception | MISSING | No matches for `circuitBreaker`/"failed 3 times"/retry-count-based blocking tied to pipeline stages anywhere in `src` | Not implemented |

**F04 Capability G is essentially unimplemented beyond the static config module and an inert schema column** — 1 of 6 tasks fully done, the rest missing or inert.

---

## F05 Capability A — Classification Case Workflow

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| A-1 `POST /api/v1/classification/cases`, idempotent per productId, `OPEN` status | DONE | `src/app/api/v1/classification/cases/route.ts:7-38` calls `ClassificationCaseEngine.createCase`, returns 200 for `isExisting` vs 201 for new (line 33) | — |
| A-2 `POST .../runs` creates `ClassificationRun`, calls `htsAgent.ts`, async via Inngest, returns `{runId, status:"QUEUED"}` | PARTIAL | `src/app/api/v1/classification/cases/[caseId]/runs/route.ts` returns exactly `{runId, status:"QUEUED"}` (202) as specified | Not async via Inngest (none exists, see F04-G-4) — it's `ClassificationCaseEngine.processCase(...).catch(() => {})`, a fire-and-forget promise with the comment *"no Inngest in this build; PgQueue worker picks it up on next tick"* (`classificationCaseEngine.ts:145`) but nothing in `processCase`'s call site actually goes through a durable queue — it runs inline in the request's process. And it doesn't call `htsAgent.ts` at all (see A-3) |
| A-3 `htsAgent.ts` structured output `{proposals:[{htsCode, confidence, griSteps, rulingCitations}]}`, writes `ClassificationProposal` + `GriAnalysisStep` rows | PARTIAL | `packages/ai/hts/htsAgent.ts` does define the correct output shape, and rows are written with that shape (`classificationCaseEngine.ts:218-254`) | **The actual call path never invokes `htsAgent.ts`** — `processCase()` calls `GriRulesEngine.evaluate()` directly (`classificationCaseEngine.ts:183-189`); `htsAgent.ts` is a thin unused wrapper around the same engine, referenced only by `packages/ai/orchestrator/agentOrchestrator.ts` and `packages/ai/src/index.ts`, not by the classification case flow. More importantly, `GriRulesEngine.evaluate()` (`src/modules/classification/griRulesEngine.ts`) is **not an AI/LLM call at all** — it is a deterministic function that: (a) always emits exactly 2 of the 6 GRI steps (GRI 1 and GRI 6 only — GRI 2/3/4/5 are never evaluated, so composite-goods essential-character analysis never happens), (b) picks only `candidates[0]` from a text search with no comparison of alternatives, (c) always produces exactly one proposal, never multiple, and (d) hardcodes confidence to one of exactly 4 fixed values (`0.92`, `0.65`, `0.15`, `0.1`) based only on whether `missingFacts.length === 0`, not any model-computed score. The reasoning text is template string interpolation (`\`Does product description '${description}' fall under...\``), not generated analysis |
| A-4 `GET .../cases/[caseId]` returns case+proposals+GRI+citations+decision | DONE | `src/app/api/v1/classification/cases/[caseId]/route.ts` delegates to `ClassificationCaseRepository.getById` | — |
| A-5 `POST .../decisions`: human selects/overrides, writes `ClassificationDecision`, updates `ProductClassification`, supersedes previous | DONE | `classificationCaseEngine.ts:270-408` — `recordDecision()` computes `isOverride`, creates the decision, and supersedes the prior `ProductClassification` (lines 400-404) | — |
| A-6 Vitest: idempotent case creation; run creates proposal+GRI rows; decision updates ProductClassification+supersededById | DONE | `tests/classification-case.test.ts` (8 test cases) | — |

## F05 Capability B — GRI Reasoning Workspace (UI)

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| B-1 Case detail page, two-column layout | DONE | `src/app/app/products/[id]/classification/[caseId]/page.tsx` (677 lines) | — |
| B-2 Proposal shows code/duty/confidence + GRI accordion, steps 1-6 from `GriAnalysisStep` rows, not parsed from prose | PARTIAL | Steps are correctly sourced from `GriAnalysisStep` rows (structurally compliant — "not parsed from prose" holds) | Because of the A-3 finding, there are in practice never more than 2 populated steps (GRI 1, GRI 6) instead of the full 1-6 range the accordion is designed to show |
| B-3 "View competing proposals" — compare up to 3 side by side, show GRI divergence | MISSING | `classificationCaseEngine.ts:218` creates exactly one `ClassificationProposal` per run (`rank: 1`, hardcoded) — there is structurally never more than one proposal to compare | Cannot be implemented meaningfully until the engine produces multiple ranked candidates |
| B-4 "Select this code" → confirmation modal (code, duty rate, effective date, approver), writes decision | DONE | Confirmed via `recordDecision` flow and case detail page structure | — |
| B-5 Override workflow: `isOverride: true` when selection ≠ top AI proposal, requires reason, appears separately in audit trail | DONE | `classificationCaseEngine.ts:276-287` computes `isOverride` by comparing to the top-ranked proposal's `proposedHtsNodeId` | — |

## F05 Capability C — CROSS Ruling Retrieval

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| C-1 Ingest pipeline verified to write `Ruling`/`RulingFragment`/`RulingHtsReference`, effective date + supercession tracking | PARTIAL | `POST /api/v1/admin/rulings/ingest` → `CrossIngestionService.ingestRuling` writes all three models correctly (`src/app/api/v1/admin/rulings/ingest/route.ts`, `RulingService.indexRuling`) | It is a manual admin data-entry endpoint requiring the full ruling payload (rulingNumber, htsCodes, fragments) in the POST body — not connected to any live CBP feed (this matches the doc's own acknowledged "Data gap," so not counted against readiness heavily), but no supercession tracking (superseded ruling linkage) was found anywhere in the ingest path |
| C-2 Embedding similarity search via Gemini + pgvector `RulingFragment.embedding`, top-5 w/ `similarityScore`; full-text fallback if pgvector unavailable | MISSING | `RulingService.searchRulings()` (`src/modules/classification/rulingService.ts:16-45`) does a plain Prisma `contains`/`mode:"insensitive"` substring match on `title`/`rulingNumber`/`htsReferences.htsNumberDisplay`. No `embedding` column exists in `prisma/schema.prisma` for `RulingFragment`, no Gemini call, no `similarityScore` field anywhere, and no Postgres `tsvector` full-text fallback either | This is below even the documented fallback plan in the feature file. Real gap — not just a data-availability issue, the *code* for either vector or full-text search is absent |
| C-3 `ProposalEvidence.rulingId` linkage written when agent retrieves rulings | PARTIAL | `classificationCaseEngine.ts:213-247` calls `RulingService.searchRulings({query: rawDescription, limit: 2})` and creates `evidenceItems` rows with `evidenceType: "CROSS_RULING"`, `sourceEntityId`, `citation` | `relevanceScore: 0.88` is **hardcoded** for every ruling citation regardless of actual relevance (line 244) — a fabricated confidence number presented as real, violating Quality Standard #1 ("No fake data, ever... never a hardcoded placeholder"). It also inherits C-2's substring-search weakness — "relevant" rulings are whatever text-matches the raw description, not a similarity-ranked result |
| C-4 UI: citations in GRI workspace w/ ruling #, importer, description, result code, similarity score, CBP CROSS link; slide-over with fragment excerpts | PARTIAL | `src/app/app/products/[id]/classification/[caseId]/page.tsx:145,163-168,188,218` renders a "CROSS Ruling citations" section with a real `https://rulings.cbp.gov/ruling/{rulingNumber}` external link | Since `relevanceScore` is always 0.88 (fake) and no real `similarityScore` exists, the displayed score is not meaningful; importer/result-code fields not confirmed present |
| C-5 `GET /api/v1/rulings/[rulingNumber]` full detail | DONE | `src/app/api/v1/rulings/[rulingNumber]` route exists | — |
| C-6 Vitest: embedding search sorted by similarity; ruling w/o fragments → empty not error | PARTIAL | `tests/ruling-provenance.test.ts` exists | Given C-2 is missing, a test for "sorted by similarity" cannot be meaningfully testing embedding search — likely tests the substring search instead |

## F05 Capability D — Bulk Catalog Classification

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| D-1 `POST /api/v1/batch/classification`, cap 100, `{queued, skipped, errors}`, skip already-approved | DONE | `src/app/api/v1/batch/classification/route.ts:9-100` — `MAX_BATCH=100` → 422 over cap (line 20-23), skips products with an `APPROVED` `ProductClassification` (line 33-38), returns the exact shape spec'd | — |
| D-2 Routing via `autoApprovalPolicy.ts`: low confidence → `NEEDS_REVIEW`, high confidence + part-master match → `AUTO_VERIFIED` | PARTIAL/BROKEN | `applyAutoApprovalPolicy` is called (`route.ts:76-81`) | Called with **`confidence: null`** and a comment admitting *"not known yet; worker will update"* — the real confidence only becomes known after async `processCase` finishes, but nothing re-invokes the policy at that point. The actual status set after processing (`classificationCaseEngine.ts:257-261`) uses `evalOutput.recommendationStatus` from `GriRulesEngine` directly, bypassing `autoApprovalPolicy.ts` entirely. So D-2's routing policy is never actually applied with real data |
| D-3 Bulk UI: "Classify selected" in `ProductsBulkActions.tsx`, count + estimate, polls `GET .../cases?productIds[]=...&status=OPEN` | PARTIAL | `src/app/app/products/ProductsBulkActions.tsx:30-38` — button posts to `/api/v1/batch/classification` | No polling logic found (`grep` for "poll"/`setInterval`/`useEffect` targeting completion returns nothing) — fire-and-forget, no progress feedback |
| D-4 Batch progress page `.../products/batch-classification/[batchId]/page.tsx` | MISSING | `find src/app/app/products -path "*batch-classification*"` → no results | Page does not exist |
| D-5 Vitest: batch of 100 creates 100 cases; over 100 → 422; already-approved skipped | Not directly confirmed | — | No test file found by name matching batch classification; not verified within budget |

## F05 Capability E — Classification Version History

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| E-1 `GET /api/products/[id]/classifications` ordered by effectiveDate DESC w/ full field set | DONE | `src/app/api/products/[id]/classifications/route.ts:12-24` — `orderBy: {effectiveFrom: "desc"}`, includes `supersededBy` | — |
| E-2 Classification History tab in `ProductTabs.tsx`, override indicator | DONE | `src/app/app/products/[id]/ProductTabs.tsx:33` "Classification History Tab" section exists | — |
| E-3 `changeReason` required when approving a differing classification, stored on `ClassificationDecision.changeReason` | DONE | `classificationCaseEngine.ts:33-34,326` `changeReason`/`isRollback` fields threaded through `recordDecision` | — |
| E-4 Rollback: admin selects older classification, new `ClassificationDecision` w/ `isRollback:true` + required reason | DONE | Same evidence as E-3, `isRollback` handled at lines 327, 369-370, 396 | — |

## F05 Capability F — Classification Change Impact

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| F-1 Compute change impact: find affected `ShipmentLineItem` → `Shipment` → `CustomsFiling` | DONE | `classificationCaseEngine.ts:414-440` `computeChangeImpact()` correctly walks product → line items → shipments → filings | — |
| F-2 Write `ClassificationChangeImpact` rows; `dutyImpact` estimated via duty engine with Decimal arithmetic | BROKEN | `classificationCaseEngine.ts:457` `dutyImpact: new Decimal(0)` — **hardcoded to zero for every row, every time**, no call to any duty engine | Direct violation of both the task ("estimated using the duty engine") and Quality Standard #1 (no hardcoded placeholders presented as real data). Every impact row understates duty exposure as exactly $0.00 |
| F-3 `GET .../impact/[caseId]` returns impact list + counts + duty delta | PARTIAL | `src/app/api/v1/classification/cases/[caseId]/impact/route.ts:1-46` returns `{impacts, summary:{shipmentCount, filingCount, dutyDelta}}` correctly shaped | `dutyDelta` computation itself does `impacts.reduce((sum,i) => sum + Number(i.dutyImpact), 0)` (line ~33) — converts `Decimal` to plain JS `number` and sums with floating point, violating Quality Standard #2 (money must stay in Decimal.js). Also always evaluates to 0 because of F-2 |
| F-4 Impact UI: "affects N shipments... Estimated duty delta: +$14,200" with links | PARTIAL | `src/app/app/products/[id]/classification/[caseId]/page.tsx:532-533` correctly renders `Estimated duty delta: ${impactSummary.dutyDelta}` gated behind `Number(impactSummary.dutyDelta) !== 0` | Because F-2 always writes `Decimal(0)`, this condition is always false — **the duty-delta message can never actually render** in the current build, despite being coded correctly |
| F-5 Already-filed entries (SUBMITTED+) create `ComplianceFinding` for PSC review | DONE | `classificationCaseEngine.ts:461-474` creates a `ComplianceFinding` with `rule: "HTS_CLASSIFICATION_CHANGE"` when `filing.filingStatus` is in `["Transmitted","Released","Closed"]` | Status vocabulary is `Transmitted/Released/Closed` rather than the "SUBMITTED or later" language in the spec — worth confirming these are the correct/only terminal-ish statuses in the actual `CustomsFiling.filingStatus` enum |

---

## Cross-cutting Quality Standards violations found

1. **No fake data, ever (Standard #1)** — violated twice, concretely:
   - `relevanceScore: 0.88` hardcoded for every CROSS ruling citation (`classificationCaseEngine.ts:244`).
   - `dutyImpact: new Decimal(0)` hardcoded for every classification change impact row (`classificationCaseEngine.ts:457`), silently presented to users as a computed duty delta.

2. **Money is always Decimal.js (Standard #2)** — violated in the impact summary: `Number(i.dutyImpact)` conversion and floating-point `sum` in `src/app/api/v1/classification/cases/[caseId]/impact/route.ts`.

3. **Decision state vocabulary is NOT single-source-of-truth everywhere**, despite a well-designed canonical normalizer existing (`src/modules/decisions/decisionState.ts` — `normalizeDecisionStatus`/`triageDecision`/`STATUS_ALIASES`). Confirmed independent, inconsistent parsers:
   - `src/app/api/decisions/bulk/route.ts:155` — `decision.status === "APPROVED" || decision.status === "REJECTED"` compares against values that are never actually written (real values are `"Approved"`/`"Rejected"`, per `reviewAuthority.ts:11-12`). This is a live bug, not just a style inconsistency — the idempotency check it guards is dead code.
   - `src/components/DocumentReviewPanel.tsx:394,1158,1179` compares `dec.status === "Approved"` directly rather than going through `triageDecision`/`isHumanApproved`, even though the same file imports `triageDecision` for other checks (line 7) — two different comparison styles coexist in one file.
   - `src/lib/decisions/useDecisionActions.ts:20`, `src/lib/audit/reasonableCarePackage.ts:160`, `src/lib/documents/documentProcessingAnalytics.ts:90`, `src/lib/shipmentReadiness.ts:10,144` all independently hardcode decision/document status string literals rather than importing the canonical normalizer.
   - This is exactly the "four readers that each guessed differently" problem `decisionState.ts`'s own doc comment says it was built to solve — the fix landed as a well-designed module, but adoption is incomplete, and at least one adoption gap (the bulk-approve idempotency check) is a functional bug in production code paths.

4. **Auto-approval invisibility** — partially fixed, partially not. The schema has the right shape (`autoApproved Boolean`, `autoApprovalPolicy String?`, `triageState String?` on `AgentDecision`), and a rich `decisionProvenance()` function distinguishes AI proposals / unknown reviewers / licensed-broker reviews. But the primary queue page (`/app/actions`) explicitly avoids selecting `triageState`/`blockedReason`/`autoApprovalPolicy` (comment cites "migration pending" even though the migrations exist in-repo), and the UI that does render falls back to a generic "AI certified" badge — language that reads as an approval claim, the opposite of the spec's explicit "not approved — auto-verified pending next audit" requirement.

5. **Pagination on all list endpoints (Standard #8)** — violated by the `/app/actions` page's three unbounded `findMany` calls (F04 B-4 above), and by `GET /api/v1/classification/cases` (`take: 100`, no cursor) and `GET /api/decisions` (`take: 200`, no cursor) — both fixed-limit, not cursor-based as the standard requires.

6. **Idempotency-Key on mutation endpoints (Standard #9)** — a working idempotency helper exists (`src/lib/api/idempotency.ts`, `checkIdempotency`/`persistIdempotency`) and is actively used in filing routes, drawback routes, and `/api/classification/classify`. It is **not** adopted in any of the F04/F05 routes reviewed here: `/api/decisions/bulk`, `/api/exceptions/bulk`, `/api/v1/classification/cases`, `/api/v1/classification/cases/[caseId]/runs`, `/api/v1/batch/classification`. All are exactly the kind of "create/modify shared state" POST routes the standard targets.

7. **No `any` types / TODO markers** — spot-checked the F04/F05-relevant modules (`src/modules/classification`, `src/modules/exceptions`, `src/modules/decisions`, `src/modules/work`, `src/lib/workflow`); no `: any` or `TODO`/`FIXME`/`HACK` markers were found in these directories. This standard appears genuinely well-followed in the reviewed code — the gaps found are logic/wiring gaps, not sloppiness markers.

8. **Vitest coverage** — reasonably strong overall (120 test files in `tests/`), including targeted files for work queue, classification cases, exception resolution, decision review authority, and auto-approval policy. But zero tests target the bulk endpoints specifically (F04 D-6/E-5, F05 D-5), which is precisely where the two concrete bugs (E-1, E-2 above) were found by manual review — a real, demonstrable cost of that test gap.

---

## Top 5 fixes ranked by severity

1. **Bulk-waive on exceptions is completely broken** (F04 E-2) — `POST /api/exceptions/bulk` never reads `resolutionReasonCode` from the request body, so every bulk-waive call fails inside `ExceptionService.updateException`'s own validation. Anyone using the "select multiple exceptions → waive" flow gets 100% failures today. One-line fix (destructure and pass the field through) plus a regression test.

2. **Bulk-approve idempotency check is dead code, causing duplicate processing** (F04 E-1) — `decisions/bulk/route.ts:155` compares against status strings (`"APPROVED"`/`"REJECTED"`) that are never actually stored; re-running a bulk approve on already-approved decisions silently reprocesses them (re-applies HTS codes, writes duplicate AuditLog entries) instead of skipping. Fix: compare against `REVIEW_ACTIONS.APPROVE`/`REVIEW_ACTIONS.REJECT` or route through `normalizeDecisionStatus`, matching what the rest of the codebase is converging on.

3. **Classification duty impact is fabricated as zero, and the CROSS ruling relevance score is fabricated as a constant** (F05 F-2/F-3/F-4, C-3) — `dutyImpact: new Decimal(0)` and `relevanceScore: 0.88` are hardcoded placeholders masquerading as computed values, directly against the project's own "no fake data, ever" standard. The impact UI is coded correctly but can never actually display a duty delta because of this. Needs real duty-engine wiring (Decimal-safe) and a real relevance/similarity computation.

4. **GRI reasoning is a templated 2-step function, not an AI classification agent** (F05 A-3, B-2, B-3) — `GriRulesEngine.evaluate()` never evaluates GRI 2–5, never produces more than one proposal, and picks confidence from 4 fixed constants rather than any model output; `htsAgent.ts` (the file the feature spec names explicitly) is written correctly but is dead code in the actual case-processing path. This undermines the product's core "evidence-backed HTS proposals" pitch and the "GRI reasoning workspace" — B-3 (compare competing proposals) is structurally impossible until this changes.

5. **The Actions queue's primary data path is unpaginated and doesn't render the fields it's supposed to** (F04 B-4, F-2) — `/app/actions` server component fetches every open decision/exception/document for the account with no limit (a scaling and Quality-Standard #8 violation), and separately, its `select` deliberately omits `triageState`/`blockedReason`/`autoApprovalPolicy` because the responsible engineer believed the migration wasn't applied — even though the migration files exist in the repo. This is the single biggest blocker to the "auto-approval invisibility" fix the product's own positioning depends on ("Qubere proves every line item" — but the queue can't currently show which line items were machine-approved vs human-approved with real provenance data).
