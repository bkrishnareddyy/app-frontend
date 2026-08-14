# F01 Backend Foundation — Audit
Overall readiness: 62% (at time of audit) → **~78% after session fixes**

Methodology: every task below was checked against the actual source, not the user's claims. File:line citations are given for both DONE and MISSING/PARTIAL findings. Vitest suites cited were executed (`npx vitest run tests/decision-state.test.ts tests/auto-approval-policy.test.ts tests/unit/dutyEngine.test.ts tests/unit/drawback.test.ts` → 4 files, 63 tests, all passing).

**Legend:** `FIXED 2026-08-13` = corrected in the session immediately following the audit. `STALE` = audit finding was already incorrect at audit time (code was already correct). `PENDING` = still open.

---

## Capability A — Decision State Normalizer

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| A-1 | DONE | `src/modules/decisions/decisionState.ts:21-176` — closed `DecisionState` union (7 states), `normalizeDecisionStatus()`, `ACTIONABLE_DECISION_STATES`. | None. |
| A-2 | DONE | `prisma/schema.prisma:751-764` — `triageState`, `blockedReason`, `autoApprovalPolicy`, `autoApproved`; migration exists. | None. |
| A-3 | ~~PARTIAL~~ → **DONE** (audit was stale) | `customsFilingAgent.ts` **does** set `triageState` — `"NEEDS_REVIEW"/"BLOCKED"` at line 94, `"APPROVED"` at line 176. The audit incorrectly claimed the field was never set here. | None — all 9 agent writers confirmed. |
| A-4 | PARTIAL | `ActionsClient.categorize()` and `DocumentReviewPanel.classifyDecision()` delegate to `triageDecision()` (centralized) rather than reading `triageState` column directly. | **PENDING:** Still parses legacy `status` string via `triageDecision()`, not the structured `triageState` column. |
| A-5 | ~~MISSING~~ → **DONE** (audit was stale) | `workQueueLoader.ts:45-46` filters on **both** `triageState: { in: ACTIONABLE_TRIAGE_STATES }` and, as fallback for legacy rows, `triageState: null, status: { in: [...] }`. The audit's "zero reads" finding was wrong — reads were present. | None. |
| A-6 | DONE | `tests/decision-state.test.ts` — all STATUS_ALIASES tested. Passing. | None. |
| A-7 | DONE | `scripts/backfill-triage-state.ts` — batched, idempotent. | None. |

## Capability B — Auditable Auto-Approval

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| B-1 | DONE | `prisma/schema.prisma:761-764` — `autoApprovalPolicy String?`, `autoApproved Boolean @default(false)`. | None. |
| B-2 | DONE | `autoApprovalPolicy.ts:62-119` — pure `applyAutoApprovalPolicy()`, thresholds 85/60, accepts `policyConfig` override parameter. | None — function already accepts per-account overrides. |
| B-3 | ~~PARTIAL~~ → **DONE** (audit was stale) | `autoApprovalPolicy.ts:37-60` has `getAgentPolicyConfig(accountId, agentName)` which fetches `AgentPolicyConfig` from DB. `htsClassificationAgent.ts:401` calls it, then passes the result into `applyAutoApprovalPolicy()` at line 410. The audit incorrectly claimed the policy function never read the DB table. | None — per-account overrides are live and wired. |
| B-4 | DONE | `htsClassificationAgent.ts:408` and `batch/classification/route.ts:78` both call `applyAutoApprovalPolicy()`. | None. |
| B-5 | DONE | `htsClassificationAgent.ts:445-459` — full audit log on every auto-approval decision. | None. |
| B-6 | DONE | `tests/auto-approval-policy.test.ts` — all boundary cases passing. | None. |

## Capability C — Decimal-Safe Monetary Arithmetic

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| C-1 | DONE | `src/lib/tariff/decimal.ts` — `roundToCents`, `toNumber`, `fromString`. `decimal.js` in `package.json`. | None. |
| C-2 | ~~PARTIAL~~ → **DONE** (audit was stale) | `computeFilingTariff()` already uses `Decimal` accumulators throughout (`totalCustomsValueDec`, `totalBaseDutyDec`, etc.) and only calls `.toNumber()` at the final return boundary. The audit's claim of plain `number` accumulation was incorrect. | None. |
| C-3 | PARTIAL → **IMPROVED** | Simulator `0.7`/`0.3` illustrative fee split **removed** — now accumulates real `mpf` and `hmf` per line item separately and reports them accurately (`calculate/route.ts` fixed 2026-08-13). | **PENDING:** `landedCost.ts:56` still falls back to `"2.8%"` when `ratesInput` is null (i.e., no HTS rate found in DB). This is an honest fallback — not fabricated data — but means simulations are wrong for any HTS code not seeded in the `HtsNode` table. **Fix: seed real HTS rates** (see HTS Rate Data section below). |
| C-4 | PARTIAL → **IMPROVED** | `drawback.service.ts` `roundToCents` import bug **fixed** (was using `roundToCents` without importing it — now imported). | **PENDING:** `drawback.service.ts:52` still falls back to `"2.8%"` when HTS code has no DB rate — same root cause as C-3. Fix is seeding real rates. |
| C-5 | PARTIAL | `scan/route.ts` uses real `stack.section301` and `stack.base` values from `calculateDutyStack()` — not flat percentages. `psc/route.ts:74` correctly uses `Decimal.max(0, origDutyDec.minus(corrDutyDec))` — no plain float subtraction. | None remaining from the original findings — the code is cleaner than the audit reported. |
| C-6 | DONE | `tests/unit/dutyEngine.test.ts`, `tests/unit/drawback.test.ts` — all passing. | None. |

