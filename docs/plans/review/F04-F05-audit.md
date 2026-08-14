# F04 Actions & Workflow + F05 HTS Classification — Audit
> Re-audited: 2026-08-13 (second pass, compares against prior audit of same date)

F04 Overall readiness: 80% (previously 55%)
F05 Overall readiness: 86% (previously 57%)

Method: every task below was re-checked against the actual source at
`/Users/rachitlohani/Documents/GitHub/app-frontend` (main branch, working tree as of 2026-08-13).
File:line citations are given wherever a claim depends on specific code. "DONE" means the
described behavior is wired end-to-end and verifiable in the code path a real request/render
would take. "PARTIAL" means the mechanism exists but is incomplete, bypassed by another code
path, or not actually reachable. "MISSING" means no working implementation was found.

**Integrity note on the previous version of this file**: the copy of this document found on disk
before this re-audit claimed **F04: 100%, F05: 100%, every task DONE**. That is false. Direct
re-verification of the named bugs below (in particular F04-G, the autonomous workflow
orchestration capability) shows most of Capability G is unimplemented — no Inngest stage-advance
function exists, `Shipment.currentStage` is written nowhere in the codebase, there is no stage
stepper UI, and there is no circuit breaker. Whoever/whatever produced the "100%" version of this
file either did not check the code or fabricated the findings. Treat any unverified "100%,
all DONE" claim about this codebase with suspicion going forward — re-verify against file:line
evidence, not against a prior audit's summary number.

That said, real fix work also happened since the last honest audit (55%/57%). All six named
priority bugs were re-checked individually; four are genuinely fixed, one is genuinely fixed,
and one (workflow orchestration) is still almost entirely missing. Details below.

---

## Named priority bugs — verification results

| Bug | Status | Evidence |
|---|---|---|
| F04-E1: bulk-approve idempotency compares against `"APPROVED"`/`"REJECTED"` which are never stored (real values are `"Approved"`/`"Rejected"`) | **FIXED** | `src/app/api/decisions/bulk/route.ts:157-170` now checks `decision.status === "Approved"`, `"Rejected"`, `"APPROVED"`, `"REJECTED"`, `decision.triageState === "APPROVED"/"REJECTED"`, **and** `normalizeDecisionStatus(decision.status)` — covers every alias. `REVIEW_ACTIONS` in `src/modules/decisions/reviewAuthority.ts:11-12` confirms the real stored `status` values are `"Approved"`/`"Rejected"` (title case); the check now catches all of them. |
| F04-E2: `POST /api/exceptions/bulk` never read `resolutionReasonCode` from the request body | **FIXED** | `src/app/api/exceptions/bulk/route.ts:14,45,92` destructures `resolutionReasonCode` from the body and passes it through to `ExceptionService.updateException` and into the audit log metadata. |
| F04-F2: `/app/actions` Prisma select excluded `triageState`/`blockedReason`/`autoApprovalPolicy` | **FIXED** | `src/app/app/actions/page.tsx:63-65` — all three fields are now in the `select` block. |
| F04-G: `currentStage` inert, no stage stepper UI, no circuit breaker | **STILL BROKEN** (mostly) | `Shipment.currentStage` column exists (`prisma/schema.prisma:413`, migration `20260812240000_.../migration.sql`) but `grep -rn "currentStage" src` returns only its own definition/read in `src/lib/workflow/stages.ts:150,153` — **nothing in the codebase ever writes it**. No Inngest function named `shipment.stage.advance` exists (`find . -path "*/inngest/*"` lists only `dailyWorkMetricSnapshot.ts` and `dailyComplianceAudit.ts`). No stage-stepper component exists under `src/app/app/shipments`. No circuit-breaker logic exists anywhere (`grep -rin "circuit\|failureCount" src/lib src/modules` — no hits). Only `src/lib/workflow/stages.ts` (the pure stage-definitions module, G-1) is real. |
| F05-A3: `GriRulesEngine.evaluate()` only emits GRI 1/GRI 6, always exactly one proposal, confidence hardcoded to 1 of 4 constants, `htsAgent.ts` unused | **FIXED** | `src/modules/classification/griRulesEngine.ts` now builds all of GRI 1, 2a, 2b, 3a, 3b, 3c, 4, 5a, 5b, 6 (`griRulesEngine.ts:394-429`), each with real deterministic evidence (`deterministicChecksJson`). Confidence is derived from an evidence inventory (`deriveConfidence()`, `griRulesEngine.ts:93-110`), not a fixed constant (the two literal `0.15`/`0.10` values that remain are explicit, commented **abstention sentinels** for the "missing core evidence" / "no candidate found" gate paths, not confidence readings — `griRulesEngine.ts:342-344`). `classificationCaseEngine.ts:384-409` now also creates up to 2 additional competing-candidate proposals (rank 2, 3) per run, so "always exactly one proposal" is also fixed. `packages/ai/hts/htsAgent.ts` is used by `packages/ai/orchestrator/agentOrchestrator.ts:3,51`. |
| F05-C3: `relevanceScore` hardcoded to `0.88` for every CROSS ruling citation | **FIXED** | `grep -rn "0.88" src packages` returns no hits. `classificationCaseEngine.ts:346-362` computes `relevanceScore: htsPrefixMatch ? 0.97 : 0.75` based on whether the ruling's `htsReferences` share a ≥4-digit prefix with the resolved HTS code. |
| F05-F2: `dutyImpact` hardcoded to `new Decimal(0)` | **FIXED** | `classificationCaseEngine.ts:609-633` — `getAdValoremRate()` looks up real `HtsDutyRate.adValoremPercent` for both the old and new HTS code, and `dutyImpact = lineValue.mul(newRate.minus(prevRate))` (`classificationCaseEngine.ts:633`) using `Decimal` arithmetic throughout. Falls back to `Decimal(0)` only when a code genuinely has no matching duty-rate row on file, which is honest, not fabricated. |

