# F01 Backend Foundation — Audit
> Re-audited: 2026-08-13 (second pass, compares against prior audit of same date)

Overall readiness: **80%** (previously 62% → prior audit's own same-day estimate of "~78% after session fixes")

Methodology: every task below was re-checked against the actual source on disk, independent of the prior audit's file:line citations (paths had drifted in several places — e.g. `packages/ai/*Agent.ts` no longer exist, the real writers are in `src/modules/agents/*.ts`; `src/lib/decisions/workQueue.ts` is now `src/modules/work/workQueue.ts` + `workQueueLoader.ts`). Vitest suites relevant to F01 were executed directly:
`npx vitest run tests/decision-state.test.ts tests/unit/dutyEngine.test.ts tests/unit/drawback.test.ts` → 3 files, 60 tests, all passing. `npm run openapi` was run and succeeds (writes `docs/openapi.yaml`).

**Net verdict on the prior audit's "stale finding" corrections:** mostly confirmed — A-3, A-5, B-3, C-2, F-2, G-1/G-2, H-4 are genuinely fixed, not just claimed. But this pass also found **new, previously-unflagged issues** that partially offset the gains: a machine agent writing `triageState: "APPROVED"` (a state the spec reserves for human reviewers), a fresh hardcoded-percentage fallback in the duty engine (same class of bug as the old "2.8%" issue, just relocated), and hardcoded per-type confidence scores in the refund-opportunity scanner. See "NEW findings" callouts below.

---

## Capability A — Decision State Normalizer

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1 | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/modules/decisions/decisionState.ts:21-100` — closed `DECISION_STATES` union (7 states), `normalizeDecisionStatus()`, `ACTIONABLE_DECISION_STATES`, `triageDecision()`. | None. |
| A-2 | DONE | UNCHANGED-WAS-ALREADY-DONE | `prisma/schema.prisma:761-771` — `triageState`, `blockedReason`, `autoApprovalPolicy`, `autoApproved`. Indexes at `schema.prisma:807-809`: `@@index([triageState])`, `@@index([accountId, triageState])`, `@@index([autoApproved])`. | None. |
| A-3 | DONE | UNCHANGED-WAS-ALREADY-DONE (confirmed independently) | All 7 agent writers verified this pass: `filingReadinessAgent.ts:174`, `originRulesAgent.ts:89,177`, `customsFilingAgent.ts:94,176`, `complianceAuditAgent.ts:183,455`, `htsClassificationAgent.ts:194,421-433`, `valuationAssistsAgent.ts:77,171,221`, `productIntelligenceAgent.ts:275,528` all set `triageState` from structured logic, not raw pass-through strings. | **NEW FINDING:** `customsFilingAgent.ts:176` sets `triageState: "APPROVED"` (with `autoApproved: false`) for what its own code labels `"[DEMO MODE]"` / `"[DEMO] Simulated ACE entry ... accepted"` (line 143, 179) — a simulated, non-human transmission writing the state the spec reserves for licensed human reviewers (violates the Capability B invariant, not A). Not gated behind `ALLOW_DEMO_SEEDING` or `NODE_ENV` — runs the same way in production via `POST /api/agents/[agentId]`. |
| A-4 | PARTIAL | UNCHANGED | `ActionsClient.tsx:781` (`categorize()`) and `DocumentReviewPanel.tsx:54` (`classifyDecision()`) both delegate to the centralized `triageDecision()` (good — no re-implemented logic), but that function still falls back to parsing the legacy `status` string when `triageState` is absent rather than requiring the column. `editableFields.ts:93` `reviewCategory()` still exists but is a different concern (UI field-editing treatment, not triage bucket) — likely a stale reference in the original task list, not a live bug. | Low severity — `triageDecision()` is a single source of truth now, just not `triageState`-only as literally specified. |
| A-5 | DONE | UNCHANGED-WAS-ALREADY-DONE (confirmed independently) | `src/modules/work/workQueueLoader.ts:45-46` filters `{ triageState: { in: ACTIONABLE_TRIAGE_STATES } }` OR legacy fallback. `src/app/app/actions/page.tsx:53-54` same pattern. Both read the column. | None. |
| A-6 | DONE | UNCHANGED-WAS-ALREADY-DONE | `tests/decision-state.test.ts` — 47 tests, all passing (ran this session). | None. |
| A-7 | DONE | UNCHANGED-WAS-ALREADY-DONE | `scripts/backfill-triage-state.ts` — batched (500/page), skips rows with `triageState` already set, logs unmapped statuses instead of guessing. | None. |

## Capability B — Auditable Auto-Approval

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1 | DONE | UNCHANGED-WAS-ALREADY-DONE | `prisma/schema.prisma:768,771` — `autoApprovalPolicy String?`, `autoApproved Boolean @default(false)`. | **See A-3 NEW FINDING** — the schema-level invariant ("AUTO_VERIFIED is the only valid auto-approved state") is not enforced at the write site for `customsFilingAgent.ts`, which writes `APPROVED` from a simulated/non-human path. |
| B-2 | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/modules/decisions/autoApprovalPolicy.ts:65-131` — pure `applyAutoApprovalPolicy()`. Part-master disagreement (`partMasterMatch && !partMasterHtsAgrees`) always returns `REVIEW` regardless of confidence (line 86-93), matching spec intent. | Minor spec-drift, not a bug: thresholds are 85/60 in code (and in the `AgentPolicyConfig` schema defaults) vs. 90/80 as literally written in F01. Internally consistent; just documented differently than the plan. |
| B-3 | DONE | UNCHANGED-WAS-ALREADY-DONE | `prisma/schema.prisma:817-837` — `AgentPolicyConfig` model with `autoThreshold`, `confirmThreshold`, `requirePartMasterMatch`, plus `policyType`/`requireHumanApproval`/`minimumReviewerRole` (extra fields beyond spec). `getAgentPolicyConfig()` (`autoApprovalPolicy.ts:40-63`) queries it; `htsClassificationAgent.ts:401,410-419` fetches and passes it into `applyAutoApprovalPolicy()`. | None. |
| B-4 | DONE | UNCHANGED-WAS-ALREADY-DONE | `applyAutoApprovalPolicy()` used in `htsClassificationAgent.ts:410` and `src/app/api/v1/batch/classification/route.ts`. Other agents (`originRulesAgent`, `complianceAuditAgent`, `valuationAssistsAgent`, `productIntelligenceAgent`, `filingReadinessAgent`) use deterministic rule-based gates (e.g. `requiresReview = criticalCount > 0`), not confidence thresholds, so they have nothing to "replace" — this is a legitimate design difference, not a gap. | None for the confidence-gated agent. `complianceAuditAgent.ts:366` sets `const confidence = 70` unconditionally (a fixed display number, not used as a gate) — cosmetic, not a policy bypass, but worth cleaning up since it reads as a real computed confidence in the UI. |
| B-5 | DONE | UNCHANGED-WAS-ALREADY-DONE | `htsClassificationAgent.ts:451-469` — `createAuditLog()` on every decision (AUTO and non-AUTO alike), `action: DECISION_AUTO_APPROVED` for AUTO outcomes, metadata includes `policyId`, `confidence`, `agentName`, `partMasterMatch`. | None. |
| B-6 | DONE | UNCHANGED-WAS-ALREADY-DONE | `tests/auto-approval-policy.test.ts` passing (part of the 47-test decision-state + auto-approval run in prior sessions; boundary cases covered). | None. |

## Capability C — Decimal-Safe Monetary Arithmetic

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1 | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/lib/tariff/decimal.ts` — `roundToCents`, `toNumber`, `fromString`, `Decimal.set({ precision: 20, rounding: ROUND_HALF_UP })`. `decimal.js@^10.6.0` in `package.json:31`. | None. |
| C-2 | DONE | UNCHANGED-WAS-ALREADY-DONE (confirmed independently) | `src/lib/tariff/dutyEngine.ts:131-203` `calculateDutyStack()` — all Decimal (`baseDuty`, `sec301Duty`, `sec232Duty`, `adDuty`, `cvdDuty` computed and returned separately, never pre-summed before the caller sees them). `src/lib/filing/form7501.ts` (used by the entry-summary route) is Decimal end-to-end with `.toNumber()` only at JSON-serialization boundaries. | None. |
| C-3 | PARTIAL | **REGRESSED (new instance of old bug class)** | The literal `"2.8%"` fallback the prior audit flagged in `landedCost.ts`/`dutyEngine.ts` is genuinely gone — confirmed via full-repo grep, the only `2.8%` occurrences left are in `rateParser.ts` doc-comments and `seed-drawback.ts` seed fixtures. `computeLandedCost()` correctly resolves to Decimal(0) duty for a truly unrated HTS code (no rate row at all). | **NEW FINDING:** `dutyEngine.ts:256` — `sec301AdditionalRate = sec301Rate.adValoremPercent ?? (sec301Rate.rawRateText ? parseFloat(sec301Rate.rawRateText) : 25)`. When a `HtsDutyRate` row for Section 301 *exists* but has neither a parsed `adValoremPercent` nor `rawRateText`, the code fabricates 25% instead of surfacing "rate not resolvable." Same class of bug as the old 2.8% fallback, just narrower (only fires on partially-populated Section 301 rows) and not yet caught by any test. `dutyEngine.ts:255` also silently defaults an unset tranche to `"List3"`. Fix: return `null`/flag-for-review instead of a magic number when the rate can't be parsed. |
| C-4 | DONE | UNCHANGED-WAS-ALREADY-DONE (confirmed independently) | `src/modules/drawback/drawback.service.ts:3` imports `roundToCents` correctly (the prior audit's "referenced but not imported" bug is fixed and stayed fixed). Line 135's `.times(0.99)` is the actual 19 U.S.C. § 1313 statutory 99% drawback rate (commented inline), not a fabricated heuristic multiplier — verified this is real law, not fake data. | None. |
| C-5 | PARTIAL | UNCHANGED (mislabeled as clean by prior audit) | `src/app/api/refunds/psc/route.ts:76-114` is clean: real `Decimal` math, `Decimal.max(0, ...)`, honest zero-duty rejection (line 80-82: `"PSC calculation requires actual duty paid..."`). `scan/route.ts` uses real `calculateDutyStack()` output and returns an honest empty-state message when there are no filings (line 30-36) — `estimatedRefundAmount: null` everywhere (never fabricates a dollar figure), satisfying the letter of "no fake numbers." | **NEW FINDING:** `scan/route.ts` assigns a fixed `confidence` per opportunity type regardless of the actual evidence strength: `95` for Section 301 exclusion (line 94), `88` for trade agreement (line 154), `75` for first-sale (line 182), `90` for drawback (line 208), `82` for AD/CVD scope (line 234). These are constants, not computed from the underlying match quality — the same "precision theater" pattern the task brief calls out for `0.88` relevance scores, just moved to a new field. Low severity since no dollar amount is fabricated, but the numbers imply false precision to a reviewer. |
| C-6 | DONE | UNCHANGED-WAS-ALREADY-DONE | `tests/unit/dutyEngine.test.ts`, `tests/unit/drawback.test.ts` — 13 tests, all passing (ran this session). | None. |

## Capability D — GET Endpoint Mutation Cleanup

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1 | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/exceptions/route.ts` GET — pure `ExceptionService.listExceptions()` read, no `.create()`/`.upsert()` in the handler. | None. |
| D-2 | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/documents/[id]/extractions/route.ts:119` GET — read-only. | None. |
| D-3 | DONE | UNCHANGED-WAS-ALREADY-DONE | Repo-wide grep for `ensureHtsSeeded` returns zero matches in `src/`. | None. |
| D-4 | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/findings/route.ts:24` — comment confirms invented-findings behavior was removed; plain paginated `findMany`. | None. |
| D-5 | DONE | UNCHANGED-WAS-ALREADY-DONE | `README.md:383-405` documents `npx prisma db seed` and manual seed scripts (`seed-clerk-users.ts`, `seed-qubere-trade-network.ts`), plus `ALLOW_DEMO_SEEDING` behavior at line 370. | None. |

## Capability E — Fine-Grained Permission Guards

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1 | MISSING | UNCHANGED | No permission-inventory doc/comment block found in `src/lib/api/auth-guards.ts` or `docs/`. | **PENDING:** Create the permission matrix; the prior audit's note that `docs/api-gap-analysis.md` is stale on this point still holds (not re-checked line-by-line this pass, but no evidence it was updated). |
| E-2 | DONE | UNCHANGED-WAS-ALREADY-DONE | `withAuthenticatedRoute(handler, { permission })` (`auth-guards.ts:122-128`) enforces permissions declaratively at the route-registration boundary — functionally equivalent to a `requirePermission(ctx, permission)` call, just inverted control flow. No standalone `requirePermission()` function exists (spec asked for one explicitly), but the enforcement itself is real and consistently used. | Cosmetic vs. spec wording only. |
| E-3 | DONE | UNCHANGED-WAS-ALREADY-DONE (confirmed independently) | All 5 routes verified this pass: `filing/[id]/transmit/route.ts:173` → `filings.submit`; `drawback/claims/route.ts:88` → `drawback.claim`; `classification/classify/route.ts:64` → `classification.create`; `exceptions/[id]/route.ts:36-46,95` → risk-acceptance gate (constant is named `exceptions.waive`, not literally `risk.accept` as spec'd, but it's still a dedicated permission checked before any waive-type status transition); `refunds/psc/route.ts:143` → `refunds.manage`. | None functionally. |
| E-4 | PARTIAL | UNCHANGED | `tests/tenant-isolation-routes.test.ts` unit-tests the `resolveTenantShipmentId()` helper against a fake in-memory lookup (not a real DB). `tests/api-suite.test.ts:328-338` ("does not act on another account's decision") calls the real `decisions.POST` handler but against a **mocked** Prisma client (`dbMock`), asserting the `where` clause includes `accountId` and that a `findFirst` returning `null` produces a 404 — meaningful but not a true end-to-end test against a real Postgres instance with two seeded accounts. New test files `tests/party-tenant-isolation.test.ts` and `tests/product-tenant-isolation.test.ts` exist but are also unit tests of `buildPartyWhere`/query-builder logic, not real HTTP+DB integration tests. | **PENDING (unchanged):** a genuine integration test — seed account A and account B in a real test DB, hit the live route for account A's shipment as account B, assert 404 — still does not exist. |

## Capability F — Token Security & Audit Hardening

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| F-1 | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/admin/users/route.ts:107-117` — `createAuditLog()` metadata is `{ invitedEmail, roleName }` only; the raw `Invitation.token` (a Prisma-generated `cuid`, `schema.prisma:322`) never appears in the audit metadata. | None for the AuditLog scope the task covers. (Note: the token itself is stored in plaintext in the `Invitation` table, which is normal for a single-use, expiring, DB-only invite link and out of F-1's literal scope — not flagging as a gap.) |
| F-2 | DONE | **FIXED, stayed fixed** | `src/lib/api/auth-guards.ts:125,161,204` — `req.headers.get("x-request-id") ?? generateRequestId()` in all three route wrappers (`withAuthenticatedRoute`, the public variant, and the cron variant). | None. |
| F-3 | PARTIAL | UNCHANGED | Repo-wide: 85 files under `src/app/api` still contain `NextResponse.json({ error` ad-hoc responses; only 39 files use `buildErrorResponse`. Within `src/app/api/v1/**` specifically: 18 of 27 route files use the ad-hoc shape, 0 use `buildErrorResponse`. | **PENDING:** same mechanical sweep the prior audit called out — not started in `v1/**`. |

## Capability G — Pagination on All Collection Endpoints

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| G-1 | DONE | **FIXED, stayed fixed** | `src/lib/api/pagination.ts` — `parsePagination()` (default 50, max 200, cursor param) and `buildPage()` are real, non-dead code, imported by `exceptions/route.ts`, `findings/route.ts`, `drawback/claims/route.ts`. | None. |
| G-2 | DONE | **IMPROVED beyond prior audit's assessment** | Re-checked all 7 spec'd endpoints, not just the 3 the prior audit sampled: `exceptions`, `findings`, `drawback/claims` use the new cursor-based `parsePagination`/`buildPage` helper. `shipments/route.ts:26-38,63-70`, `documents/route.ts` (`documentSkip`), `parties/route.ts` → `partyQuery.ts` (`PARTY_PAGE_SIZE_MAX=100`), `products/route.ts` → `productQuery.ts` (`PRODUCT_PAGE_SIZE_MAX=100`) all independently bound their `findMany` with `skip`/`take` — none of the 7 are unbounded. | Inconsistent mechanism: 3 endpoints use the new cursor helper (max 200 as spec'd), 4 use an older offset-based `page`/`pageSize` pattern with `max=100`, not `200`. Not a correctness bug, but two competing pagination conventions now coexist — worth consolidating onto one helper. |
| G-3 | MISSING | UNCHANGED | No `nextCursor`/`hasMore`/`fetchNextPage`/"load more" string found anywhere under `src/app/app` or `src/components`. | **PENDING:** frontend still fetches full pages with no load-more UI. |

## Capability H — OpenAPI Spec Generation

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| H-1 | PARTIAL | UNCHANGED | `scripts/generate-openapi.ts` runs cleanly (`npm run openapi` succeeds, writes `docs/openapi.yaml`). Hand-registers 7 `path:` entries against 223 actual `route.ts` files today (~3% coverage) — same order of magnitude as the prior audit's 7/206. | **PENDING:** still a hand-curated spec, not a real walker. |
| H-2 | DONE | UNCHANGED-WAS-ALREADY-DONE | `package.json:15` — `"openapi": "tsx scripts/generate-openapi.ts"`. | None. |
| H-3 | MISSING | UNCHANGED | Zero `.describe()` calls inside `src/app/api/**/route.ts` Zod schemas (grep confirms). All 21 `.describe()` calls in the codebase live in `scripts/generate-openapi.ts` itself, on hand-duplicated schema copies. | **PENDING:** annotate real route schemas; wire the generator to import them instead of re-declaring. |
| H-4 | DONE | **FIXED, stayed fixed** | `.github/workflows/ci.yml` — real PostgreSQL 16 service container, runs `npm run lint`, `npm test`, `npm run openapi` on push/PR to `main`. | None. |

---

## Cross-cutting Quality Standards — re-checked this pass

| # | Rule | Status |
|---|---|---|
| #1 No fake data | **MIXED.** The old flagship offender (`"2.8%"` universal fallback) is confirmed gone. But two new/overlooked instances of the same failure class were found this pass: `dutyEngine.ts:256` fabricates a 25% Section 301 rate when a rate row exists but is unparsed, and `refunds/opportunities/scan/route.ts` assigns fixed confidence scores (95/88/75/90/82) per opportunity type rather than computing them. Neither fabricates a dollar amount (both are honest that refund amounts are `null`), but both fabricate a precision/percentage figure that reads as computed. |
| #2 Money via Decimal.js | **CONFIRMED CLEAN** across every file checked this pass: `dutyEngine.ts`, `landedCost.ts`, `form7501.ts` (entry-summary), `drawback.service.ts`, `refunds/psc/route.ts`. No `Math.round(x*100)/100` float-money pattern found anywhere in `src/lib/tariff`, `src/modules/drawback`, or the refunds routes. |
| #3 Tenant isolation | Every route sampled scopes reads/writes with `where: { accountId: ctx.accountId }` (`exceptions`, `psc`, `shipments`, `parties`, `products`). No real seeded-DB cross-tenant integration test exists yet (see E-4). |
| #5 AuditLog on every write | Confirmed present on the writes sampled (`htsClassificationAgent`, `admin/users` invite, `refunds/psc`, `refunds/scan`, `exceptions/[id]` PATCH). Not exhaustively re-audited across all ~133 POST routes this pass. |
| #6 OpenAPI `.describe()` | **STILL ZERO** on real route schemas — unchanged (H-3). |
| #7 No `any` types | **NOT PREVIOUSLY SCORED — NEW FINDING.** 70 occurrences of `: any` / `as any` across `src/**/*.ts(x)`, and `eslint.config.mjs` does not enable `@typescript-eslint/no-explicit-any`. This is real, uncounted technical debt against a stated Quality Standard that the prior audit didn't check. |
| #8 Pagination on all lists | **IMPROVED** — confirmed this pass that all 7 spec'd endpoints are bounded (see G-2), better than the prior audit's assessment which only verified 3. |
| #9 Idempotency on mutations | **UNCHANGED** — 8 of 133 POST routes use `checkIdempotency`/`persistIdempotency` (prior audit said 8/123; route count grew, coverage did not). |
| #10 Indexed accountId queries | `@@index([accountId, triageState])`, `@@index([triageState])`, `@@index([autoApproved])` present on `AgentDecision` (schema.prisma:807-809). Not exhaustively re-verified across all models this pass. |
| Known offenders re-check | `"2.8%"` duty fallback: **gone** (confirmed by repo-wide grep, only survives in comments/seed fixtures). `0.88`-style hardcoded relevance scores: **not found verbatim**, but a near-relative pattern exists in `classificationCaseEngine.ts:338,360` (fixed `0.95` for GRI citations, binary `0.97`/`0.75` bucket for CROSS rulings — conditionally derived, lower severity than a flat constant). Fabricated URLs: none found (only `@example.com` placeholders in form UI hints and a dev-auth fallback email, both benign). Float math on money (`Math.round(x*100)/100`): none found in the tariff/drawback/refunds paths. `triageState` written-but-unread: **disproven** — confirmed read in `workQueueLoader.ts`, `actions/page.tsx`, `ActionsClient.tsx`, `DocumentReviewPanel.tsx`, `dashboard/page.tsx`. `AgentPolicyConfig` not wired into `applyAutoApprovalPolicy`: **disproven** — confirmed wired via `getAgentPolicyConfig()` → `htsClassificationAgent.ts:401-419`. |

---

## Top 5 fixes ranked by severity

1. **Stop `customsFilingAgent.ts` from writing `triageState: "APPROVED"` from a simulated/demo path.** (`src/modules/agents/customsFilingAgent.ts:176`) This directly violates the Capability B invariant that `APPROVED` means a licensed human reviewed it — a `[DEMO MODE]` machine simulation currently gets recorded identically to a real human sign-off, and it isn't gated behind any environment flag. Highest severity because it's a correctness/trust bug in the exact auditability guarantee this feature file exists to create.
2. **Remove the new 25%-Section-301 and `"List3"` fallback defaults in `dutyEngine.ts:255-256`.** Same bug class as the "2.8%" issue that was the prior audit's #1 finding — return `null`/flag-for-review instead of fabricating a rate when the DB row is incomplete.
3. **F-3: standardize error envelopes**, especially `src/app/api/v1/**` (18 of 27 route files still ad-hoc; 85 files repo-wide). Unchanged from prior audit — mechanical but large.
4. **H-1/H-3: OpenAPI coverage is still ~3%** (7/223 routes), and zero real route Zod schemas carry `.describe()`. This blocks the AI-assistant tool-calling spec that depends on F01 (per `docs/ai-chat-interface.md`).
5. **E-4: no true cross-tenant integration test exists.** All three "tenant isolation" test files are unit tests against fakes or mocked Prisma clients — none seed two real accounts against a real test database and hit the live HTTP route. Given tenant isolation is a Quality Standard's explicit "write a cross-tenant test" requirement, this remains the single biggest unverified assumption in the codebase.

**Also worth tracking, lower severity:** 70 `any`/`as any` occurrences with no lint rule blocking new ones (Quality Standard #7, previously unscored); hardcoded confidence constants in `refunds/opportunities/scan/route.ts` (95/88/75/90/82) that imply false precision; the two competing pagination conventions (cursor-based helper vs. offset `page`/`pageSize`) that should be consolidated; idempotency coverage stuck at 8/133 POST routes.
