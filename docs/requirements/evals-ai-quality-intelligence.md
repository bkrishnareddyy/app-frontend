# PRD: Qubere Evals & AI Quality Intelligence

**Product:** Qubere
**Feature:** Evals & AI Quality Intelligence
**Status:** Proposed (rev 2)
**Owner:** Product / Engineering
**Priority:** High
**Target:** Internal Admin / Engineering / Product users initially

> Rev 2 changes: added §0 (what already exists — this is not a greenfield build), added a build-vs-reuse data model pass (§21), collapsed duplicate mockups, reconciled two conflicting definitions of the north-star metric into one (§12), removed asserted numeric thresholds that had no baseline behind them (§15), and split the old single "MVP" into a real Phase 0 (prove the loop) ahead of Phase 1 (build the surface). See the companion implementation plan: [F15 · Evals & AI Quality Intelligence](../plans/features/F15-evals-ai-quality-intelligence.md).

---

## 0. What already exists in Qubere today

This is not a greenfield build. Qubere's agent pipeline already produces most of the structured data an eval system needs — it has just never been read by anything eval-shaped. Any implementation of this PRD must build **on** these, not duplicate them:

| Need (per this PRD) | Already exists as |
|---|---|
| Structured agent decision output (§4 "Input/Decision/Confidence/Evidence/Rules/Output") | `AgentDecision` — `confidence`, `evidenceItems` (Json), `rulesApplied`, `dataSources`, `regulations`, `modelVersion`, `promptVersion`, `triageState`, `autoApprovalPolicy`, `autoApproved`, `humanNotes`, `reviewedByUserId` (`prisma/schema.prisma:797`) |
| Evaluation trace / "what did the agent see and produce" (old §22) | `AgentExecutionRecord` — `inputSnapshot`, `outputSnapshot` (Json), `confidence` (Json, already multi-dimensional), `runId`, `stepNumber`, `durationMs`, `modelVersion`, `status` (`prisma/schema.prisma:1834`) |
| Autonomous-completion threshold mechanism | `AgentPolicyConfig` — per-account, per-agent `autoThreshold` / `confirmThreshold` / `requireHumanApproval` (`prisma/schema.prisma:870`) |
| "Required exceptions resolved" check | `ExceptionItem` — `category`, `severity`, `blocking`, `resolutionReasonCode`, `history` (`prisma/schema.prisma:1747`) |
| Broker-correction signal (old §16/§17) | `PostSummaryCorrection` — `correctionType`, `correctedHtsCode` / `correctedValue` / `correctedQuantity` vs. original, `reason`, `legalBasis`, `lineItemsAffected` (`prisma/schema.prisma:1168`). This is real production broker-correction data sitting unused for evals today — it's a post-filing correction, not a pre-filing rejection, so it's a partial (not complete) source for the broker-intervention metric; see §12. |
| Prompt-version tracking (old §38) | `hashPromptVersion()` in `src/lib/ai/promptVersion.ts`, already stamped onto every `AgentDecision.promptVersion` |
| Admin surface to hang a new tab on | `src/app/platform-admin/PlatformAdminConsole.tsx` — current tabs are `accounts \| data \| rate-review \| hts \| deployments \| agents \| api \| cron \| memory`, **not** the `API \| Account Memory` pair the original draft of this PRD assumed. There is already an **Agents** tab (`AgentsAnalyticsPanel.tsx`) rendering per-agent confidence P50/P90/P99 and run counts — direct functional overlap with §9 (agent performance) and §19 (confidence calibration) below. |
| Access control for an admin-only surface | `context.isPlatformAdmin`, computed in `src/lib/auth.ts:309` from `PlatformRole`/`PlatformUserRole`, checked in `src/app/platform-admin/page.tsx:14`. Gate the Evals tab the same way — do not invent a parallel admin-access check. |
| Fine-grained permissions within the tab | `src/lib/permissions.ts` + `Permission`/`Role`/`RolePermission` tables + `src/modules/admin/permissionSync.ts`. Add `evals.view`, `evals.dataset.manage`, `evals.run.execute`, `evals.review.approve` here, the same way billing added `billing.*` permissions — do not build a second permission bundle system. |

**Open questions this revision does not resolve** (flag these back to product/eng before Phase 0 starts):