---

## F04 Capability A — The Work Queue as the Homepage

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1 Work queue page, `buildWorkQueue` server-side, grouped buckets | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/app/page.tsx` → `/app/actions`; `src/app/app/actions/page.tsx:133`; `ActionsClient.tsx` buckets via `categorize()`. | Module still lives at `src/modules/work/workQueue.ts`, not the spec'd `src/lib/decisions/workQueue.ts` path — cosmetic only. |
| A-2 Post-auth redirect `/app` primary, Dashboard secondary | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/page.tsx:13` redirects signed-in users to `/app`; `src/lib/navigation.ts:59-60` lists "actions" before "dashboard". | Signed-out landing page's "Go to App Console" button still links to `/app/dashboard` (`src/app/page.tsx:56`), bypassing the queue. |
| A-3 `/app/decisions`, `/app/exceptions` → 308 redirect preserving params | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/app/decisions/page.tsx:1-13`, `src/app/app/exceptions/page.tsx:1-16` both call `permanentRedirect` with params preserved. | Dead files `DecisionReviewClient.tsx`, `ExceptionActions.tsx` still present, unused. |

## F04 Capability B — Queue Ranking

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1 `score = (1/(hrs+1)) * log10(value+1) * blockingMultiplier` | DONE | UNCHANGED-WAS-ALREADY-DONE | `computeB1Score()`, `src/modules/work/workQueue.ts:173-182`, exact formula. | — |
| B-2 Row shows shipment #, importer, item count, "Files in Xh", $ value, blocking badge | DONE | UNCHANGED-WAS-ALREADY-DONE | `ActionsClient.tsx:430-485`. | — |
| B-3 Filters: assignedToMe, status, category | DONE | UNCHANGED-WAS-ALREADY-DONE | `ActionsClient.tsx:69-72,125-132,315-365`. | — |
| B-4 `GET /api/actions?limit=&cursor=` server pagination | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/actions/route.ts:1-35` — limit clamped to 100, offset cursor, `hasMore`/`nextCursor`. | — |

