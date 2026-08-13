# Qubere Implementation Review — Grade Report
> Generated: 2026-08-13
> Method: 7 independent adversarial audits ran in parallel against the actual codebase (not against commit messages or self-reported status), one per feature-file group. Every finding below has a file:line citation in the linked audit doc. "DONE" required proof the behavior is reachable from a real request; "PARTIAL" and "MISSING" are called out explicitly rather than rounded up.

## Overall Grade: ~62%

The core engineering is real in most places — Decimal money math, tenant isolation, structured extraction with bbox provenance, server-enforced filing gates, and the product/party master are genuinely well built. But there is a **repeating pattern across at least 8 files**: a hardcoded placeholder (duty rate, relevance score, download URL, CBP number) was put in as a stand-in during development and never replaced with the real computation — and it's the same class of bug the original plan explicitly told every agent to avoid ("No fake data, ever"). That pattern, not raw missing-feature count, is the main thing dragging the grade down and the main thing worth fixing first, because fixing the root cause once (real HTS-rate lookup) closes gaps in 4 different features at once.

---

## Scorecard

| # | Feature | Readiness | Biggest risk | Audit |
|---|---|---|---|---|
| F01 | Backend Foundation | **62%** | Hardcoded `"2.8%"` duty rate still live in landed-cost & drawback calculation paths | [F01-audit.md](review/F01-audit.md) |
| F02 | Document Intelligence | **74%** | Shipment-candidate matching writes data no UI ever reads | [F02-F03-audit.md](review/F02-F03-audit.md) |
| F03 | Shipment Workspace | **71%** | Reconciliation conflicts can't actually be "resolved" — no `resolution` field exists | [F02-F03-audit.md](review/F02-F03-audit.md) |
| F04 | Actions & Workflow | **55%** | Bulk-waive on exceptions is 100% broken; bulk-approve idempotency check is dead code | [F04-F05-audit.md](review/F04-F05-audit.md) |
| F05 | HTS Classification | **57%** | "AI classification" is a 2-of-6-GRI-rules template, not the named `htsAgent.ts`; duty impact hardcoded to `$0` | [F04-F05-audit.md](review/F04-F05-audit.md) |
| F06 | Origin, Valuation & Tariff | **65%** | AD/CVD duty silently computes to `$0` on every real call — no rate table exists | [F06-F07-F08-audit.md](review/F06-F07-F08-audit.md) |
| F07 | Filing & Entry | **80%** (strongest) | 15-min status-polling cron impossible on current hosting tier (documented limit, not a bug) | [F06-F07-F08-audit.md](review/F06-F07-F08-audit.md) |
| F08 | Audit & Governance | **52%** | `/api/audit/export` returns a fabricated, non-functional download URL — code comment admits it's a mockup | [F06-F07-F08-audit.md](review/F06-F07-F08-audit.md) |
| F09 | Duty Recovery & Drawback | **45%** (weakest) | Drawback lot creation is dead code; claims are permanently stuck in DRAFT | [F09-F10-audit.md](review/F09-F10-audit.md) |
| F10 | Regulatory & Tariff Intelligence | **58%** | Regulatory cron notifies every user in the entire database (no `where` clause) | [F09-F10-audit.md](review/F09-F10-audit.md) |
| F11 | Product & Party Master | **88%** (best) | Party "relationship graph" is a list, not a graph — cosmetic only | [F11-F12-audit.md](review/F11-F12-audit.md) |
| F12 | Platform Foundation | **61%** | `DataMode` Prisma middleware named in the plan does not exist at all | [F11-F12-audit.md](review/F11-F12-audit.md) |
| F13 | Chat Interface | **32%** (2nd weakest) | Still Gemini not Claude; 16 of 24 tools render nothing in the chat UI | [F13-audit.md](review/F13-audit.md) |

---

## The one bug worth fixing first

A real per-HTS-code duty-rate lookup (`loadHtsCodesMap` / `parsePublishedDutyRate` / `HtsNodeRepository`) already exists and is used **correctly** in several places (e.g. `filing/[id]/entry-summary/route.ts`, `simulator/.../line-items/route.ts`). But a hardcoded `generalDutyRate: "2.8%"` (and a hardcoded `section301Tranche: "List3"`) was copy-pasted as a placeholder into the money-calculation paths below, and never replaced:

- `src/lib/tariff/landedCost.ts:56`
- `src/modules/drawback/drawback.service.ts:47-49`
- `src/app/api/refunds/opportunities/scan/route.ts:60` (7.5%), `:105` (2.8%)
- `src/lib/regulatory/impactAnalysis.ts:82-83` (fixed 1.7% "rate delta," ignoring the update's real old/new rate — and a unit test encodes this fake number as the expected correct answer: `tests/unit/regulatory.test.ts:68-69`)
- `src/app/app/simulator/page.tsx:137-138,146` (client-side hardcoded rates + an arbitrary breakeven formula)

**Fix once** (thread the real `DutyRateInput` into `computeLandedCost`/`DrawbackService`/the refund scanner/the impact-analysis engine instead of a literal string) and it closes real gaps in F01, F06, F09, and F10 simultaneously.

---

## Fix Wave Plan

### Wave 0 — Legal/compliance exposure (fix before any real customer sees these)
1. **`POST /api/audit/export` returns a fabricated download URL.** `src/app/api/audit/export/route.ts:82-85` — the code's own comment admits "(simulated mockup Vercel Blob URL)." No ZIP is ever built, no blob is uploaded, the link 404s. Confirmed independently by two separate audits (F08, F12). Either implement real ZIP + Blob upload, or return an honest "not implemented" error.
2. **Fabricated data in CBP-audit-defense documents.** `src/lib/audit/reasonableCarePackage.ts` hardcodes `cbpNumber: "CBP-99-1234567"` (line 189), fake GRI steps (line 114), a fake `95` confidence (line 161), zeroed-out valuation (lines 125-131), and a fake `"DIGITALLY_SIGNED_QUBERE"` certification (lines 202-207) — for every shipment, regardless of the real importer or classification. `src/lib/audit/focusedAssessment.ts:135-140,146-147` has the same fake CBP number/address and a narrative labeled "AI-generated" that is actually a static template with no Claude call anywhere. These are legal defense documents; fix before anyone relies on them.
3. **Regulatory-ingest cron notifies every user in the database.** `src/app/api/cron/regulatory-ingest/route.ts:145` — `db.accountMembership.findMany()` has no `where` clause at all, fanning out `Notification` rows to every account in the system on every run. One-line fix (filter by the triggering account + `regulatory.review` permission), but high blast radius if this cron is ever scheduled (it currently isn't — see Wave 3).
4. **Root-cause duty-rate fix** — see "The one bug worth fixing first" above.
5. **Float-money aggregation on the live filing path.** `computeFilingTariff` (`src/lib/tariff/dutyEngine.ts:265-340`) — used by `filing.service.ts`, `pipelineOrchestrator.ts`, and two `filing` API routes — sums money with plain JS `+=`/`Math.round(x*100)/100`, not Decimal. Same pattern in `refunds/psc/route.ts:56-62`, `drawback.service.ts:135,195`, `v1/classification/cases/[caseId]/impact/route.ts`, and the simulator calculate route.

### Wave 1 — Security & platform hardening
6. **Build the `DataMode` Prisma middleware.** `src/lib/db.ts` is a 19-line bare `PrismaClient` — no `$use()`/`$extends()` anywhere. DEMO-vs-PRODUCTION isolation currently depends entirely on developers remembering manual `where` clauses (F12-A2).
7. **Close the permission-gate gap on 66 of 146 mutation routes** (F12-B4), prioritizing `POST /api/decisions`, `POST /api/decisions/bulk`, `POST /api/shipments`, `POST /api/filing`, `POST /api/compliance/audits/run`. The mechanism (`withAuthenticatedRoute({ permission })`) works correctly everywhere it's used — this is a rollout gap, not a design gap.
8. **Wire `AgentPolicyConfig` into the actual auto-approval function.** `applyAutoApprovalPolicy()` hardcodes 85/60 as module constants and never reads the per-account override a compliance officer can edit in the admin UI (F01-B3) — the settings page currently implies control that has zero effect.
9. **Make `triageState` load-bearing.** It's written by 8 of 9 agent writers but read by nothing (`workQueueLoader.ts` still filters on the legacy `status` string) — either wire the readers to it or remove the column and its misleading schema comment (F01-A5).
10. **AuditLog coverage sweep + provenance.** 80+ of 146 write routes never call `createAuditLog` (F08-A1); the typed `AuditAction` enum is defined but has zero usages anywhere (F08-A2); and `AuditLog` has no `source` column, so a chat-originated write is indistinguishable from a UI-originated one (F13-C3) — add the column now while doing the sweep, not as a follow-up.

### Wave 2 — Core feature integrity (what users will notice is broken)
11. **Bulk-waive on exceptions is completely broken.** `POST /api/exceptions/bulk` never reads `resolutionReasonCode` from the request body, so every bulk-waive call fails validation (F04-E2). One-line fix.
12. **Bulk-approve idempotency check is dead code.** `decisions/bulk/route.ts:155` compares against status strings (`"APPROVED"`/`"REJECTED"`) that are never actually stored (real values are `"Approved"`/`"Rejected"`) — re-running a bulk approve silently reprocesses already-approved decisions (F04-E1).
13. **The GRI classification engine only evaluates 2 of 6 GRI rules, always emits exactly one proposal, and picks confidence from 4 hardcoded constants** (`GriRulesEngine.evaluate()`) — `htsAgent.ts`, the file the spec names as the real AI agent, is dead code in the actual case-processing path (F05-A3). This is the core "evidence-backed HTS proposal" pitch.
14. **CROSS ruling relevance is hardcoded to `0.88`** for every citation (`classificationCaseEngine.ts:244`), and classification duty impact is hardcoded to `Decimal(0)` for every row (`:457`) — the impact UI is coded correctly but can never actually render a duty delta because of this (F05-C3, F05-F2).
15. **Section 301 and AD/CVD are not backed by real rate data.** `HtsDutyRate` has no fields for tranche/case-number/manufacturer; Section 301 is a hardcoded rate switch and AD/CVD duty silently computes to `$0` on every real duty-stack calculation today (F06-D2/D3).
16. **`DrawbackLot` creation is dead code** (never called from the filing-acceptance flow — production data only exists via a fake seed script) **and `DrawbackClaim` status transitions are hard-blocked** pending a "workflow engine" that doesn't exist, so the drawback lifecycle doesn't function end-to-end outside demo data (F09-B2/B6).
17. **Reconciliation conflicts can't be resolved as designed.** `ReconciliationIssue` has no `resolution`/`resolvedByUserId` fields and never becomes an `ExceptionItem`, so "pick which value is correct" (the actual UX the plan describes) can't work, and the reconcile route has zero `AuditLog` writes despite being on the compliance-critical path (F03-C).
18. **Wire Claude into chat and advisory**, replacing Gemini. `@anthropic-ai/sdk` is installed and proven working in the product-enrichment route, but `orchestrator.ts` and `advisory/query/route.ts` both still hard-code `GoogleGenAI` — the plan's most explicit, most testable requirement was simply not done (F13-A5/D1).
19. **Build the missing chat result cards + inline actions.** `ToolCard()` returns `null` for 16 of 24 tools, including every consequential write tool — "approve/reject via chat" is something the model could theoretically invoke from free text, but there is no clickable UI for it anywhere, which directly breaks "every UI action doable via chat" (F13-B4/C3).

### Wave 3 — Completeness & polish
20. Add `.describe()` to the actual route Zod schemas and expand OpenAPI generation past the current 7-of-206-routes hand-registered subset (F01-H3) — this is named as the source of truth for chat tool definitions and currently isn't.
21. Wire `deliverWebhookEvent()` into real event-emission points — it's fully built (HMAC signing, retry, delivery log) but has zero callers today (F12-F3); build the API-key management UI, which has a working backend and no frontend (F12-F6).
22. Dashboard: add the cycle-time timeline and exception-age bucket charts — data is already computed and returned by the API, just not rendered (F12-D3/D4); wire `selectedClientId` into the metrics fetch, which is currently ignored client-side (F12-D5).
23. Pagination sweep on remaining unbounded list endpoints: `GET /api/exceptions`, `GET /api/findings`, `GET /api/drawback/claims`, the `/app/actions` server component's 3 unbounded `findMany` calls, `GET /api/simulator/scenarios`, `GET /api/refunds/psc` (F01-G2, F04-B4, F09/F10 cross-cutting).
24. Stand up a CI pipeline — there is currently none at all (`.github/workflows` doesn't exist), so nothing enforces tests, lint, or OpenAPI generation on any push (F01-H4).
25. Add server-side PDF generation — no PDF library exists anywhere in `package.json`; needed for the 7501 export, reasonable-care record, and focused-assessment ZIP (F07-A5, F08-B3, F08-D5).

---

## Architectural note: Inngest is planned everywhere, used nowhere

Every one of the 13 feature files assumes Inngest as the async/event orchestration layer (`shipment.stage.advance`, daily compliance crons, webhook delivery, reprocessing triggers). In the actual codebase, `inngest` is a `package.json` dependency but **zero Inngest client/function/route exists anywhere in `src/`** — real async work runs through a bespoke `PgQueue`/`documentWorker.ts` pattern instead, and scheduled jobs use plain Vercel Cron (capped at 2 jobs/1 execution-per-day on the Hobby plan, which is why `regulatory-ingest` isn't actually scheduled despite the admin UI claiming "Daily at 00:00 UTC"). This isn't necessarily the wrong call for a Hobby-plan-constrained app, but it means roughly a dozen tasks across F04, F06, F07, F08, F09, and F10 are written against infrastructure that isn't there. Worth an explicit decision — commit to the PgQueue/Vercel-Cron architecture and update the plan, or actually adopt Inngest — rather than leaving each feature file quietly wrong about how the app works.

---

## How to use this

Each linked audit file (`docs/plans/review/F0X-audit.md`) has the full task-by-task table with file:line evidence for every capability, plus its own "Top 5 fixes ranked by severity" section — copy the relevant capability's table + fix description as an agent prompt, the same way you used the original feature files. The wave plan above is the cross-file prioritization; the audit files are the task-level detail.