1. Who authors and reviews the first golden cases — in-house customs SMEs, contracted brokers, or the existing broker partner? What's their available time budget?
2. Is "Evals Service" (old §49 architecture diagram) a literally separate service, or new Prisma models + Next.js routes inside this app? Given the rest of Qubere lives in one Next.js app with Inngest for async work, default should be the latter unless someone argues otherwise.
3. Does the team accept that Phase 0 (below) ships with zero UI, to get one real baseline number before investing in the dataset/case/run UI surface?

---

## 1. Executive Summary

Qubere is building an autonomous customs-compliance and filing platform where AI agents make decisions with financial, regulatory, and operational consequences. As the agentic pipeline gets more capable, we need a systematic way to answer:

- Is the AI getting better or worse?
- Which agents are failing, and on what kinds of shipments?
- Are prompt/model/retrieval/logic changes actually improving outcomes?
- How often does Qubere require broker intervention, and why?
- Can we safely deploy a new version of an agent?

The **Evals system** is a centralized framework for creating, running, scoring, analyzing, and continuously improving Qubere's AI workflows — built on top of the decision/execution/correction data the pipeline already emits (§0), not a system that has to first invent that data.

---

## 2. Business Objective

Make Qubere's autonomous customs workflow **measurably reliable and continuously improvable**. The target end state is a claim like:

> "Qubere correctly prepares 94% of eligible entries without broker intervention."

— backed by a real, versioned measurement — rather than "the AI seems to work well."

This becomes the foundation for production readiness, customer trust, broker feedback loops, model/prompt/agent optimization, regression prevention, and AI governance.

---

## 3. Business Goals

1. **Measure AI accuracy** — HTS classification, country of origin, customs value, quantity, currency, PGA requirements, entry type, required filing fields, document extraction.
2. **Measure autonomous performance** — north-star metric: **Autonomous Filing Readiness Rate**, defined precisely in §12.
3. **Prevent regressions** — every meaningful change to models, prompts, agent logic, retrieval, knowledge sources, or rules should be evaluable against the golden dataset before it ships.
4. **Identify failure modes** — not "PGA accuracy is 91%" but "PGA detection fails primarily on products containing X." Failures are categorized and searchable (§17).
5. **Create a continuous learning loop** — Production shipment → Qubere decision → broker correction → candidate eval case → expert-approved golden case → regression test → improved Qubere.

---

## 4. Non-Goals

The initial version will **not**:

- Automatically change production prompts, retrain models, or modify customs rules based on eval results.
- Replace broker review.
- Represent an official CBP compliance certification.
- Let customers modify Qubere's core evaluation methodology.
- Use an LLM judge as the sole source of truth for factual customs decisions — see §10 for how judge output is weight-capped against deterministic evaluators, not just declared off-limits in prose.

Humans remain responsible for deciding how to fix what the system surfaces.

---

## 5. Users

- **Engineering** — run evals after code changes, compare model versions, debug failed cases, inspect traces/evidence.
- **Product** — track AI quality, prioritize agent improvements, track autonomous completion and broker intervention.
- **Operations / Customs Experts** — review failed cases, validate expected answers, author golden cases, label failure modes, approve corrections.
- **Administrators** — manage datasets and configurations, control who can execute production evaluations, review audit history.

---

## 6. Admin Navigation

Add an **Evals** tab to the existing platform-admin tab set (`accounts | data | rate-review | hts | deployments | agents | api | cron | memory`), gated by `isPlatformAdmin` + a new `evals.view` permission (§0):

```
Admin
 └── Evals
       ├── Overview
       ├── Runs
       ├── Datasets
       ├── Cases
       ├── Agents        (extends the existing Agents tab's confidence view, does not replace it)
       ├── Failures
       └── Configuration
```

---

## 7. Eval Hierarchy

Evals operate at five levels, from narrowest to most business-relevant:

1. **Field-level** — Importer, Seller, Quantity, Unit price, Currency, Country of origin, HTS, Value, Entry type, PGA.
2. **Agent-level** — Document Intelligence, HTS Classification, Origin Rules, Valuation, PGA, Filing Readiness.
3. **Pipeline-level** — Documents → Intake → Extraction → Product Intelligence → HTS → Origin → Valuation → PGA → Filing Readiness.
4. **Shipment-level** — was the complete shipment correctly prepared?
5. **Business-outcome level** — could the broker submit this entry without correcting Qubere's output? This is the level §12's north-star metric lives at.