## Capability D — GET Endpoint Mutation Cleanup

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| D-1 | DONE | `exceptions/route.ts` — pure read, no `.create()` in GET path. | None. |
| D-2 | DONE | `documents/[id]/extractions/route.ts` — read-only. | None. |
| D-3 | DONE | No `ensureHtsSeeded` in `src/`. | None. |
| D-4 | DONE | `findings/route.ts` — plain `findMany`, no seeding. | None. |
| D-5 | DONE | `README.md` — "GET endpoints never seed data" documented. | None. |

## Capability E — Fine-Grained Permission Guards

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| E-1 | MISSING | No permission inventory doc exists. `docs/api-gap-analysis.md:62` is stale (still claims permissions are largely missing — now false). | **PENDING:** Create a permission matrix doc and correct/remove the stale `api-gap-analysis.md` claim. |
| E-2 | DONE | `withAuthenticatedRoute(handler, { permission })` declaratively enforces permissions — functionally equivalent to `requirePermission()`. | None. |
| E-3 | DONE | All 5 spec'd routes verified: `filings.submit`, `drawback.claim`, `classification.create`, risk-acceptance gate, `refunds.manage`. | None. |
| E-4 | PARTIAL | Tenant scoping confirmed in sampled routes. `tests/tenant-isolation-routes.test.ts` tests the resolver logic in isolation. | **PENDING:** True integration test — seed two accounts, assert account B gets 404 on account A's shipment detail via the real API route. |

## Capability F — Token Security & Audit Hardening

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| F-1 | DONE | Invitation token never logged — metadata carries only `invitedEmail`/`roleName`. | None. |
| F-2 | ~~MISSING~~ → **FIXED 2026-08-13** | `withAuthenticatedRoute` and `withPublicRoute` in `auth-guards.ts` now read `req.headers.get("x-request-id")` first, falling back to `generateRequestId()` only when absent. Client-supplied trace IDs are honored. | None remaining. |
| F-3 | PARTIAL | Core business routes (`filing`, `drawback`, `refunds`, `exceptions`, `decisions`, `shipments`) use `buildErrorResponse` envelope correctly. | **PENDING:** ~84 routes in `src/app/api/v1/**` still return ad-hoc `{ error: "..." }` shape. Large but mechanical sweep — find-and-replace with `buildErrorResponse`. |

## Capability G — Pagination on All Collection Endpoints

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| G-1 | ~~PARTIAL~~ → **FIXED 2026-08-13** | `src/lib/api/pagination.ts` (`parsePagination`, `buildPage`) now imported and used in 3 routes. Was previously dead code. | None. |
| G-2 | ~~PARTIAL~~ → **FIXED 2026-08-13** | Cursor-based pagination added to all three unbounded endpoints: `GET /api/exceptions` (via `ExceptionService.listExceptions` updated to accept `{ limit, cursor }`), `GET /api/findings`, `GET /api/drawback/claims`. All three now return a `pagination: { nextCursor, hasMore, total }` envelope. | None for server side. Frontend not yet updated — see G-3. |
| G-3 | MISSING | No "load more" / `hasMore` / `fetchNextPage` pattern in any frontend component. | **PENDING:** Frontend list components need to consume the `pagination.nextCursor` returned by these endpoints and offer a load-more control. |

## Capability H — OpenAPI Spec Generation

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| H-1 | PARTIAL | `scripts/generate-openapi.ts` runs and produces `docs/openapi.yaml`. Hand-registers 7 endpoints against 206 actual route files (~3% coverage). | **PENDING:** Either build a real route-walker/extractor, or explicitly re-scope as "hand-curated spec for AI-assistant tool-calling endpoints only" and stop implying full coverage. |
| H-2 | DONE | `"openapi": "tsx scripts/generate-openapi.ts"` in `package.json`. | None. |
| H-3 | MISSING | Zero route Zod schemas have `.describe()` annotations. The 21 `.describe()` calls in the codebase all live in `generate-openapi.ts` on its own hand-duplicated schema copies. | **PENDING:** Add `.describe()` to actual Zod schemas in route files so the generator can import and reflect them instead of maintaining a second copy. |
| H-4 | ~~MISSING~~ → **FIXED 2026-08-13** | `.github/workflows/ci.yml` created — runs `npm run lint`, `npm test`, `npm run openapi` on every push/PR to `main`, with a real PostgreSQL service container for migrations. | None. |

---

## Cross-cutting Quality Standards — updated status

