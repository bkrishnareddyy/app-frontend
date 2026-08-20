# F15 · Evals & AI Quality Intelligence

> Depends on: `AgentDecision` / `AgentExecutionRecord` / `AgentPolicyConfig` / `ExceptionItem` / `PostSummaryCorrection` (`prisma/schema.prisma`), platform-admin console + `isPlatformAdmin` gate (`src/app/platform-admin/PlatformAdminConsole.tsx`, `src/lib/auth.ts:309`, `src/app/platform-admin/page.tsx:14`), permission system (`src/lib/permissions.ts`, `src/modules/admin/permissionSync.ts`), Inngest (`src/lib/inngest/client.ts`, `src/app/api/inngest/route.ts`), route auth guard (`src/lib/api/auth-guards.ts` — `withAuthenticatedRoute`), `AgentsAnalyticsPanel.tsx`.
> Branch: `feat/evals-phase-0` (Phase 0), then `feat/evals-foundation` (Phase 1)
> Source requirement doc: [docs/requirements/evals-ai-quality-intelligence.md](../../requirements/evals-ai-quality-intelligence.md) — `§N` references below point at that file's numbered sections.
> Do not reread the whole agent pipeline from scratch before starting — this plan and its source PRD already cite every file you need. Spend the first pass verifying the cited evidence is still accurate (things move), not re-discovering it.

---

## 0. Starting context — what already exists

Do **not** build a parallel structured-output or trace system. It already exists:

- `AgentDecision` (`prisma/schema.prisma:797`) — `confidence`, `evidenceItems` (Json array), `rulesApplied` (String[]), `dataSources`, `regulations`, `modelVersion`, `promptVersion`, `triageState`, `autoApprovalPolicy`, `autoApproved`, `humanNotes`, `reviewedByUserId`, `lineNumber`, `documentId`. This is "actual output" for every deterministic evaluator in Phase 1.
- `AgentExecutionRecord` (`prisma/schema.prisma:1834`) — `inputSnapshot`/`outputSnapshot` (Json), `confidence` (Json, already multi-dimensional — do not flatten it), `runId`, `stepNumber`, `durationMs`, `modelVersion`, `status`. This is the trace source for the Case-detail Trace tab (§16 of the PRD).
- `AgentPolicyConfig` (`prisma/schema.prisma:870`) — per-account/agent `autoThreshold`/`confirmThreshold`/`requireHumanApproval`. Read this, don't reimplement autonomy thresholds inside the eval scorer.
- `ExceptionItem` (`prisma/schema.prisma:1747`) — `category`, `severity`, `blocking`, `resolutionReasonCode`. Needed for the "required exceptions resolved" check in the Filing Readiness evaluator.
- `PostSummaryCorrection` (`prisma/schema.prisma:1168`) — real broker-correction data, but **post-filing only**. Do not present this as full broker-intervention coverage in any UI copy; it's a partial signal until Phase 2 wires pre-filing capture (PRD §13).
- `hashPromptVersion()` (`src/lib/ai/promptVersion.ts`) — already stamps `AgentDecision.promptVersion`. Reuse directly for `eval_runs.promptVersion`.
- Auth pattern: every platform-admin route in this codebase follows `withAuthenticatedRoute(async ({ ctx, ... }) => { if (!ctx.isPlatformAdmin) return 403 ... })` — see `src/app/api/platform-admin/datasets/route.ts:1-13` for the exact shape. Copy it verbatim for every `/api/evals/*` route; do not write a new auth check.
- Inngest: async jobs live in `src/lib/inngest/functions/*.ts` and are registered by import in `src/app/api/inngest/route.ts:3-11`. Follow `dailyComplianceAudit.ts`'s pattern (`runWithAccountId` wrapper per account) for the eval-run job.

### Naming collision to avoid

`src/app/api/platform-admin/datasets/**` and `src/lib/data/datasetRegistry.ts` **already exist** — they manage reference datasets (HTS tables, OFAC SDN lists, etc.), surfaced under the existing "Data" tab. This is a different concept from "golden eval datasets." Do not add routes under `/api/platform-admin/datasets/*` or reuse `datasetRegistry.ts` for eval data — use `/api/evals/datasets/*` and a new `eval_datasets` table, and label the Evals UI tab clearly (e.g. "Golden Datasets") so nobody confuses the two in the nav.

---

## Phase 0 — Prove the loop (no schema, no UI, do this first)

Goal per PRD §26: one real accuracy number and one real diff, reviewed manually, before anyone writes a UI. Time-box this to a few days — if it takes longer, that's itself a finding (the pipeline's "actual output" is harder to extract than assumed).