---

## 8. Golden Dataset & Case Structure

A **golden dataset** contains cases whose expected result has been reviewed and approved by a Qubere customs expert. Each case:

```
Eval Case
├── Metadata: Case ID, Dataset, Difficulty, Category, Status, Reviewer, Review status, Version, Created/Updated
├── Inputs: Invoice, Packing List, BOL, Other documents
├── Expected Results: Extraction, HTS, Origin, Valuation, PGA, Filing
├── Evidence
└── Evaluation Metadata
```

### Dataset categories

`Normal`, `Difficult Classification`, `Ambiguous`, `Conflicting Documents`, `Missing Information`, `PGA`, `Valuation`, `Origin`, `Adversarial` (designed to expose hallucination/unsafe assumptions), `Regression` (previously caused a production failure).

---

## 9. Evaluation Types

| Type | Use |
|---|---|
| Exact Match | Deterministic fields (e.g. 10-digit HTS exact) |
| Hierarchical Match | HTS at 10/8/6/4-digit granularity, configurable scoring per level |
| Numeric Tolerance | Quantity, weight, currency conversion, value |
| Required Field | All required fields populated |
| Rule Evaluation | Deterministic business/customs rule applied correctly |
| Cross-document | Invoice qty vs. packing list qty; invoice origin vs. Certificate of Origin |
| Evidence Evaluation | Does the cited evidence actually support the decision? |
| LLM Judge | Evidence/reasoning/explanation quality only — never the sole determinant of a factual customs field (§10) |

Deterministic evaluators run first and are cheaper; LLM judge is reserved for the subjective dimensions listed above (§18 cost controls).

---

## 10. Criticality Framework

Not all failures are equal.

- **Critical** — incorrect HTS causing material misclassification, incorrect country of origin, incorrect customs value, missed PGA requirement, incorrect importer, incorrect filing data, hallucinated information used as a filing fact.
- **Major** — missing required field, incorrect document reconciliation, incorrect quantity, incorrect valuation component, unsupported classification evidence.
- **Minor** — formatting, non-critical explanation issues, non-material normalization differences.

Critical errors weigh disproportionately in scoring (§11) and are reported separately as a **Critical Error Rate** so a high average score can't hide dangerous failures.

---

## 11. Scoring System

Individual dimension scores (Extraction, Classification, Origin, Valuation, PGA, Filing Readiness) roll up into an **Overall Eval Score**, configurable weights, critical-error-weighted.

**LLM-judge weight cap (fixes a gap in the original draft):** LLM-judge results may only ever score the "Evidence/Reasoning quality" dimension, never a factual field dimension (HTS, origin, value, etc.). That dimension's weight in the overall score is capped at a configured maximum (start at 10%) specifically so the Overall Eval Score cannot silently drift toward being LLM-judge-dominated as judge-scored dimensions get added over time. This directly enforces the §4 non-goal instead of just stating it.

---

## 12. The North-Star Metric — Autonomous Filing Readiness Rate

The original draft of this PRD defined this metric two different, non-equivalent ways (an internal checklist in one section, "would a broker accept it" in another). This revision picks one authoritative definition and treats the other as a proxy.

**Authoritative definition:**

```
Autonomous Filing Readiness Rate =
  Eligible cases the broker accepts without correction
  / Total eligible cases
```

This is ground truth, but it only exists **after** a case is filed and reviewed by a broker — it cannot be computed at eval time, before filing.

**Operational proxy (used everywhere until ground truth is dense enough):** a case is "Autonomously Ready" per Qubere's own internal checklist — required documents present, required fields correctly extracted, HTS/origin/valuation/PGA correct, cross-document conflicts resolved, required exceptions resolved, no critical failures, required evidence exists, filing data passes validation.

**The proxy must be periodically validated against ground truth, not trusted indefinitely.** Once `PostSummaryCorrection`-derived broker outcomes (§0) exist in volume for a set of cases that also have a proxy score, compare the two the same way §19 compares stated confidence to actual accuracy. If the proxy consistently over- or under-states readiness relative to real broker outcomes, that's a finding to act on, not noise to ignore.

---

## 13. Broker Intervention & the Production Feedback Loop