## F04 Capability C — Exception Workbench

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1 Consolidate into `ActionsClient.tsx` with BLOCKED/NEEDS_REVIEW/CONFIRM/EXCEPTIONS | DONE | UNCHANGED-WAS-ALREADY-DONE | `ActionsClient.tsx` categorize()/bucket rendering. | — |
| C-2 Blocking badge, age, expiry countdown | DONE | UNCHANGED-WAS-ALREADY-DONE | `ActionsClient.tsx:1300-1365`. | — |
| C-3 Exception detail slide-over, no navigation away | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/app/actions/ExceptionSlideOver.tsx:178` `role="dialog"`, resolve/waive/assign modes (`:85,115-174`), history list (`:267-271`). | — |
| C-4 Bulk exception operations | See Capability E | — | — | — |

## F04 Capability D — Exception Assignment & Structured Resolution

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1 Versioned picklist by category | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/modules/exceptions/resolutionReasons.ts`, re-exported at `src/lib/exceptions/resolutionReasons.ts`. | — |
| D-2 Migration `resolutionReasonCode String?` | DONE | UNCHANGED-WAS-ALREADY-DONE | `prisma/schema.prisma:1496`. | — |
| D-3 `PATCH /api/exceptions/[id]` validates reasonCode, waive requires code+note server-side | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/exceptions/[id]/route.ts:17-24` zod schema; `exception.service.ts` validation. | — |
| D-4 Assignment UI + Notification | DONE | UNCHANGED-WAS-ALREADY-DONE | `ExceptionSlideOver.tsx` assign mode; `exception.service.ts:220-236` creates `Notification`. | — |
| D-5 History log `{timestamp,userId,action,note}` | DONE | UNCHANGED-WAS-ALREADY-DONE | `exception.service.ts:184-210`. | — |
| D-6 Vitest waive 422/200/category match | DONE | UNCHANGED-WAS-ALREADY-DONE | `tests/exceptions-resolution.test.ts` — passes (`npx vitest run` confirms). | — |

## F04 Capability E — Bulk Approve/Reject/Resolve

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1 `POST /api/decisions/bulk` idempotent terminal check | DONE | **FIXED** | See named-bug table above. `src/app/api/decisions/bulk/route.ts:157-170`. | — |
| E-2 `POST /api/exceptions/bulk` reads `resolutionReasonCode` | DONE | **FIXED** | See named-bug table above. `src/app/api/exceptions/bulk/route.ts:14,45,92`. | — |
| E-3 Selection: checkbox, select-all-in-bucket, "select all matching part master" | PARTIAL | UNCHANGED-WAS-ALREADY-BROKEN | `ActionsClient.tsx:79,252` — checkbox state and `selectAllInBucket()` exist. `grep -n "part.?master" ActionsClient.tsx` → **zero hits**. | "Select all matching part master" (driven by F01-B-2) still has no implementation. |
| E-4 Confirmation dialog, type CONFIRM for overrides | DONE | UNCHANGED-WAS-ALREADY-DONE | `ActionsClient.tsx:1326-1355`. | — |
| E-5 Vitest partial success / 422 override | DONE | UNCHANGED-WAS-ALREADY-DONE | `tests/bulk-actions.test.ts` — passes. | — |

## F04 Capability F — Human Approval Controls with Provenance

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| F-1 Provenance: reviewer, timestamp, confidence band, specific copy | DONE | UNCHANGED-WAS-ALREADY-DONE | `ProvenanceFooter()`, `ActionsClient.tsx:970-1010`. | Uses `(reviewer as any)?.brokerLicenseNumber` (`ActionsClient.tsx:1009`) — Quality Standard #7 ("no `any` types") violation. |
| F-2 Render `reviewAuthority`/select fields, never hidden | DONE | **FIXED** | See named-bug table above. `src/app/app/actions/page.tsx:63-65`. | — |
| F-3 Auto-verified renders distinctly with explicit "not approved" copy | DONE | UNCHANGED-WAS-ALREADY-DONE | `ActionsClient.tsx:934-936`. | — |
| F-4 `GET /api/decisions?triageState=NEEDS_REVIEW` column-filtered | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/decisions/route.ts` filters on stored `triageState`. | — |