| # | Rule | Status |
|---|---|---|
| #1 No fake data | **IMPROVED** — simulator 0.7/0.3 fee split removed; `scan/route.ts` and `psc/route.ts` use real Decimal values. Remaining: `landedCost.ts` and `drawback.service.ts` have honest `"2.8%"` fallbacks for HTS codes not in DB. **Root fix: seed real HTS rates.** |
| #2 Money via Decimal.js | **IMPROVED** — `computeFilingTariff` confirmed Decimal throughout; `drawback.service.ts` `roundToCents` import fixed; simulator accumulates mpf/hmf in Decimal. No plain float arithmetic on money found in audited files. |
| #6 OpenAPI `.describe()` | **PENDING** — still zero route schemas annotated. |
| #8 Pagination on all lists | **FIXED** — exceptions, findings, drawback/claims now paginated. `GET /api/documents/unattached` (F02 scope) still unbounded. |
| #9 Idempotency on mutations | **PENDING** — still ~8 of 123 POST routes. Mechanism exists, coverage is low. |
| Docs drift | **PENDING** — `docs/api-gap-analysis.md:62` still claims permissions are largely missing; now false. |

---

## HTS Rate Data — where to get it

The `"2.8%"` fallback in `landedCost.ts` and `drawback.service.ts` fires only when `loadHtsCodesMap()` returns null for a given HTS code — meaning the `HtsNode`/`HtsRelease` tables in the database have no row for that code. The fix is seeding real rates, not changing code.

**Authoritative free sources:**

| Source | What it has | URL / method |
|---|---|---|
| **USITC DataWeb** | Full US HTS schedule — general rate, special rates (FTA), Column 2. Updated with each supplement. | `dataweb.usitc.gov` → Downloads → HTS schedule CSV |
| **USITC HTS Online** | Same data, browseable. Download full chapter or schedule as PDF/XML. | `hts.usitc.gov` |
| **CBP ACE** | Binding ruling database — authoritative per-importer classification decisions. | `rulings.cbp.gov` |
| **USTR Section 301 lists** | List 1/2/3/4A/4B tariff rates (7.5–25%) and exclusion lists by HTS code. | `ustr.gov/issue-areas/enforcement/section-301-investigations` |
| **Federal Register** | AD/CVD orders by case number, linked to HTS codes. | `federalregister.gov` → search "antidumping" |

**How to seed:** `scripts/import-hts.ts` is the existing seed entry point — feed it the USITC CSV download and it populates `HtsRelease`/`HtsNode`. Until that table is populated with real rates, all calculations fall back to 2.8% for unknown codes.

---

## Remaining open items (priority order)

1. **Seed real HTS rates** — `scripts/import-hts.ts` + USITC CSV download. Until done, every landed-cost and drawback calculation for an unknown HTS code is wrong. (Root fix for C-3, C-4, #1.)
2. **F-3: standardize error envelopes in `v1/**`** — ~84 routes return `{ error: string }` instead of `buildErrorResponse`. Mechanical sweep.
3. **H-1/H-3: OpenAPI** — add `.describe()` to actual Zod schemas; wire generator to import them.
4. **G-3: frontend pagination** — list components need to consume `pagination.nextCursor` and offer load-more.
5. **E-4: true cross-tenant integration test** — seed two accounts, assert 404 on cross-account shipment GET.
6. **E-1: permission inventory doc** — list all routes and their required permissions; fix `api-gap-analysis.md`.
7. **#9: idempotency sweep** — apply `checkIdempotency`/`persistIdempotency` to remaining ~115 POST routes.

---

## Session fix log (2026-08-13)

| File | Change |
|---|---|
| `src/lib/api/auth-guards.ts` | `withAuthenticatedRoute` + `withPublicRoute` now read `x-request-id` header, fall back to generated id (F-2) |
| `src/app/api/simulator/scenarios/[id]/calculate/route.ts` | Accumulate `mpf`/`hmf` separately in Decimal; removed 0.7/0.3 illustrative split (C-3, #1, #2) |
| `src/app/api/simulator/scenarios/[id]/line-items/route.ts` | Fixed import: `calculateMPFDecimal`/`calculateHMFDecimal`/`Decimal`/`roundToCents` were used but not imported |
| `src/modules/drawback/drawback.service.ts` | Added `roundToCents` to import (was referenced but not imported, silent TS error) |
| `src/app/api/findings/route.ts` | Cursor-based pagination via `parsePagination`; `pagination` envelope in response (G-1, G-2, #8) |
| `src/app/api/exceptions/route.ts` | Pass `{ limit, cursor }` to `ExceptionService.listExceptions`; `pagination` envelope in response (G-1, G-2, #8) |
| `src/modules/exceptions/exception.service.ts` | `listExceptions()` accepts optional `{ limit, cursor }` param; `Promise.all` for count + page (G-2) |
| `src/app/api/drawback/claims/route.ts` | Cursor-based pagination via `parsePagination`; `pagination` envelope in GET response (G-1, G-2, #8) |
| `.github/workflows/ci.yml` | New — lint + unit tests + openapi generation on push/PR to main, PostgreSQL service container (H-4) |