`PostSummaryCorrection` (§0) already captures broker corrections made *after* filing — correction type, corrected value vs. original, reason, legal basis. That's a partial source: it only sees a shipment that was actually filed and later corrected, not one a broker declined to file as-is. Closing that gap (capturing pre-filing broker edits, not just post-filing corrections) is Phase 2 scope, not Phase 1 — see the implementation plan.

Flow:

```
Production Shipment → Qubere Decision → Broker Review → Broker Correction
    → Difference Detected → Candidate Eval Case → Expert Validation → Golden Dataset
```

A Qubere operator/expert must approve the expected result before a production correction becomes a golden case — corrections are never auto-promoted.

---

## 14. Eval Runs & Version Comparison

An **Eval Run** executes a dataset against a specific Qubere version and records: Run ID, dataset + version, Qubere version/git commit, model + version, prompt version, agent versions, configuration, start/end time, cases run/passed/failed, critical failures, overall score.

Two runs can be compared:

```
                 Baseline     New       Delta
HTS               93.4%       96.1%     +2.7%
Origin            96.8%       97.1%     +0.3%
Valuation         95.2%       94.1%     -1.1%
PGA               94.7%       90.8%     -3.9%
```

Regressions (negative deltas above a configured threshold) are visually flagged.

---

## 15. Release Gates

Evals should eventually gate CI/CD:

```
Minimum overall score:       <TBD>
Minimum HTS accuracy:        <TBD>
Minimum PGA accuracy:        <TBD>
Maximum critical error rate: <TBD>
Maximum regression:          <TBD>
```

**These thresholds are intentionally left blank in this revision.** The original draft asserted numbers (e.g. "95% minimum overall score") with no baseline run behind them — that's a number nobody can defend yet. Set them after Phase 0 produces the first 3 baseline runs: start from (median − 1.5×stdev) of those runs, then review quarterly. Initially advisory only; becomes a mandatory deployment gate once thresholds are trusted (Phase 3).

---

## 16. Agent Evaluation & Trace

Every agent should expose: Input, Decision, Confidence, Evidence, Rules considered, Tools used, Warnings, Exceptions, Output — the evaluator should never need to reverse-engineer behavior from free-form text. Per §0, `AgentDecision` and `AgentExecutionRecord` already carry nearly all of this; the gap is a reader, not a producer.

For every failed case, the trace should be inspectable end to end (e.g. `CASE-1024`: Document Intake PASS → ... → HTS Classification FAIL → ... → Filing Readiness FAIL), drilling into a failed step to see input → retrieved knowledge → candidate outputs → rules applied → agent decision → evidence → expected answer → where it diverged. This should read directly off `AgentExecutionRecord.inputSnapshot`/`outputSnapshot` plus `AgentDecision.evidenceItems`/`rulesApplied` — not a new capture mechanism.

---

## 17. Failure Management

A dedicated **Failures** view, filterable by agent, severity, dataset, shipment type, HTS chapter, PGA, origin, valuation, model, prompt version, date, account, failure type.

Each failure: Failure ID, Case, Expected, Actual, Difference, Severity, Agent, Evidence, Root-cause category, Status, Assigned owner, Resolution, Created/Resolved date.

Statuses: `Open | Investigating | Fixed | Won't Fix | False Positive | Converted to Regression Case`.

**Root-cause categories:** Incorrect Extraction, Incorrect Classification, Incorrect Reasoning, Missing Knowledge, Incorrect Retrieval, Incorrect Tool Usage, Incorrect Business Rule, Prompt Failure, Model Failure, Document Quality, Missing Data, Conflicting Data, Integration Failure, Agent Handoff Failure, False Positive, Other.

---

## 18. UI Overview

```
EVALS
Overall Score          <first real run>
Filing Readiness       <first real run>
Autonomous Completion  <first real run>
Critical Error Rate    <first real run>
------------------------------------------------
Agent Performance          [reuses AgentsAnalyticsPanel's confidence-percentile
Document Intelligence       pattern, extended with pass/fail against golden
HTS Classification          expected values instead of just confidence stats]
...
------------------------------------------------
Recent Runs
Run #N    score    N cases    Passed/Failed
------------------------------------------------
Top Failure Modes
<populated from Failures view root-cause categories>
```

**Datasets** — Name, Cases, Version, Last Run, Score, Status, Owner; actions: create, duplicate, add/import/export cases, run, archive.