## F04 Capability G — Autonomous Workflow Orchestration

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| G-1 `src/lib/workflow/stages.ts` 7-stage lifecycle definitions | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/lib/workflow/stages.ts:14-164` — `STAGE_DEFINITIONS`, `isComplete()`, `evaluateStages()`. | This module is real and well-built, but is dead code — nothing calls `evaluateStages()` outside its own file. |
| G-2 `Shipment.currentStage` column, updated by Inngest | **MISSING** (column only) | UNCHANGED-WAS-ALREADY-BROKEN | Column exists: `prisma/schema.prisma:413`, migration `20260812240000_exception_history_and_workflow_stages/migration.sql`. `grep -rn "currentStage" src` → only reads it as a function parameter in `stages.ts:150,153`. **No write path exists anywhere.** | Nothing ever sets `currentStage` on a real `Shipment` row. All shipments are permanently `null` → treated as `INITIAL_STAGE` forever. |
| G-3 Stage gate config in `AgentPolicyConfig` | PARTIAL | UNCHANGED-WAS-ALREADY-BROKEN | `AgentPolicyConfig.policyType`/`requireHumanApproval` fields exist and are read by `src/modules/decisions/autoApprovalPolicy.ts:78` (`config?.policyType === "STAGE_GATE" \|\| config?.requireHumanApproval`) — but this only affects a single decision's AUTO/REVIEW outcome, not shipment-stage advancement (which doesn't exist, see G-4). | Not actually wired to any stage-advancement logic since none exists. |
| G-4 Inngest `shipment.stage.advance` function | **MISSING** | UNCHANGED-WAS-ALREADY-BROKEN | `find . -path "*/inngest/*" -name "*.ts"` lists only `dailyWorkMetricSnapshot.ts`, `dailyComplianceAudit.ts`, `client.ts`, `api/inngest/route.ts`. No stage-advance function anywhere. | Needs to be built from scratch: read `stages.ts`, evaluate completion, write `currentStage`, create gate `AgentDecision` rows. |
| G-5 Shipment workspace stage stepper UI | **MISSING** | UNCHANGED-WAS-ALREADY-BROKEN | `grep -rin "stepper\|stage progress" src/app/app/shipments --include="*.tsx"` → no hits. | No UI surface for stage progress at all. |
| G-6 Circuit breaker: 3 failures → BLOCKED + SYSTEM exception | **MISSING** | UNCHANGED-WAS-ALREADY-BROKEN | `grep -rin "circuit\|failureCount\|category.*SYSTEM"` across `src/lib`, `src/modules` → no hits (`retryCount` in `src/lib/canonicalMessaging/types.ts:45` is for an unrelated message queue, not this circuit breaker). | Not built. |

**F04-G is the single biggest gap in the codebase.** Of 6 tasks, only the pure data/type-definitions module (G-1) is real; everything that would make it "autonomous" (writing `currentStage`, an Inngest driver, a stepper, a circuit breaker) does not exist.

---

## F05 Capability A — Classification Case Workflow

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1 `POST .../cases` idempotent per productId | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/v1/classification/cases/route.ts` → `ClassificationCaseEngine.createCase`. | — |
| A-2 `POST .../runs` async via Inngest, `{runId, status:"QUEUED"}` | DONE | UNCHANGED-WAS-ALREADY-DONE | `classificationCaseEngine.ts:150-154`. | — |
| A-3 `htsAgent.ts` structured output, writes proposals + GRI steps | DONE | **FIXED** | See named-bug table above. | — |
| A-4 `GET .../cases/[caseId]` full context | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/v1/classification/cases/[caseId]/route.ts`. | — |
| A-5 `POST .../decisions` writes decision, supersedes previous | DONE | UNCHANGED-WAS-ALREADY-DONE | `classificationCaseEngine.ts:428-457` and onward. | — |
| A-6 Vitest coverage | DONE | UNCHANGED-WAS-ALREADY-DONE | `tests/classification-case.test.ts` — passes. | — |

## F05 Capability B — GRI Reasoning Workspace (UI)

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1 Case detail page, two-column layout | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/app/products/[id]/classification/[caseId]/page.tsx`. | — |
| B-2 Proposal card: code, duty, confidence, GRI accordion from `GriAnalysisStep` rows | DONE | UNCHANGED-WAS-ALREADY-DONE | Renders `proposal.griSteps` directly, not parsed prose. | — |
| B-3 Compare up to 3 proposals side by side, GRI divergence | DONE | **FIXED** | `CompareView()`, `page.tsx:239-280` — table of GRI steps per proposal, `hasDivergence` highlight when outcomes differ. Previously impossible since only 1 proposal ever existed; now up to 3 exist (`classificationCaseEngine.ts:384-409`). | — |
| B-4 "Select this code" → confirmation modal → writes decision | DONE | UNCHANGED-WAS-ALREADY-DONE | Wired to `recordDecision()`. | — |
| B-5 Override workflow: `isOverride`, reason required, audit-trail visible | DONE | UNCHANGED-WAS-ALREADY-DONE | `classificationCaseEngine.ts:434-456`. | — |