### Capability A — Seed a minimal golden set

- **Task A-1**: Pick 15-20 existing shipments already in a demo/test account with human-reviewed, correct HTS codes (check `tests/hts-cross-citation-verification.test.ts` and `tests/product-intelligence-master.test.ts` for shipments already used as known-good fixtures — reuse those before creating new ones). Write their `shipmentId` + expected `htsCode` (10-digit) as a flat JSON file, e.g. `scripts/evals/phase0-golden-set.json`: `[{ shipmentId, lineNumber, expectedHtsCode, category }]`. `category` from PRD §8 (Normal / Difficult Classification / Adversarial) — cover at least those three.
- **Task A-2**: For each case, confirm a real `AgentDecision` row exists with `agentName` matching the HTS Classification agent and `lineNumber` matching. If it doesn't (shipment never ran classification), either run it through the real pipeline first or drop that case — do not fabricate a decision row.

### Capability B — One evaluator, as a pure function

- **Task B-1**: Create `src/modules/evals/hierarchicalHtsMatch.ts`, exporting a pure function `scoreHtsMatch(expected: string, actual: string | null): { level: "10" | "8" | "6" | "4" | "heading" | "none"; score: number }`. No DB access in this function — matches the pure/DB-split pattern the billing plan (F14) already established for `ratingEngine.ts`/`costingEngine.ts` (`computeChargeAmount` vs. `evaluateAndRateUsageEvent`). Scoring: exact 10-digit = 1.0, 8-digit = 0.8, 6-digit = 0.5, 4-digit (heading) = 0.2, no match = 0.
- **Task B-2**: Vitest `tests/evals-hts-match.test.ts` covering all five levels plus `actual: null` (agent never produced a decision).

### Capability C — Minimal runner

- **Task C-1**: A one-off script `scripts/evals/run-phase0.ts` (run via `tsx`, not a route, not an Inngest job — this is deliberately throwaway): reads `phase0-golden-set.json`, for each case queries the matching `AgentDecision.proposedHtsCode`, calls `scoreHtsMatch`, prints a table: `shipmentId | expected | actual | level | score` plus an aggregate accuracy number.
- **Task C-2**: Run it against current production-shape data (demo account) and record the actual output in the PR description — this number is the deliverable of Phase 0, not the code.

### Exit criterion

- **Task D-1**: Review the output with product/eng: does the diff table make failures legible? Is extracting "actual" from `AgentDecision` straightforward, or did Task A-2 surface friction worth fixing before Phase 1 schema work? Get an explicit go/no-go before starting Phase 1 — don't let Phase 1 start by default momentum.

---

## Phase 1 — Foundation

Do not start Phase 1 schema work until Phase 0's exit criterion (above) is met.

### Capability A — Schema

- **Task A-1**: Add to `prisma/schema.prisma` (new section, near `AgentDecision`/`AgentExecutionRecord` for locality):
  - `EvalDataset` (`id`, `name`, `description`, `ownerAccountId String?` — null for system-owned per PRD §21, `status`, `createdAt`, `updatedAt`)
  - `EvalDatasetVersion` (`id`, `datasetId`, `version Int`, `createdAt`) — cases below reference a version, not a dataset directly, so a dataset can evolve without invalidating old run comparisons
  - `EvalCase` (`id`, `datasetVersionId`, `caseKey String` — stable across versions for diffing, `category`, `difficulty`, `shipmentId String?` — set when the case is a real (anonymized) production shipment, `status`, `reviewerId String?`, `reviewStatus`, `createdAt`, `updatedAt`)
  - `EvalExpectedOutput` (`id`, `caseId`, `field String` — e.g. `"hts"`, `"originCountry"`, `expectedValue Json`, `evaluatorType String`)
  - `EvalRun` (`id`, `datasetVersionId`, `gitCommit String?`, `modelVersion String?`, `promptVersion String?` — from `hashPromptVersion()`, `startedAt`, `completedAt`, `casesTotal Int`, `casesPassed Int`, `casesFailed Int`, `criticalFailures Int`, `overallScore Float?`, `status`)
  - `EvalResult` (`id`, `runId`, `caseId`, `field`, `expectedValue Json`, `actualValue Json`, `evaluatorType`, `score Float`, `severity` — Critical/Major/Minor per PRD §10, `passed Boolean`, `agentDecisionId String?` — FK-by-id to the real `AgentDecision`, not a copy of it (PRD §21 reuse principle), `agentExecutionRecordId String?`)
  - All models get `@@index([datasetVersionId])`/`@@index([runId])`/`@@index([caseId])` as appropriate, matching the indexing convention already used throughout the schema.
  - **Explicitly deferred to Phase 2, do not build now**: `eval_failures` (dedicated triage table — Phase 1 gets by with `EvalResult.passed = false` + `severity` filters on the Cases UI), `eval_feedback`, `eval_reviews` (human-review workflow beyond simple case authoring), `eval_evaluators`/`eval_evaluator_results` as separate tables (Phase 1's evaluator registry is a code-level `Record<string, EvaluatorFn>` in `src/modules/evals/registry.ts`, not DB rows — don't build configuration-driven evaluator registration until Phase 3 CI integration actually needs it).