**Cases** — Case ID, Category, Difficulty, Documents, Expected Result, Latest Result, Score, Failures, Status; detail tabs: Overview, Documents, Expected, Actual, Diff, Trace, Evaluation, History. The **Diff** view (Expected vs. Actual, per field, pass/fail marker) is the single highest-value screen in this whole feature — it's where a failing run becomes an actionable bug report.

**Agent Performance** — accuracy, critical error rate, pass rate, confidence distribution, failure modes, trend over time, model/prompt versions, worst/best cases. Extends the existing `AgentsAnalyticsPanel`.

---

## 19. Confidence Calibration

Whether stated agent confidence corresponds to actual correctness:

```
Confidence       Actual Accuracy
90-100%             97%
80-90%              91%
70-80%              78%
60-70%              62%
<60%                51%
```

An agent reporting 99% confidence while being correct 80% of the time is a governance-level finding, not a footnote — surface it prominently, not buried in an agent detail page.

---

## 20. Human Review

For an uncertain case, a reviewer sets/confirms the expected answer (HTS, Origin, PGA, Value, Evidence) and Approves/Rejects/Edits. The reviewer becomes part of golden-dataset creation, with their identity and timestamp recorded for audit.

---

## 21. Data Model — Build vs. Reuse

Net-new entities (all `account_id`-scoped where tenant-relevant, all with `created_at`/`updated_at`/audit fields, per §22):

```
eval_datasets, eval_dataset_versions, eval_cases, eval_case_inputs,
eval_expected_outputs, eval_runs, eval_run_cases, eval_results,
eval_failures, eval_evaluators, eval_evaluator_results,
eval_feedback, eval_reviews, eval_configurations
```

**Reused, not duplicated** (§0): `AgentDecision`, `AgentExecutionRecord`, `AgentPolicyConfig`, `ExceptionItem`, `PostSummaryCorrection` as the source of "actual" output and trace data for a run — `eval_run_cases`/`eval_results` should reference these by ID rather than re-storing a copy of agent output.

Internal Qubere golden datasets are system-owned, not customer-owned.

---

## 22. Multi-Tenant, Privacy & Security

- Tenant isolation follows the existing pattern used everywhere else in the app: every account-scoped query includes `where: { accountId: ... }`, enforced at the DB/API layer per the project's own quality standard ("Tenant isolation is non-negotiable," `docs/plans/project-plan.md`), not a new mechanism invented for Evals.
- System golden data and customer production data can coexist; Customer A's data must never reach Customer B's evaluation surface.
- Encrypt at rest and in transit (inherits existing infra). Maintain audit logs via the existing `AuditLog` model. Restrict production-data access. Avoid sending unnecessary customer data to external LLM judges. Record which model/provider received evaluation data.
- Whenever an LLM judge runs, record: provider, model, model version, prompt version, input hash, result, timestamp — for reproducibility and audit.

---

## 23. API Requirements

```
POST   /evals/datasets            GET /evals/datasets            GET /evals/datasets/:id
POST   /evals/cases               GET /evals/cases               GET /evals/cases/:id
POST   /evals/runs                GET /evals/runs                GET /evals/runs/:id
GET    /evals/failures            GET /evals/failures/:id
POST   /evals/reviews             POST /evals/feedback
GET    /evals/agents/:agentId     GET /evals/metrics
```

Naming/conventions follow the existing API (see how `/api/decisions`, `/api/exceptions` are structured).

---

## 24. Performance, Cost Controls & Observability

Evaluation must not add production request latency — it runs asynchronously (Inngest, matching how the rest of the pipeline already does async work), with large runs going through background jobs.

Cost controls: deterministic evaluators first, sampling, batch evaluation, model selection for judges, per-run budgets, case-level and token-level cost tracking, cached results, re-run-failed-only. Every run reports:

```
Cases: N   LLM Judge Cases: N   Tokens: N   Estimated Cost: $X
```

Every run must be traceable to: git commit, agent version, prompt version, model + configuration, dataset version, evaluator version — so a 95% → 89% swing has a determinable cause.

---

## 25. Reporting & Business Metrics

**Run report:** overall score, agent scores, failure breakdown, critical failures, cost, latency, regression comparison.
**Agent report:** accuracy, error types, trends, model comparisons.
**Dataset report:** quality, case/difficulty distribution, historical performance.

**Metrics tracked:** Accuracy, Critical Error Rate, Autonomous Completion Rate (§12), Broker Intervention Rate, First-Pass Accuracy, Correction Rate, Regression Rate.