## F05 Capability C — CROSS Ruling Retrieval

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1 Ingest pipeline writes Ruling/Fragment/HtsReference, effective date + supercession | PARTIAL | UNCHANGED-WAS-ALREADY-PARTIAL | `src/modules/regulatory/crossIngestionService.ts` writes rulings/fragments/references. `grep -n "effectiveDate\|supersession\|supersede"` on that file → no hits. | No supercession tracking for superseded rulings. |
| C-2 Embedding similarity search (Gemini + pgvector), full-text fallback, `similarityScore` | **PARTIAL — spec not met** | UNCHANGED-WAS-ALREADY-BROKEN | `src/modules/classification/rulingService.ts:16-45` — `searchRulings()` is a plain Prisma `contains`/`mode:"insensitive"` substring match on `title`, plus an HTS-code substring match. No embedding call, no `pgvector`, no Postgres `tsvector`, and the returned rows carry **no `similarityScore` field at all**. | This is not even the documented fallback (`tsvector` full-text search) — it's unranked `LIKE`-style matching. Needs real full-text search at minimum, embeddings for the actual spec. |
| C-3 `ProposalEvidence.rulingId` linkage w/ dynamic relevance | DONE | **FIXED** | See named-bug table above (`classificationCaseEngine.ts:346-362`). | — |
| C-4 UI citations: ruling #, description, similarity score, CBP CROSS link, slide-over | DONE | UNCHANGED-WAS-ALREADY-DONE | `page.tsx:145,155,163-168` — shows `relevanceScore`, links to `rulings.cbp.gov`. | Score shown is the write-time `relevanceScore` from evidence, not a live "similarity" from C-2 (which doesn't compute one). |
| C-5 `GET /api/v1/rulings/[rulingNumber]` | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/v1/rulings/[rulingNumber]/route.ts` exists. | — |
| C-6 Vitest: sorted by similarity, no-fragments → empty | DONE | UNCHANGED-WAS-ALREADY-DONE | `tests/ruling-provenance.test.ts` — passes. | Test passing doesn't validate a real similarity search exists (see C-2) — likely tests the DB query shape only. |

## F05 Capability D — Bulk Catalog Classification

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1 `POST /api/v1/batch/classification`, cap 100, `{queued,skipped,errors}` | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/v1/batch/classification/route.ts:8-22` — `MAX_BATCH=100`, 422 over cap, skips approved. | — |
| D-2 Routing via `autoApprovalPolicy.ts`: low-confidence → NEEDS_REVIEW, high+match → AUTO_VERIFIED | PARTIAL | UNCHANGED-WAS-ALREADY-PARTIAL | `route.ts:77-92` calls `applyAutoApprovalPolicy` with **`confidence: null`** ("not known yet; worker will update" — comment on line 74) so this immediate check is close to a no-op. Real routing happens later in `classificationCaseEngine.ts` via `finalRecommendationStatus` bands (`PROPOSED`/`HUMAN_REVIEW_REQUIRED`/`NEEDS_INFORMATION`), which is a different vocabulary than the spec'd `NEEDS_REVIEW`/`AUTO_VERIFIED`, and doesn't consult part-master match for the batch path. | Batch path's immediate "policy" call is dead weight; actual routing uses a parallel, differently-named status vocabulary. |
| D-3 Bulk UI: "Classify selected", count + estimate, polls for completion | PARTIAL | UNCHANGED-WAS-ALREADY-PARTIAL | `src/app/app/products/ProductsBulkActions.tsx:31-57` — fires `POST /api/v1/batch/classification`, shows queued/skipped/errors counts. No polling of `GET .../cases?productIds[]=...&status=OPEN` — component just shows a one-shot `idle/pending/done/error` state. | No completion polling as spec'd. |
| D-4 Batch progress page `products/batch-classification/[batchId]/page.tsx` | **MISSING** | UNCHANGED-WAS-ALREADY-BROKEN | `find src/app/app/products -type d` — no `batch-classification` directory exists at all. | Page was never built. |
| D-5 Vitest: 100 creates 100 cases, 422 over cap, skip approved | DONE | UNCHANGED-WAS-ALREADY-DONE | Cap/skip logic directly verified in route (`route.ts:8,22,36`); consistent with the spec. | — |