- **Task A-2**: Migration via `prisma migrate dev`, named `add_eval_foundation_models`.

### Capability B — Evaluator registry

- **Task B-1**: `src/modules/evals/registry.ts` — extend Phase 0's `scoreHtsMatch` pattern to the full PRD §9 deterministic set: exact match, hierarchical match (HTS), numeric tolerance (quantity/value/currency), required-field, cross-document. Each evaluator is a pure function `(expected, actual, context?) => { score, passed, severity }`. Register in a `Record<string /* evaluatorType */, EvaluatorFn>`.
- **Task B-2**: `src/modules/evals/severityClassifier.ts` — maps a failing field + evaluator type to Critical/Major/Minor per the PRD §10 examples table (hardcode the table as a lookup, don't infer severity heuristically).
- **Task B-3**: Vitest per evaluator, mirroring Task B-2 from Phase 0.

### Capability C — Runner (Inngest)

- **Task C-1**: `src/lib/inngest/functions/evalRun.ts` — `evalRunJob`, triggered by an event `evals/run.requested` with `{ runId }`. For each `EvalCase` in the run's dataset version: look up the real `AgentDecision`/`AgentExecutionRecord` for that case's `shipmentId` (reuse the pipeline's existing query patterns, e.g. how `src/app/api/decisions/route.ts` queries `AgentDecision`), run the matching evaluator from the registry per `EvalExpectedOutput.evaluatorType`, write `EvalResult` rows, then update `EvalRun` aggregate fields (`casesPassed`, `overallScore`, etc. — weighted per PRD §11's critical-error weighting, with the LLM-judge weight cap noted there even though no judge exists yet in Phase 1 — build the weighting function to accept it later, don't hardcode "no judge dimension exists").
- **Task C-2**: Register in `src/app/api/inngest/route.ts` next to the existing five functions.
- **Task C-3**: `POST /api/evals/runs` (`src/app/api/evals/runs/route.ts`) — `withAuthenticatedRoute`, `isPlatformAdmin` + `evals.run.execute` permission check (Capability J), creates the `EvalRun` row (`status: "PENDING"`) and fires the `evals/run.requested` event. Returns the run id immediately — do not run synchronously in the route handler (PRD §24, "must not impact production latency" applies to admin-triggered runs too, since they read the same tables production reads).

### Capability D — Admin nav + Evals tab shell

- **Task D-1**: In `PlatformAdminConsole.tsx`, add `"evals"` to the `activeTab` union (line ~39) and a tab button next to `"memory"` (after line 202), gated: only render the tab button when `ctx.isPlatformAdmin && hasPermission("evals.view")` (mirror however `"cron"` or another conditionally-shown tab is gated today — check for a precedent before assuming none exists).
- **Task D-2**: `src/app/platform-admin/EvalsPanel.tsx` — top-level component with its own sub-nav (Overview / Runs / Datasets / Cases / Agents / Configuration — **not** Failures, deferred to Phase 2 per Capability A).

### Capability E — Overview page

- **Task E-1**: `EvalsOverview.tsx` — KPI cards (Overall Score, Filing Readiness, Autonomous Completion proxy per PRD §12, Critical Error Rate, Cases Evaluated) computed from the most recent completed `EvalRun`. Render "No runs yet" honestly (per this repo's own "no fake data, ever" standard, `docs/plans/project-plan.md` Quality Standard 1) rather than a placeholder score — this matters more here than almost anywhere else in the app, since a fabricated eval score is exactly the kind of vanity-metric failure PRD §29 warns about.
- **Task E-2**: Agent performance table — extend `AgentsAnalyticsPanel.tsx`'s existing confidence-percentile rendering with a second data source (pass/fail rate from `EvalResult` grouped by agent) rather than building a second, separate agent table component.
- **Task E-3**: Recent runs list + top failure modes (grouped by `EvalResult.field` + `severity` where `passed = false` — this is the Phase-1 substitute for the deferred `eval_failures` table).

### Capability F — Datasets UI

- **Task F-1**: `GET/POST /api/evals/datasets` (list/create), `GET /api/evals/datasets/:id` — `withAuthenticatedRoute` + `evals.view`/`evals.dataset.manage`.
- **Task F-2**: `EvalDatasetsPanel.tsx` — table (Name, Cases count, Version, Last Run, Score, Status, Owner), create/duplicate/archive actions. Import/export deferred unless Phase 1 timeline allows — flag as stretch, not core acceptance criteria (PRD §27 doesn't require it explicitly).

### Capability G — Cases UI + Diff view

- **Task G-1**: `GET/POST /api/evals/cases`, `GET /api/evals/cases/:id`.
- **Task G-2**: `EvalCasesPanel.tsx` — list view (Case ID, Category, Difficulty, Latest Result, Score, Status).
- **Task G-3**: `EvalCaseDetail.tsx` — tabs: Overview, Expected, Actual, **Diff** (build this one first if the phase runs short on time — PRD §18 calls it "the single highest-value screen"), Trace (reads `AgentExecutionRecord.inputSnapshot`/`outputSnapshot` for the case's decisions, rendered as the step list from PRD §16), History. Documents tab and full Evaluation-config tab can follow Diff/Trace if time-boxed.

### Capability H — Agent Performance detail

- **Task H-1**: `GET /api/evals/agents/:agentId` — accuracy, critical error rate, pass rate, worst/best cases, trend, sourced from `EvalResult` joined to `AgentDecision.agentName`.
- **Task H-2**: Detail view added as a drill-down from Capability E's agent table, not a separate nav item — avoids duplicating the existing Agents tab's IA.

### Capability I — Run history + comparison

- **Task I-1**: `EvalRunsPanel.tsx` — run list with score/status.
- **Task I-2**: Two-run comparison view: select two `EvalRun`s, render the per-field delta table from PRD §14, flag regressions (configurable threshold, default any negative delta on a Critical-severity field).

### Capability J — Permissions

- **Task J-1**: Add `evals.view`, `evals.dataset.manage`, `evals.run.execute`, `evals.review.approve` to the permission catalogue in `src/lib/permissions.ts`, following the exact pattern billing used for `billing.*` (F14 plan, Capability list in that doc's §17-ish permissions line) — same file, same sync mechanism (`src/modules/admin/permissionSync.ts`). Do not build a parallel permission table.
- **Task J-2**: Wire these into every `/api/evals/*` route and into Capability D's tab visibility.

### Explicit non-scope for Phase 1 (do not build, do not partially build)

- LLM judge (PRD §9/§11) — no judge-scored dimension exists yet; the weighting function should accept one later (Capability C-1) but nothing calls an LLM for scoring in Phase 1.
- Failure triage workflow (assign owner, status transitions, root-cause taxonomy UI) — PRD §17, deferred to Phase 2. Phase 1's "top failure modes" (Capability E-3) is a read-only grouping, not a workflow.
- Pre-filing broker-correction capture — PRD §13 gap. `PostSummaryCorrection` stays the only broker signal in Phase 1; do not build new correction-capture UI yet.
- Confidence calibration UI (PRD §19) — needs enough run volume to be meaningful; revisit after a few real Phase 1 runs exist.
- CI/release-gate integration (PRD §15, §17) — thresholds have no baseline yet; nothing should block a deploy in Phase 1.

### Validation — Phase 1

- **Task V-1**: Vitest for every evaluator (Capability B), the weighting/aggregation function (Capability C-1), and a cross-tenant test confirming `EvalCase`/`EvalRun` queries are `accountId`-scoped where applicable (system-owned datasets excepted, per PRD §21) — matching this repo's mandatory tenant-isolation test standard.
- **Task V-2**: Integration test: `POST /api/evals/runs` on a small seeded dataset actually produces `EvalResult` rows with correct `passed`/`severity`, and a second run against unchanged data reproduces the same score (determinism check for the deterministic evaluators).
- **Task V-3**: Manual QA: run Phase 0's 15-20 case set through the real Phase 1 UI end to end — Overview shows a real (non-placeholder) score, Cases → Diff shows the same failures Phase 0's script found by hand.

---

## Phase 2+ (Intelligence, CI Integration, Continuous Learning)

Not planned at task level here — scope per PRD §26 Phases 2-4 once Phase 1 has shipped and produced enough real runs to know which of those items is actually the next bottleneck. Re-derive the task breakdown from real Phase 1 findings rather than pre-planning it now; PRD §15's "thresholds TBD" principle applies to planning effort here too — don't commit to Phase 2 task detail before Phase 1 data exists to justify it.