---

## 26. Phased Delivery

### Phase 0 — Prove the loop (no UI)

Goal: one real, defensible baseline number, before investing in any UI surface.

- Hand-build 15-20 golden cases (not 100-200) covering Normal + Difficult Classification + one Adversarial case.
- One evaluator: HTS Hierarchical Match.
- A script/route that runs those cases against the current pipeline, reading "actual" straight from `AgentDecision`/`AgentExecutionRecord` (§21) — no new run/case/dataset tables yet, or the minimum slice of them needed to record one run.
- Output: one number (HTS hierarchical-match accuracy on 15-20 cases) plus the per-case diff, reviewed manually.
- **Exit criterion:** the team has looked at one real accuracy number and one real diff, and agrees the approach is worth building UI for.

### Phase 1 — Foundation

- Admin → Evals navigation (§6), gated by `isPlatformAdmin` + `evals.view`.
- Evals Overview, dataset management, golden case CRUD, eval runner, run history, case detail with Expected vs. Actual diff, agent-level metrics (extending `AgentsAnalyticsPanel`).
- Evaluator set: Extraction, HTS, Origin, Quantity, Value, Currency, PGA, Required Fields, Cross-document consistency, Filing readiness.
- Grow the golden dataset toward the §8 distribution target (100-200 cases) as a parallel, ongoing workstream — not a blocking prerequisite for shipping the UI.

### Phase 2 — Intelligence

LLM judge (evidence/reasoning only, weight-capped per §11), failure categorization + management, pre-filing broker-correction capture (closing the `PostSummaryCorrection` gap noted in §13), production → candidate eval workflow, confidence calibration (§19), dataset tagging, model/prompt comparisons.

### Phase 3 — Engineering Integration

CI integration, automated regression runs, release gates (now with real thresholds from Phase 0/1 data — §15), git commit tracking, model/prompt comparison tooling, automated alerts (Slack/email), public Evaluation API.

### Phase 4 — Continuous Learning

Automatic candidate-case generation, active learning / difficult-case discovery, failure clustering, agent-specific and customer-specific benchmark suites, continuous evaluation.

---

## 27. Acceptance Criteria

**Admin**
- [ ] Evals appears under Admin, gated by `isPlatformAdmin` + `evals.view` (not a new access-control mechanism)
- [ ] Users without `evals.view` cannot reach `/platform-admin` with `activeTab === "evals"` via UI or direct API call

**Datasets**
- [ ] Users can create datasets and add cases via the Datasets UI and the `/evals/*` API
- [ ] Cases can reference shipment documents
- [ ] Expected results are defined per case; dataset versions are preserved

**Evaluation**
- [ ] A dataset can be executed against the current pipeline
- [ ] Individual agents and the full pipeline can be evaluated
- [ ] Deterministic evaluators (§9) work end to end; results persist to `eval_results`

**Results**
- [ ] Overall and agent-level scores are displayed
- [ ] Critical errors are identified and reported separately from the average score
- [ ] Expected vs. actual can be compared per field (Diff view)
- [ ] Failed cases open into a full trace, sourced from `AgentExecutionRecord`/`AgentDecision`, not re-derived logs

**Regression**
- [ ] Two runs can be compared with score deltas
- [ ] Regressions above threshold are visually flagged

**Security**
- [ ] Tenant isolation enforced at the DB/API layer, verified by a cross-tenant test (matching the project's existing standard)
- [ ] Production data access is restricted and auditable via `AuditLog`

---

## 28. Recommended Initial Golden Dataset (Phase 1 target, not Phase 0)

Target 100-200 cases once Phase 0 validates the approach:

```
30  Normal shipments               20  PGA scenarios
25  Difficult HTS classification   15  Valuation scenarios
20  Conflicting documents          15  Origin scenarios
20  Missing information            15  Adversarial/hallucination scenarios
                                    10  Historical production failures
```

Distribution should evolve based on observed production failures, not stay fixed at this initial split.

---

## 29. Key Product Principle

A dashboard saying "Qubere AI Score: 96%" is not the product. The product is being able to answer: **what did Qubere get wrong, why, how serious was it, what evidence did it use, which version caused it, and did we fix it?** Every UI and data-model decision in this doc should be judged against whether it makes that question answerable, not against whether it makes the Overview page look complete.
