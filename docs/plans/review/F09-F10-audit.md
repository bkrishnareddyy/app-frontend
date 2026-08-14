# F09 Duty Recovery + F10 Regulatory & Tariff Intelligence — Audit
> Re-audited: 2026-08-13 (second pass, compares against prior audit of same date)

F09 Overall readiness: 75% (previously 45%)
F10 Overall readiness: 73% (previously 58%)

Methodology: every numbered task from the prior audit was re-checked against current source at the same (or grep-relocated) file:line, with fresh adversarial verification rather than trusting the prior findings or git log. Status legend: **DONE** = matches spec with real data/computation; **PARTIAL** = implemented but with a spec deviation, dead wiring, or a fake/static value substituting for real computation; **MISSING** = not implemented or unreachable; **N/A** = out of scope. Change legend: **FIXED**, **STILL BROKEN**, **REGRESSED** (was better before), **UNCHANGED-DONE** (already correct, still correct), **NEW** (issue not present/checked in prior audit).

---

## SEVERITY-1 FINDING — Cross-tenant notification fan-out (Quality Standard #3)

**The specific bug is FIXED. A new, less severe bug was introduced in the same commit that makes the fix crash on its only real invocation path.**

`src/app/api/cron/regulatory-ingest/route.ts:150-174` — the unfiltered `db.accountMembership.findMany()` (no `where` at all) is **gone**. The scoped path now does:
```
db.accountMembership.findMany({ where: { status: "ACTIVE", deletedAt: null, accountId, roles: { some: { role: { OR: [{name:{in:["OWNER","ADMIN"]}}, {rolePermissions:{some:{permission:{name:"regulatory.review"}}}}] } } } } })
```
This is real, tenant-scoped, permission-filtered, and covered by a passing test (`tests/phase4-regulatory.test.ts:190-231`, asserts the exact `where` clause). This was the single most severe finding in the prior audit — it is genuinely resolved for the `?accountId=` code path.

**However**, that scoped branch only runs when the caller supplies `?accountId=`. Nothing in the codebase ever does — not the admin "Run Manually" button (`src/app/api/platform-admin/cron/[jobId]/run/route.ts:12,45`, calls the endpoint with no query params) and not the automated scheduling that now actually reaches this cron: `src/app/api/cron/data-dispatcher/route.ts:107-113` fetches `/api/cron/regulatory-ingest` with `method: "POST"` and no query string, and `data-dispatcher` **is** registered in `vercel.json` (daily, 02:00 UTC) with `regulatory-ingest` listed as a `readinessStatus: "LIVE"` dataset in `src/lib/data/datasetRegistry.ts:56-67`. So the no-`accountId` branch is the *only* branch that ever actually executes in production.

That branch (`regulatory-ingest/route.ts:186-201`) now does:
```ts
await db.notification.create({
  data: {
    // @ts-ignore — accountId is nullable for platform notifications
    accountId: null,
    userId: "system",
    message: ...,
    type: "regulatory_alert",
  },
});
```
`Notification.accountId` is **not** nullable — `prisma/schema.prisma:689` (`accountId String`, FK `onDelete: Cascade`), enforced at the DB level by `prisma/migrations/20260812040000_shipment_matching_and_notifications/migration.sql:4` (`"accountId" TEXT NOT NULL`) and by an FK constraint. The `@ts-ignore` suppresses the compile-time error but not the Prisma Client runtime validation or the Postgres `NOT NULL`/FK constraint — this call **will throw**. There is also no seeded `User` with id `"system"`, so even if the `accountId` issue were fixed the FK to `User` would still fail. Unlike the identical pattern in `data-dispatcher/route.ts:61-68` (same `accountId: null` shape, but wrapped in `try { } catch (_) {}`), this call in `regulatory-ingest` is **not** wrapped in a try/catch and sits inside a `for (const doc of documents)` loop with no per-iteration guard, so it throws on the first `actionRequired` document, aborting the ingest run for the rest of that batch. `data-dispatcher`'s own try/catch around the outbound `fetch` means this doesn't crash the dispatcher itself — it just marks `regulatory-ingest` `FAILED` in `DatasetRefreshLog` and no notification is ever actually delivered.