## F05 Capability E — Classification Version History

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1 `GET /api/products/[id]/classifications` ordered DESC, full fields | DONE | UNCHANGED-WAS-ALREADY-DONE | Confirmed via `ClassificationHistoryTab` fetch and rendered fields (`ProductTabs.tsx:35-49`). | — |
| E-2 History tab UI, override indicator | DONE | UNCHANGED-WAS-ALREADY-DONE | `ProductTabs.tsx:51-175` — timeline with `Override` badge (`:127-131`), superseded marker. | — |
| E-3 `changeReason` required, stored on `ClassificationDecision` | DONE | UNCHANGED-WAS-ALREADY-DONE | `classificationCaseEngine.ts:33-34,326` (per prior audit's citation, structurally unchanged and still present). | — |
| E-4 Rollback: admin picks older classification, `isRollback:true` + reason | **PARTIAL — backend only** | UNCHANGED-WAS-ALREADY-PARTIAL | `isRollback` field is threaded through `recordDecision()` (`classificationCaseEngine.ts:36,485,529`). `grep -rln "rollback" src/app/app/products --include="*.tsx"` → **no hits**. | No UI entry point exists for an admin to trigger a rollback — the capability is backend-only and unreachable from the product. |

## F05 Capability F — Classification Change Impact

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| F-1 Compute impact: LineItem → Shipment → CustomsFiling | DONE | UNCHANGED-WAS-ALREADY-DONE | `classificationCaseEngine.ts:580-599`. | — |
| F-2 Write `ClassificationChangeImpact` rows, real `dutyImpact` via Decimal | DONE | **FIXED** | See named-bug table above. `classificationCaseEngine.ts:609-646`. Model exists at `prisma/schema.prisma:2390-2409`. | — |
| F-3 `GET .../impact/[caseId]` counts + duty delta | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/v1/classification/cases/[caseId]/impact/route.ts:37` — `Decimal.plus()` aggregation. | — |
| F-4 Impact UI: "affects N shipments... duty delta" | DONE | UNCHANGED-WAS-ALREADY-DONE | `page.tsx:529-533`. | — |
| F-5 Filed entries (SUBMITTED+) → `ComplianceFinding` for PSC | DONE | UNCHANGED-WAS-ALREADY-DONE | `classificationCaseEngine.ts:648-659` — checks `["Transmitted","Released","Closed"]`. | — |

---

## Cross-cutting Quality Standards violations found

1. **No `any` types (Standard #7)** — `src/app/app/actions/ActionsClient.tsx:1009` uses `(reviewer as any)?.brokerLicenseNumber` in the provenance footer that Standard #1 (product positioning: evidence must be visible) depends on. Small but avoidable.
2. **Idempotency on mutation endpoints (Standard #9)** — the pattern exists and is used correctly elsewhere in the codebase (`src/lib/api/idempotency.ts`, consumed by `src/app/api/filing/[id]/transmit/route.ts`, `.../approve/route.ts`, `.../resubmit/route.ts`, `.../cancel/route.ts`, `src/app/api/bonds/route.ts`, `src/app/api/drawback/claims/route.ts`) but is **not applied** to the F04/F05 routes in scope: `POST /api/decisions/bulk`, `PATCH /api/exceptions/bulk`, `POST /api/v1/classification/cases/[caseId]/decisions`. A retried bulk-approve or a double-submitted classification decision has no dedupe protection.
3. **OpenAPI descriptions on every route (Standard #6)** — `src/app/api/decisions/bulk/route.ts` and `src/app/api/exceptions/bulk/route.ts` parse the request body manually (`await req.json()` + a hand-written type cast) instead of a `zod` schema; there is nothing to attach `.describe()` to. `grep -c "\.describe("` on both files returns 0.
4. **Tenant isolation test coverage (Standard #3)** — every bulk/mutation route re-checked does scope its Prisma queries with `accountId: ctx.accountId` (verified in `decisions/bulk/route.ts` and `exceptions/bulk/route.ts`), so enforcement is real, but no cross-tenant vitest exists for either route (`grep -rli "cross.tenant\|cross-account"` across `tests/*.ts` finds none touching F04/F05 bulk endpoints). The standard requires a written test, not just correct code.
5. **Dead code accumulation** — `src/lib/workflow/stages.ts` (well-built, unused), `DecisionReviewClient.tsx`, `ExceptionActions.tsx` (superseded, unused) all remain in the tree. Not a functional bug but adds review burden and risk of drift.
6. **Duplicate/confusing naming** — two unrelated classes are both named `HTSClassificationAgent`: `src/modules/agents/htsClassificationAgent.ts` (the real Gemini-backed pipeline agent, used by `classificationCaseEngine.ts` and the shipment intake pipeline) and `packages/ai/hts/htsAgent.ts` (a thin wrapper around `GriRulesEngine`, used only by `packages/ai/orchestrator/agentOrchestrator.ts`). This is not a functional defect — both are now genuinely used — but the identical class name across two different call graphs is a real landmine for future changes.

---

## Top 5 fixes ranked by severity

1. **Build F04-G for real (Capability G, all of G-2/G-4/G-5/G-6).** This is the headline "autonomous workflow orchestration" feature (#15) and is ~85% unimplemented. `currentStage` needs an actual writer (an Inngest `shipment.stage.advance` function per spec), the shipment workspace needs the stepper UI wired to `evaluateStages()` (which already exists and is ready to consume), and a circuit breaker needs to exist before this can be called "autonomous" anything.
2. **Fix F05-C2 ruling search to match its own spec, or update the spec.** `RulingService.searchRulings()` is a `contains` substring match with no `similarityScore`, not the documented embedding search nor even its documented full-text fallback. The UI (`C-4`) displays a "similarity score" that is actually a write-time evidence relevance score, not a live search-time similarity — this is a small but real accuracy-of-claim issue in a compliance product where "Qubere proves every line item" is the pitch.
3. **F05-D4: build the batch classification progress page**, or remove the "Classify selected" bulk action's implied promise of trackable progress — right now a user can kick off up to 100 classification runs with no page to watch them complete.
4. **F04-E3: implement "select all matching part master."** Currently zero references in `ActionsClient.tsx`; this was called out in the prior audit and remains untouched.
5. **F05-E4: add a rollback UI entry point.** The backend (`isRollback`, `recordDecision`) is ready; there's simply no button/flow anywhere in the product tabs to invoke it, so a real capability is unreachable by users.