**Net verdict**: the cross-tenant data leak (the severe finding) is fixed and tested. A new availability bug (uncaught exception on the only reachable code path, whenever an actionRequired update is found) was introduced by the same change. Recommend: wrap the `accountId === null` branch in try/catch (matching `data-dispatcher`'s pattern) and fix the `Notification.accountId`/`userId` values to reference a real platform-level target, or add a nullable `accountId` migration if genuinely platform-wide notifications are intended.

---

## F09 Capability A — Duty Opportunity Detection

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1 Remove heuristics, empty-list message | DONE | FIXED | `src/app/api/refunds/opportunities/scan/route.ts:29-36` returns the exact required message; the `0.4`/`0.15`, and the previously-relocated `0.075`/`0.028` multipliers, are gone entirely — every `RefundOpportunity` created in this route now sets `estimatedRefundAmount: null`. | — |
| A-2 `opportunityTypes.ts` enum | DONE | UNCHANGED-DONE | `src/lib/refunds/opportunityTypes.ts:1-8`. | — |
| A-3 Real per-line-item checks, all 6 types | PARTIAL | FIXED (mostly) | All 6 types are now implemented in `scan/route.ts:52-246`: `SECTION_301_EXCLUSION` queries real `HtsDutyRate` (line 68-76); `TRADE_AGREEMENT` calls `determineOrigin` from F06 across a real country→agreement map (line 110-166), not just USMCA; `CLASSIFICATION_REVIEW` is still not implemented (no AI-driven GRI comparison found); `FIRST_SALE` uses a crude keyword match (`description.includes("factory"/"middleman")`, line 170) rather than real multi-tier transaction detection; `DUTY_DRAWBACK` and `AD_CVD_SCOPE_EXCLUSION` are real (lines 194-245). | Implement `CLASSIFICATION_REVIEW`; replace `FIRST_SALE` keyword heuristic with real transaction-chain data once available. |
| A-4 `estimatedRecovery` nullable, null until confirmed | DONE | FIXED | `prisma/schema.prisma:1042` — `estimatedRefundAmount Decimal?` is now nullable, and every creation site in `scan/route.ts` sets it to `null`. | — |
| A-5 Recovery UI ranking incl. deadline | DONE | FIXED | `src/app/app/vault/VaultClient.tsx:183-197` — sort is now amount DESC → confidence DESC → deadline ASC, all three keys present. | — |
| A-6 Vitest: exclusion match/no-match/status transitions | PARTIAL | FIXED (weak) | `tests/unit/refundOpportunities.test.ts` now exists and passes, covering null-until-confirmed and ranking order. But it never imports the real route handler or `opportunityTypes` module — it calls the **mocked** `db.refundOpportunity.create`/`.update` directly with hand-constructed data and re-implements the sort logic inline, so it doesn't actually exercise `scan/route.ts`'s matching logic. | Rewrite to invoke the actual `POST` handler (as `tests/phase4-regulatory.test.ts` correctly does for the cron) rather than re-simulating its behavior. |

## F09 Capability B — Drawback Matching (Lot Inventory)

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1 `DrawbackLot` model | DONE | UNCHANGED-DONE | `prisma/schema.prisma:3871-3891` (renumbered lines but same shape). | — |
| B-2 Lot creation on filing ACCEPTED | DONE | FIXED | `src/lib/canonicalMessaging/inboundConsumer.ts:73-80` now calls `DrawbackService.createDrawbackLotsFromFiling(filing.id)` when `newFilingStatus === "Accepted"`, wrapped in try/catch so a lot-creation failure doesn't block the inbound-message flow. This is a real, reachable call site (inbound canonical filing responses), not dead code. | — |
| B-3 `POST /api/drawback/match`: transaction, FIFO, Decimal, 422 | DONE | FIXED | `src/modules/drawback/drawback.service.ts:161-166` now throws `InsufficientLotQuantityError` when `qtyNeeded > 0` after exhausting lots, and `src/app/api/drawback/match/route.ts:43-44` maps it to a 422 `INSUFFICIENT_QUANTITY` response — the prior audit's "we do not fail match run" behavior is gone. Serializable transaction and FIFO ordering unchanged (still real). | — |
| B-4 Statutory 99% rate | DONE | UNCHANGED-DONE | `drawback.service.ts:135`. | — |
| B-5 CBP claim number, real HTS lookup instead of `2.8%`/`List3` | PARTIAL | FIXED (mostly) | `createDrawbackLotsFromFiling` (`drawback.service.ts:32-97`) now calls `loadHtsCodesMap` + `calculateDutyStack` per line item (line 47-60) — the hardcoded `"2.8%"`/`"List3"` from the prior audit is gone from the primary path. One residual fallback remains: `section301List: htsRateInput?.section301Tranche || (stack.section301.greaterThan(0) ? "List3" : null)` (line 88) still defaults to `"List3"` when a real tranche isn't resolvable — a narrower version of the same anti-pattern, but only hit as a last-resort default rather than unconditionally. Claim number format still uses `DBK-{filerCode}-{year}-{seq}` (cosmetic prefix deviation, unchanged). Schema still ships a fake-looking default: `prisma/schema.prisma:1140` — `cbpClaimNumber String? @default("DBK-2026-9901")`, unchanged from prior audit. | Resolve the `"List3"` fallback from real Section 301 tranche data instead of assuming List 3; remove the schema-level fake default. |
| B-6 Claim workflow state machine, broker-only submit | DONE | FIXED | A real workflow engine now exists: `src/modules/drawback/drawbackClaimWorkflow.ts` — `CLAIM_TRANSITIONS` implements `Draft→Prepared→Submitted→{Accepted,Rejected}→Paid`/`Draft`, enforces broker-only `Submitted` transition (line 51-59, checks `isBroker` or `filings.transmit`/`broker.approve` permission, 403 otherwise), and audit-logs every transition. `src/app/api/drawback/claims/[id]/route.ts:56-69` now calls `transitionDrawbackClaim` instead of unconditionally blocking every status change. The prior "State mutations must be performed via the workflow engine" 403-with-no-engine bug is resolved. Minor: the audit action logged for every transition is `AuditAction.DRAWBACK_CLAIM_CREATED` (`drawbackClaimWorkflow.ts:80`) rather than a transition-specific action — misleading audit trail. | Add a dedicated `DRAWBACK_CLAIM_STATUS_CHANGED` audit action. |
| B-7 Drawback UI section | PARTIAL | **NEW violation found** | `VaultClient.tsx:88-117` — `loadDrawbackData()` fetches real `DrawbackClaim` rows from `/api/drawback/claims`, but the lots table is populated by `setLots([...])` with two **hardcoded, fabricated** lot objects (`entryNumber: "ENT-2026-000001"`, `exportDeadline: "2031-08-13"`, etc.) — the code comment literally says `// Fetch mock/available lots for layout representation` (line 97). There is no `GET /api/drawback/lots` endpoint anywhere in the codebase (`src/app/api/drawback/` only has `match`, `claims`, `claims/[id]`) — so even a correctly-wired frontend has no real data source to call. The now-working B-2 pipeline creates real `DrawbackLot` rows, but the UI never shows them; users see fake demo data regardless of what's actually in the database. | Add `GET /api/drawback/lots` (accountId-scoped) and wire `VaultClient` to it, removing the hardcoded array. |
| B-8 Vitest: FIFO, 422, 99%, concurrency | PARTIAL | FIXED (mostly) | `tests/unit/drawback.test.ts:91-178` now covers strict FIFO ordering and asserts `InsufficientLotQuantityError` is thrown on over-allocation (previously untested). No dedicated concurrent-exactly-one-wins test found. | Add a concurrency test. |

## F09 Capability C — Section 301 Refund Readiness

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1 Tag `FilingSnapshot`/`DrawbackLot` with `hasSection301`/`section301List` | DONE | FIXED | `src/modules/filings/filing.service.ts:260-271` — `hasSection301`/`section301List` are now computed from the already-computed `tariff.lineResults` and written into `filingSnapshot.upsert`'s `update`/`create` data. The prior audit's "never set, permanently false" bug is resolved on the primary write path. | — |
| C-2 `GET /api/refunds/section301` readiness inventory | DONE | FIXED | `src/app/api/refunds/section301/route.ts` unchanged logic-wise, but now actually returns non-zero data in production because C-1 populates the field it depends on. | — |
| C-3 Auto-create `RefundOpportunity` on exclusion grant | MISSING | STILL BROKEN | A new `src/modules/tradeRate/tradeRateReviewService.ts` review-gate workflow exists for approving `Section301Exclusion` rows (PENDING→APPROVED), but approval never triggers a `RefundOpportunity` creation — `grep` for `refundOpportunity.create` shows only the manual `scan` route (`src/app/api/refunds/opportunities/scan/route.ts:88,148,176,202,228`) as call sites. | Wire `reviewRate("SECTION_301_EXCLUSION", "APPROVE", ...)` to find affected entries and create `RefundOpportunity` rows. |
| C-4 Section 301 panel UI | DONE | UNCHANGED-DONE | `VaultClient.tsx` renders `section301Stats` from the now-working `/api/refunds/section301` endpoint. | — |

## F09 Capability D — PSC Eligibility Workflow

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1 Remove `origDuty * 0.7`, 422 | DONE | UNCHANGED-DONE | `src/app/api/refunds/psc/route.ts:79-81`. | — |
| D-2 `checkPscEligibility` rules incl. PSC window | DONE | FIXED | `src/lib/refunds/pscEligibility.ts:43-47` now checks the `PSC_WINDOW` `ComplianceDeadline` (real expiration check against `dueAt`), which is possible now because D-6 actually creates that deadline. Drawback-claim block and status check are unchanged/correct. | — |
| D-3 PSC types enum | DONE | FIXED | `src/app/api/refunds/psc/route.ts:12-16` — `PscCorrectionTypeEnum` is now a real Zod enum of the 4 spec'd types (previously an unconstrained free-form string). | — |
| D-4 PSC impact via `dutyEngine`, Decimal | DONE | FIXED | `psc/route.ts:7-9,88-103` now imports `Decimal`/`roundToCents`/`calculateDutyStack` and computes `refundAmountDec = roundToCents(Decimal.max(0, origDutyDec.minus(corrDutyDec)))`; when `correctedHtsCode` is supplied it recomputes via `calculateDutyStack` with a real HTS lookup (line 90-99). Plain `number`/`Math.max` are gone. | — |
| D-5 PSC workflow UI in filing detail | MISSING | STILL BROKEN | `grep` for "Post-Summary Correction"/`correctionType` under `src/app/app/shipments` returns nothing — no dedicated PSC tab exists in filing detail. The API layer (D-1 through D-4) is solid but has no first-class UI entry point beyond the Recovery/reconciliation pages. | Build the filing-detail PSC tab. |
| D-6 `ComplianceDeadline` `PSC_WINDOW` on acceptance | DONE | FIXED | `src/lib/canonicalMessaging/inboundConsumer.ts:82-103` creates a `PSC_WINDOW` deadline (300 days from acceptance) when a filing transitions to `Accepted`, idempotently (checks `existingDeadline` first). | — |
| D-7 Vitest: eligible/ineligible/expired-window/Decimal impact | PARTIAL | FIXED (mostly) | `tests/unit/pscEligibility.test.ts` now covers eligible-with-open-window, PSC-window-expired, and active-drawback-claim cases (new vs. prior audit, which only had eligible/drawback-blocked). No dedicated test asserts the Decimal-based refund amount from D-4. | Add a Decimal-impact-specific test. |

## F09 Capability E — Reconciliation Management (Entry-Level)

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1 `issueType` distinguishing 3 types | PARTIAL | FIXED (partially) | The field is now genuinely read and filtered on in a real UI (`src/app/app/reconciliation/ReconciliationClient.tsx:41-53,140-143`), a real step forward from "never read or set anywhere" in the prior audit. **But** nothing in the codebase ever creates a `ReconciliationIssue` with `issueType: "ENTRY_DISCREPANCY"` or `"PSC_CANDIDATE"` — every creation site (`src/app/api/shipments/[id]/reconcile/route.ts:83`, `src/app/api/reconcile/route.ts:83`, `src/app/api/documents/[id]/field-review/route.ts:162`, `src/app/api/documents/[id]/reprocess/route.ts:118`) omits `issueType` from the `data` object entirely, so every row gets whatever the Prisma schema default is (`DOCUMENT_CONFLICT`, per F03's cross-document engine). In practice, `PSC_CANDIDATE`/`ENTRY_DISCREPANCY` rows never exist, so the "Convert to PSC" button (gated on those two types) is unreachable in the live app. | Add a real entry-discrepancy/post-audit creation path that sets `issueType: "ENTRY_DISCREPANCY"` or `"PSC_CANDIDATE"`. |
| E-2 "Convert to PSC" action | DONE (code) / unreachable (data) | FIXED, but see E-1 | `src/app/api/reconciliation/[id]/convert-to-psc/route.ts` is fully implemented — checks PSC eligibility, maps issue field to a `correctionType`, creates a `PostSummaryCorrection`, resolves the issue, audit-logs. **New Quality Standard #1 violation**: line 60 — `const corrDutyDec = origDutyDec.times(0.9); // Default estimated 10% duty adjustment on correction` — a brand-new hardcoded 10%-reduction multiplier, the exact anti-pattern (`0.4`/`0.15`/`origDuty*0.7`) the project plan explicitly called out to eliminate, now relocated into code that didn't exist at the prior audit. | Remove the `* 0.9` heuristic; derive the corrected duty from the actual discrepancy data (expected vs. actual value/HTS/quantity) via `dutyEngine`, not a fixed 10% assumption. |
| E-3 Deadline tracking | DONE | FIXED | `ReconciliationClient.tsx:170-178` — computes `isNearLiquidation` from the real `PSC_WINDOW` `ComplianceDeadline` (`dueAt` within 30 days) and renders a badge. | — |
| E-4 Reconciliation management page | PARTIAL | FIXED (mostly) | `src/app/app/reconciliation/page.tsx` + `ReconciliationClient.tsx` is a real, dedicated page (previously entirely absent) with type/status filtering and per-type counts. Missing: financial-exposure display and sort-by-exposure/deadline-proximity from the spec — only filters exist, no sorting control. | Add exposure amount + sortable columns. |

---

## F10 Capability A — Regulatory Monitoring

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1 Federal Register ingest, daily, no mock fallback | PARTIAL | FIXED (mostly) | `regulatory-ingest/route.ts:30-47` — the hardcoded mock Federal Register document fallback (prior audit's `document_number: "2026-10001"`) is **gone**; a fetch failure now returns an honest 502. It's genuinely scheduled now, indirectly: `regulatory-ingest` is registered as a `readinessStatus: "LIVE"` dataset (`src/lib/data/datasetRegistry.ts:56-67`, `scheduledFrequencyHours: 24`) dispatched daily by `data-dispatcher` (registered in `vercel.json`, 02:00 UTC). Still not an Inngest function (plain Next.js route), per prior audit — acceptable given the "use Inngest steps for duration, not cron-count" pattern isn't strictly required here. | — |
| A-2 AI structured extraction | PARTIAL | UNCHANGED (partially improved) | Still uses Google Gemini (`@google/genai`, line 4), not "Claude API" as the spec states — same deviation as prior audit. The keyword-heuristic fallback (used when `GEMINI_API_KEY` is unset) no longer hardcodes a fake `affectedHtsCodes: ["9903.88.67"]` — it now extracts real HTS-shaped substrings via regex (`route.ts:105-108`), a genuine fix to the fabricated-data part of this task. | Confirm with the user whether Gemini-vs-Claude is intentional. |
| A-3 Notifications scoped to `regulatory.review` permission | PARTIAL | FIXED, but see Severity-1 finding above | The unfiltered `findMany()` cross-tenant leak is fixed and tested for the `?accountId=` path. The no-`accountId` path (the only one actually reachable in production) throws at runtime on `Notification.accountId: null` (non-nullable FK) — see top-of-document finding. | Fix the platform-notification fallback to not violate the `Notification` schema; add try/catch. |
| A-4 Regulatory updates feed page | PARTIAL | UNCHANGED | `src/app/app/regulatory/page.tsx` + `RegulatoryClient.tsx` exist, wired to impact-analysis/impacted endpoints. Filter functionality not independently re-verified this pass — no evidence of change either way. | Confirm filters. |
| A-5 `hts-refresh` writes `HtsChange` + `RegulatoryUpdate` | MISSING | **REGRESSED** (was DONE) | `src/app/api/cron/hts-refresh/route.ts:50-54` — the block that used to write `HtsChange`/`RegulatoryUpdate` rows is now **removed entirely**, replaced with a comment: "Real release-to-release diffing ... is not implemented yet. Previously this block wrote a hardcoded, fabricated HtsChange + RegulatoryUpdate on every refresh ... that was worse than reporting nothing." This is the right call per Quality Standard #1 (an honest gap beats fake data) but it is a functional regression from the prior audit's DONE rating — no code path anywhere creates `HtsChange` rows anymore (`grep` confirms zero writers), which starves the otherwise-fixed F10-B-1 rate-delta computation (below) of real data in production. | Implement real release-to-release diffing so `HtsChange` (and therefore duty-delta calculations) have real data to work from. |
| A-6 Vitest: FR parsing, notification, idempotent duplicate | DONE | FIXED | `tests/phase4-regulatory.test.ts` now genuinely exercises the `regulatory-ingest` route's `POST` handler (imports and calls it directly) for FR parsing, idempotent-duplicate skipping, and the fixed `accountMembership` filter — a real improvement from the prior audit's "no test exercises this route" finding. Does not cover the no-`accountId` crash path (see Severity-1 finding). | Add a test for the no-`accountId` invocation path — it would have caught the crash bug above. |

## F10 Capability B — Product-Level Policy Impact

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1 Impact engine: real Decimal duty delta | PARTIAL | FIXED (code), starved of data | `src/lib/regulatory/impactAnalysis.ts:75-114` — the hardcoded 1.7% (`rateDelta = new Decimal(0.017)`) is **gone**. Real delta is now computed from `db.htsChange.findMany({ where: { changeType: "RATE_CHANGED" } })`, parsing `oldRate`/`newRate` per HTS code and defaulting to `0` (honest empty, not fake) when unspecified. This is a genuine, correctly-implemented fix. Its real-world effectiveness is limited by the A-5 regression above — since nothing writes `HtsChange` rows anymore, `estimatedDutyDelta` will be `0` for every regulatory update in the live app until A-5 is re-implemented. | Re-implement A-5's real diffing to feed this engine. |
| B-2 Async via Inngest, `COMPUTING`/`COMPLETE` | PARTIAL | UNCHANGED | Still synchronous, always returns `COMPLETE` — same as prior audit. | Acceptable per prior audit's own note unless latency becomes a real problem. |
| B-3 `GET /api/regulatory/[id]/impacted`, paginated | DONE | UNCHANGED-DONE | Unchanged from prior audit. | — |
| B-4 Impact Analysis UI tab | DONE | UNCHANGED-DONE | Unchanged. | — |
| B-5 `ExceptionItem` creation | DONE | UNCHANGED-DONE | Unchanged. | — |
| B-6 Vitest: HTS match, Decimal delta, no-impact case | DONE | FIXED | `tests/unit/regulatory.test.ts:66-98` no longer encodes the fake `0.017`/`170` values as expected output — now asserts a real computed delta (`10000 * (5.8%-2.8%) = 300`, lines 66-84) and a real zero-impact case for HTS codes without a rate change (line 98). This directly fixes the prior audit's "test locks in the bug" finding. | — |

## F10 Capability C — Tariff Scenario Modeling

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1 `htsReleaseId` + `dutyStack Json` | DONE | UNCHANGED-DONE | `prisma/schema.prisma:1000,1027`. | — |
| C-2 Scenario dimensions incl. `manufacturer`/`tradeAgreementClaim` | DONE | FIXED | `prisma/schema.prisma:995-996` (on `LandedCostScenario`) and `1021-1022` (on `LandedCostScenarioLineItem`) — both fields now exist, previously entirely missing. | — |
| C-3 Create/calculate via `dutyEngine`, no static multipliers | DONE | FIXED | `src/app/api/simulator/scenarios/[id]/calculate/route.ts:46-72` now calls `loadHtsCodesMap` per line item and passes the real `DutyRateInput` into `computeLandedCost`. The previously-reported disconnect (line-items route real, calculate route hardcoded) is resolved — `grep` for `"2.8%"`/`generalDutyRate`/`section301Tranche`/`List3` in `landedCost.ts` and `calculate/route.ts` now returns nothing. | — |
| C-4 `POST /api/simulator/compare` | DONE | UNCHANGED-DONE (now rate-accurate) | Same route, but numbers underneath are now real per C-3's fix. | — |
| C-5 Scenario UI page | DONE | UNCHANGED-DONE | — | — |
| C-6 Real "HTS Release [date]" label | DONE | FIXED | `src/app/api/simulator/scenarios/route.ts:46` sets `htsReleaseId: publishedRelease?.id` at scenario creation; `calculate/route.ts:30-43,130-131` resolves and persists the real `htsRelease` and returns its actual `effectiveFrom` date (`htsReleaseEffectiveFrom`). Previously a hardcoded literal `"HTS Release v1"`. | — |
| C-7 Link approved scenario to `Shipment.scenarioId` | DONE | FIXED | `prisma/schema.prisma:423-424` now has `Shipment.scenarioId`; a real endpoint `src/app/api/simulator/scenarios/[id]/approve/route.ts` sets scenario `status: "Approved"` and links `shipment.scenarioId`, tenant-scoped and audit-logged. Previously the field didn't exist at all. | — |
| C-8 Vitest: USMCA zero-rate, non-claim full-rate, compare delta | MISSING | STILL BROKEN | No test file directly exercises scenario creation/calculation with a `tradeAgreementClaim`, despite the field now existing (C-2). | Write the specified test — no longer blocked by a missing schema field. |

## F10 Capability D — Landed-Cost Simulation

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1 `LandedCostBreakdown` interface | DONE | UNCHANGED-DONE | `src/lib/tariff/landedCost.ts:4-19`. | — |
| D-2 `computeLandedCost()` real HTS rates, all Decimal | DONE | FIXED | `landedCost.ts:38-104` — the hardcoded `generalDutyRate: "2.8%"`/`section301Tranche: "List3"` is gone; `calculateDutyStack` is now called with the real `DutyRateInput` passed in from the caller (see C-3). | — |
| D-3 Waterfall UI, client-side Decimal recompute | PARTIAL | FIXED (partially) | `src/app/app/simulator/page.tsx:135-151` — the client "real-time" calc now primarily derives `baseDutyPct` from the server-computed `data.dutyStack.base/totalVal` (line 149), with `0.028`/`0.075` only as **fallback defaults** when server data isn't yet loaded, versus the prior audit's unconditional hardcode. Still uses plain floats (`Decimal` only wraps the final multiply at line 170, not the whole chain) rather than Decimal throughout. | Use Decimal end-to-end; confirm no case silently keeps the fallback default. |
| D-4 Alternative-sourcing breakeven | PARTIAL | FIXED (server), residual client issue | A real `calculateSourcingBreakeven()` function now exists (`src/lib/tariff/landedCost.ts:110-134`), comparing two full `LandedCostBreakdown`s and deriving a genuine crossover volume; it's wired into `src/app/api/simulator/compare/route.ts:107`. This directly replaces the prior audit's arbitrary `(freight*1.5)/0.075` formula for the real comparison endpoint. The standalone client-side estimate in `simulator/page.tsx:187` (`Math.round((freight * 1.5) / (section301Pct > 0 ? section301Pct : 0.075))`) still uses the old arbitrary formula — likely a leftover quick-preview value now superseded by the real `/compare` endpoint, but still present and potentially shown to users. | Remove or replace the leftover client-side arbitrary breakeven formula with a call to the real endpoint. |
| D-5 Vitest: full components, per-unit at varying qty, FOB | DONE | FIXED | `tests/unit/regulatory.test.ts:145-179` now includes a varying-quantity per-unit test (qty=10 vs. qty=1000, asserts perUnit decreases) — the prior audit's missing case. | — |

---

## Cross-cutting Quality Standards violations found

1. **No fake data, ever (Standard #1)** — substantially improved, but not eliminated:
   - **NEW**: `src/app/api/reconciliation/[id]/convert-to-psc/route.ts:60` — `origDutyDec.times(0.9)` ("Default estimated 10% duty adjustment"), a brand-new instance of the exact anti-pattern the plan targeted, in code that didn't exist at the prior audit.
   - **NEW**: `src/app/app/vault/VaultClient.tsx:97-117` — hardcoded fake `DrawbackLot` array shown in the Recovery UI regardless of real data (`// Fetch mock/available lots for layout representation`); no backing API endpoint exists.
   - FIXED: `opportunities/scan/route.ts` (0.075/0.028 gone), `drawback.service.ts` (2.8%/List3 mostly gone, one fallback remains), `landedCost.ts`/`calculate/route.ts` (2.8%/List3 gone), `regulatory-ingest/route.ts` mock FR document fallback (gone, honest 502 instead), `regulatory-ingest/route.ts` fake `9903.88.67` fallback (now real regex extraction), `impactAnalysis.ts` fake 1.7% delta (gone, real computation).
   - **REGRESSED (functional, not a fake-data reintroduction)**: `hts-refresh/route.ts` no longer writes any `HtsChange`/`RegulatoryUpdate` data (previously fake, now correctly absent, but this starves the now-fixed `impactAnalysis.ts` of real input).
   - Still present, unchanged: `prisma/schema.prisma:1140` `cbpClaimNumber @default("DBK-2026-9901")`.

2. **Money is always Decimal.js (Standard #2)** — FIXED at both previously-flagged sites: `psc/route.ts` now uses `Decimal`/`roundToCents`/`dutyEngine` throughout; `simulator/page.tsx` client calc still mixes plain floats with a late Decimal wrap (residual, minor).

3. **Tenant isolation (Standard #3)** — the critical unfiltered `findMany()` in `regulatory-ingest/route.ts` is fixed and tested. See Severity-1 finding for the new bug introduced in its place (not a tenant-isolation violation, but a fresh availability bug in the same code).

4. **One Vitest test per capability (Standard #4)** — meaningfully improved: F09-A now has a test (though weak — doesn't call real route code), F09-D has an expanded eligibility test, F10-A now has a real regulatory-ingest test, F10-B's test no longer encodes the fake rate as ground truth. Still missing: F09-E (reconciliation), F10-C-8 (USMCA scenario/compare).

5. **`any` types (Standard #7)** — improved: `impact-analysis/route.ts` and `impacted/route.ts`'s `as any` casts are gone; `regulatory-ingest/route.ts:64` (`let extracted: any`) remains.

6. **Pagination (Standard #8)** — unchanged: `GET /api/simulator/scenarios` and `GET /api/refunds/psc` are still unbounded `findMany` with no cursor/limit.

7. **Idempotency-Key (Standard #9)** — unchanged: present on `drawback/match` and `drawback/claims`; still absent on `refunds/opportunities/scan` and `refunds/psc`.

## Top 5 fixes ranked by severity

1. **The platform-notification fallback in `regulatory-ingest/route.ts` throws at runtime on its only reachable invocation path** (`accountId: null` against a non-nullable FK column, plus a non-existent `userId: "system"`). This sits directly behind the fix for the prior audit's #1 finding — the cross-tenant leak is genuinely resolved, but the replacement code is unreachable-without-crashing in production, silently failing the daily `data-dispatcher`-triggered run whenever an actionRequired update is found. Wrap in try/catch (matching `data-dispatcher`'s own pattern) and use a schema-valid target for platform-level alerts.
2. **`hts-refresh` no longer writes `HtsChange` rows at all** (`src/app/api/cron/hts-refresh/route.ts:50-54`), which is the right call per Quality Standard #1 (the old code fabricated them) but means the otherwise well-fixed `impactAnalysis.ts` real-rate-delta computation (F10-B-1) has no real data source in production — it will report `$0` duty exposure for every regulatory update until real release-to-release diffing is implemented.
3. **Two brand-new fake-data instances were introduced in code that didn't exist at the prior audit**: `convert-to-psc/route.ts:60`'s `* 0.9` heuristic duty adjustment, and `VaultClient.tsx`'s hardcoded `DrawbackLot` array (with no backing API) shown in the user-facing Recovery UI regardless of the now-real `DrawbackLot` data the fixed B-2 pipeline actually produces.
4. **F09 Capability E (Reconciliation)'s "Convert to PSC" flow is built but structurally unreachable** — the UI/API exist and work correctly when invoked, but nothing in the codebase ever creates a `ReconciliationIssue` with `issueType: "ENTRY_DISCREPANCY"` or `"PSC_CANDIDATE"` (every creation site omits `issueType`, so rows default to `DOCUMENT_CONFLICT`), so the feature is dead in practice despite looking complete in the code.
5. **Residual data-quality gaps in otherwise-fixed areas**: `drawback.service.ts:88`'s `"List3"` fallback default when a real Section 301 tranche can't be resolved, and `simulator/page.tsx:187`'s leftover arbitrary breakeven formula that coexists with the now-correct server-side `calculateSourcingBreakeven()`. Neither blocks the core feature the way items 1-4 do, but both are lower-confidence numbers a user could see.

**Overall assessment**: this is a substantial, genuine second pass — nearly every task flagged MISSING or PARTIAL in the prior audit that involved a hardcoded multiplier or dead wiring has been fixed with real computation (dutyEngine/Decimal/real HTS lookups), not just relabeled. The severe cross-tenant notification leak is fixed and tested. The regressions found (A-5's removed HtsChange writer, the new notification-crash bug, two freshly-introduced fake-data instances) are all lower-severity than what was fixed, but they are real and adversarially verifiable — this audit found them by tracing each "fixed" code path to its actual runtime behavior rather than trusting that a hardcoded literal's absence meant the feature worked end-to-end.
