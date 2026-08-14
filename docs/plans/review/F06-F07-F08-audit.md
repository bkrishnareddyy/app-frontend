# F06 Origin/Valuation/Tariff + F07 Filing & Entry + F08 Audit & Governance — Audit
> Re-audited: 2026-08-13 (second pass, compares against prior audit of same date)

F06 Overall readiness: 87% (previously 65%)
F07 Overall readiness: 88% (previously 80%)
F08 Overall readiness: 80% (previously 52%)

**Headline finding: the three most severe legal-risk items from the prior audit are now genuinely fixed.**

1. `src/app/api/audit/export/route.ts:88-117` no longer returns a fabricated Vercel Blob URL. It now calls the real `put()` from `@vercel/blob`, uploads the actual export payload, and returns `blob.url` from that real upload. If `BLOB_READ_WRITE_TOKEN` is unset, it now returns an honest `501 "not implemented"` instead of a fake link (line 88-94), and if the upload throws it returns a real `500` (line 105-111). Verified: no hardcoded `vercel-blob.qubere.ai` string remains anywhere in the file.
2. `src/lib/audit/reasonableCarePackage.ts` no longer hardcodes `"CBP-99-1234567"`, fake GRI steps, fake confidence, zeroed valuation, or a fake signature. `assembleReasonableCarePackage` (lines 86-289) now genuinely queries `ClassificationCase` → `runs.proposals.griSteps`/`evidenceItems` for real GRI reasoning and ruling citations (lines 126-161), the real `reviewerUserId` → `User` for the approver name (lines 163-175), `ImporterOfRecord.cbpImporterNumber` for the real CBP number (line 275, `?? null` if missing — not a fabricated fallback), and the real `ValuationAssistsRecord` for assists/related-party data (lines 192-217). `certifications` is now an honest empty array (line 287) rather than a fake `"DIGITALLY_SIGNED_QUBERE"` entry.
3. `src/lib/audit/focusedAssessment.ts` now makes a real Anthropic API call for the "AI-generated" remediation narrative (lines 169-207, `client.messages.create(...)`), only falling back to a clearly-generic template if `ANTHROPIC_API_KEY` is unset or the call fails (lines 209-215) — this is now an honest best-effort AI narrative, not a mislabeled static template. The importer `cbpNumber`/`address` are now sourced from `ImporterOfRecord` (lines 148-166) and render as empty strings, not `"CBP-99-1234567"` / a fabricated LA address, when no importer record exists.

These were the audit's own definition of "worst possible finding," and all three are resolved with real implementations, not just partial mitigations.

---

## F06 Capability A — Origin Determination Engine

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1 Remove auto-create-on-read | DONE | UNCHANGED-WAS-ALREADY-DONE | `src/app/api/advisory/origin-determination/route.ts` still looks up, doesn't auto-create. | none |
| A-2 `originEngine.ts` pure function | DONE | UNCHANGED | `src/lib/origin/originEngine.ts` unchanged, still real logic. | none |
| A-3 Seed `trade-agreements.json` | PARTIAL | FIXED (expanded) | `prisma/seed-data/trade-agreements.json` grew from 94 → 160 lines. Still far short of full Annex 4-B, but more chapters than before. | Continue expanding chapter coverage. |
| A-4 `POST /api/advisory/origin-determination` | DONE | FIXED | Route now calls `createAuditLog` (confirmed via `AuditAction.` usage grep hit on this file) — closes the prior cross-cutting gap noted for this route. | none |
| A-5 UI + <80% confidence → ExceptionItem | DONE | UNCHANGED | Same logic as before. | none |
| A-6 Re-run on `productCountryFact.updated` | PARTIAL | FIXED (not via Inngest) | `src/modules/product/productService.ts:973-981` and `:1038-1044` now call `reevaluateProductLineItems()` (imported from `src/app/api/cron/origin-re-eval/route.ts`) synchronously and directly after `ProductCountryFact` create/review — functionally equivalent event-driven re-run, just implemented as a direct call rather than an Inngest event trigger. | Plan says "Inngest event," codebase uses direct invocation — acceptable substitute; document the discrepancy in the plan. |
| A-7 Vitest | DONE | UNCHANGED | `tests/unit/originEngine.test.ts`, `tests/origin-determination-api.test.ts` still present. | none |

## F06 Capability B — Trade Agreement Qualification

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1 `POST /api/v1/trade-agreements/qualify` | DONE | FIXED | Route now appears in the `AuditAction.` usage grep — `createAuditLog` is wired in, closing the prior gap. | none |
| B-2 Missing-evidence identification | DONE | UNCHANGED | Same as before. | none |
| B-3 UI qualification tab | DONE | UNCHANGED | — | none |
| B-4 USMCA CO generation | DONE | UNCHANGED | — | none |
| B-5 Vitest | PARTIAL | UNCHANGED | Still no dedicated route-level test found. | Add one. |

## F06 Capability C — Customs Valuation Engine

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1 `valuationEngine.ts` with Decimal | DONE | UNCHANGED | Still Decimal-clean. | none |
| C-2 Assist categories + proration | DONE | FIXED | `src/lib/valuation/valuationEngine.ts:60` now branches: `assist.prorationMethod === "entire_shipment" ? unitCost : unitCost.times(qty)` — the field is now actually read, not dead. | none |
| C-3 Related-party test → ExceptionItem | DONE | UNCHANGED | — | Route audit-log gap also fixed (see C-4). |
| C-4 `POST /api/products/[id]/valuation` persistence | DONE | FIXED | `src/app/api/products/[id]/valuation/route.ts:82` now calls `db.valuationAssistsRecord.upsert({...})`. This directly refutes the prior "zero hits" finding — valuation input is now durably persisted. | Add a Vitest asserting round-trip persistence. |
| C-5 Valuation UI tab | DONE | FIXED | Since C-4 now persists, the tab is a durable record, not calculate-on-click. | none |
| C-6 Vitest | DONE | UNCHANGED | `tests/unit/valuationEngine.test.ts` still present. No new test added for the C-4 persistence path. | Add a persistence-round-trip test. |

## F06 Capability D — Duty-Stack Calculation

**This was the highest-severity F06 capability; it has seen the largest concentration of real fixes.**

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1 `DutyStack` interface + Decimal refactor | DONE | FIXED | `src/lib/tariff/dutyEngine.ts:350-429` — `computeFilingTariff` now accumulates every line's `customsValue`/`baseDutyAmount`/`section301Amount`/`section232Amount` via `Decimal` (`totalCustomsValueDec.plus(...)`, lines 365-368), not `+=`/`Math.round`. The `stack.base.gt(0)` bug (customsValue silently `$0` for duty-free lines) is gone — `calculateLineItemDuty` (lines 321-348) now derives `customsValue` independently from `totalValDec`/`qtyDec`×`priceDec`, never from `stack.base`. | none — verified against `filing.service.ts` call site, still the live path. |
| D-2 Section 301 rates seeded/tracked | PARTIAL | FIXED (structurally) | `HtsDutyRate` (`prisma/schema.prisma:2034-2059`) now has `rateType`, `trancheId`, `exclusion`, `caseNumber`, `manufacturer`, `countryOfOrigin` fields — exactly what was missing before. `loadHtsCodesMap` (`dutyEngine.ts:205-311`) now does a real DB lookup for `rateType === "SECTION_301"` and populates `section301Tranche`/`section301AdditionalRate`/`section301Exclusion` from the row (lines 239-258), not a hardcoded switch. **However**, `prisma/seed.ts` only seeds **one** `SECTION_301` row (`grep -c "SECTION_301" prisma/seed.ts` → 1) — real machinery, sparse data, same "seed coverage" caveat the plan itself accepts for A-3/E-1. | Expand Section 301 seed coverage beyond the single sample HTS row. |
| D-3 AD/CVD rates: caseNumber/manufacturer | PARTIAL | FIXED (structurally) | Same schema fix as D-2. `loadHtsCodesMap` now implements "most specific wins" (`resolveMostSpecific`, lines 272-293: exact manufacturer+country match → country-with-wildcard match → first-match fallback), reading real `HtsDutyRate` rows with `rateType: "ANTIDUMPING"/"COUNTERVAILING"`. `prisma/seed.ts` seeds exactly **one** AD row (case `A-570-601`) and **zero** CVD rows. AD/CVD is no longer silently `$0` by construction, but is still `$0` in practice for all but the one seeded HTS code. | Seed more AD/CVD case data; this is now a data-coverage gap, not an architecture gap. |
| D-4 `GET /api/v1/hts/codes/[code]/rates` | DONE | UNCHANGED mechanically, FIXED in substance | Same route, now returns genuinely-looked-up Section 301/AD/CVD data instead of hardcoded/zero values for HTS codes that have seed data. | none |
| D-5 `ShipmentLineItem.dutyStack` persisted | DONE | FIXED | `src/modules/shipment/lineItemReconciler.ts:178` and `src/app/api/shipments/[id]/route.ts` (`dutyStackJson`) now write to the `dutyStack` field on create/update. Prior "zero hits" finding is refuted. | none |
| D-6 Vitest | DONE | FIXED | `tests/unit/dutyEngine.test.ts` and `tests/phase2-suite.test.ts` (lines 89, 101, 112) now directly exercise `computeFilingTariff`, closing the prior gap that the float-aggregation path was untested (moot now since it's Decimal, but the coverage gap itself is closed). | none |

## F06 Capability E — AD/CVD Scope Screening

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1 `AdcvdOrder` model + seed | DONE | UNCHANGED | Same 57-line seed file as before. | Expand coverage. |
| E-2 `scopeScreening.ts` | DONE | UNCHANGED | — | none |
| E-3 AI scope analysis for "POSSIBLY" via Claude | DONE | FIXED | `src/lib/adcvd/scopeScreening.ts:35-66` now imports `Anthropic` and makes a real `messages.create` call with `model: "claude-3-5-sonnet-20241022"`, prompting for "GRI-style step-by-step reasoning" exactly as spec'd, with a clearly-logged fallback (`console.warn`, line 66) if the call fails. This directly refutes the prior "no Claude API call anywhere" finding. | none |
| E-4 Integration → `ExceptionItem` | DONE | UNCHANGED | — | Route audit-log gap now fixed (route appears in `AuditAction.` usage list). |
| E-5 AD/CVD UI section | DONE | UNCHANGED | — | none |
| E-6 Manual re-screen | DONE | UNCHANGED | — | Classification-change trigger still not independently re-verified. |
| E-7 Vitest | DONE | FIXED | `tests/unit/scopeScreening.test.ts` and `tests/adcvd/scopeScreening.test.ts` now exist (two test files, possibly one redundant), closing the prior "zero tests" gap. | Consolidate duplicate test file if genuinely redundant. |

---

## F07 Capability A — Automated 7501 Preparation

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1 Field mapping in `form7501.ts` | DONE | UNCHANGED-WAS-ALREADY-DONE | Still Decimal-clean. | none |
| A-2 Refactor `entry-summary` route | DONE | UNCHANGED-WAS-ALREADY-DONE | — | none |
| A-3 Entry-line provenance | DONE | UNCHANGED | — | none |
| A-4 7501 preview UI | DONE | UNCHANGED | — | none |
| A-5 7501 export (JSON + server PDF) | PARTIAL | STILL BROKEN | `package.json` still has no `@react-pdf/renderer`, `puppeteer`, `pdfkit`, `pdf-lib`, or `@sparticuz/chromium` — grep for all of these returns zero hits. JSON export still works; PDF still does not exist. | Add a server-side PDF renderer — this is now the single biggest remaining gap in F07. |
| A-6 Vitest | DONE | UNCHANGED | — | none |

## F07 Capability B — Pre-Filing Validation

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1 through B-4 | DONE | UNCHANGED-WAS-ALREADY-DONE | `filingValidator.ts`, `/validate`, `/transmit` server-side gate all re-verified present and unchanged. | none |

## F07 Capability C — Filing Readiness Gate

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1, C-2 | DONE | UNCHANGED | — | none |
| C-3 "File this entry" disabled not hidden | DONE | FIXED (now verified) | `src/app/app/filing/[id]/FilingDetailClient.tsx:449-454` — the "Transmit to Customs" button has `disabled={!canTransmit || busy !== null || validationBlockers.length > 0}` and a `title` tooltip (lines 440-446) that explicitly lists blockers (`Cannot transmit: ${validationBlockers.map(b => b.message).join("; ")}`). This closes the prior "not fully verified" item with a confirmed pass. | none |

## F07 Capability D — ACE/ABI Filing Integration

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1 through D-4 | DONE | UNCHANGED | — | none |
| D-5 Acknowledgment parsing + 15-min polling | PARTIAL | UNCHANGED IN SUBSTANCE | Still no dedicated 15-minute filing-status poll job. A new Inngest infrastructure now exists (`src/lib/inngest/`, real `dailyComplianceAudit` and `dailyWorkMetricSnapshot` jobs), so the *capability* to add a scheduled job now exists, but no filing-status-poll job was added. | Add an Inngest cron for filing status polling now that the Inngest plumbing exists. |
| D-6 Rejection → `ExceptionItem` | DONE | FIXED (now verified) | `src/lib/canonicalMessaging/inboundConsumer.ts:112-127` — genuinely creates an `ExceptionItem` with `category: "FILING"`, `blocking: true`, and a `requiredAction` when `data.status === "REJECTED"`. This closes the prior "not fully verified" item. | none |

## F07 Capability E — Filing Status Tracking

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1 Status timeline + AuditLog | DONE | FIXED | `src/app/app/filing/[id]/FilingDetailClient.tsx` now accepts an `auditLogs` prop (line 119) and renders it directly in the timeline (lines 542-560) alongside `stageDates`, rather than deriving purely from timestamp fields as before. | Did not verify "actor"/"notes" fields render on every row. |
| E-2 `GET /api/filing?status=...` paginated | DONE | FIXED | `src/app/api/filing/route.ts:38` now defaults `limit=50, max=200` — matches the global standard, closing the prior cross-cutting gap for this route specifically. | Still offset-based, not cursor-based. |
| E-3, E-4 | Not fully verified | UNCHANGED | Not re-traced this pass; time-boxed. | — |

## F07 Capability F — Continuous Compliance Monitoring

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| F-1, F-2 | DONE | UNCHANGED-WAS-ALREADY-DONE | — | none |
| F-3 Daily compliance cron | DONE | FIXED | `src/lib/inngest/functions/dailyComplianceAudit.ts` — a real, non-trivial Inngest function (`{ cron: "0 0 * * *" }`) that runs `runAuditChecks` against real filings/snapshots/bonds for every account, creates/updates `ComplianceFinding` rows (idempotent upsert-by-rule, lines 81-106), and writes a `createAuditLog` call with `AuditAction.COMPLIANCE_AUDIT_RUN` (lines 135-148). Wired into `src/app/api/inngest/route.ts`. This directly refutes the prior "no Inngest anywhere" finding. | Verify the Inngest app is actually registered/synced with Inngest Cloud or self-hosted dev server in the deployed environment — code exists but deployment wiring wasn't independently confirmed. |
| F-4, F-5 | DONE | UNCHANGED | — | none |

---

## F08 Capability A — Immutable Audit Trail

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| A-1 Audit coverage audit across all routes | PARTIAL | STILL BROKEN (proportionally) | Of 162 route files (up from 146) exporting POST/PATCH/DELETE, **89 still have zero `createAuditLog` call** (up from 80+, but the write-route count also grew). Coverage ratio is essentially unchanged: ~45% covered before, ~45% covered now (73/162). The specific F06 routes the prior audit called out by name (`products/[id]/valuation`, `products/[id]/adcvd-screen`, `v1/trade-agreements/qualify`, `advisory/origin-determination`) are now fixed and appear in the `AuditAction.` usage list — so the fix was targeted at the cited examples rather than a genuine full sweep. Remaining gaps include `parties/route.ts`, `products/route.ts`, `products/[id]/route.ts`, `shipments/[id]/route.ts`, all `cron/*` routes, `assistant/chat*`. | The task asked for a full sweep of all 146 (now 162) routes; still not done. Prioritize `products/[id]`, `shipments/[id]`, and `parties/*` next — these are the highest-traffic domain-write routes still unaudited. |
| A-2 Typed `AuditAction` enum | DONE | FIXED | `grep -rl "AuditAction\." src` (excluding the definition file) now returns **48 files** (was 0). The enum is genuinely wired into route handlers, service modules (`drawback.service.ts`, `partyService.ts`, `productService.ts`), and both new Inngest jobs. No longer dead code. | Some files still use freehand action strings alongside the enum (not all 100% converted) — acceptable partial per the "replace" language not being literal 100%. |
| A-3 Diff capture with redaction | DONE | FIXED | `src/lib/audit.ts` and `src/lib/audit/index.ts` now both reference `diffHelper` — `export { diff } from "./audit/diffHelper";` in `audit.ts` line 6. The helper is no longer orphaned; it's part of the public `audit` module surface. | Verify call sites actually invoke `diff()` when building `metadata` for PATCH routes (not independently traced this pass). |
| A-4 `GET /api/audit` query API | DONE | FIXED | `src/app/api/audit/route.ts` no longer has an `any`-typed `whereClause` — the prior `: any` annotation is gone from the file. | none |
| A-5 Append-only enforcement + RLS | DONE | FIXED | A real migration now exists: `prisma/migrations/20260814000000_audit_log_rls/migration.sql` — enables `ROW LEVEL SECURITY` on `"AuditLog"`, and (more robustly) creates a Postgres trigger `prevent_audit_log_mutation()` that `RAISE EXCEPTION`s on any `UPDATE OR DELETE` against the table. `src/lib/audit.ts:15-19` — `assertAppendOnlyAuditPolicy()` now actually throws for non-INSERT operations instead of unconditionally returning `true`. This is a genuine, enforced, DB-level append-only guarantee. | Confirm the migration has actually been applied to the production database, not just committed to the migrations folder (couldn't verify from static code alone). |
| A-6 Vitest (`DECISION_AUTO_APPROVED`) | Not independently re-verified | UNCHANGED | Time-boxed; not re-traced this pass. | Verify. |

## F08 Capability B — Reasonable-Care Record

**Previously the single most severe fake-data finding in F08. Now fixed.**

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| B-1 `ReasonableCarePackage` structure | DONE | UNCHANGED | — | none |
| B-2 Populate from real data, no synthetic data | DONE | FIXED (major) | See "Headline finding" #2 above. All six previously-fabricated fields (CBP number, GRI steps, approver, confidence, valuation zeros, fake signature) are now sourced from real models (`ClassificationCase`/`GriAnalysisStep`/`EvidenceItem`, `User`, `ValuationAssistsRecord`, `ImporterOfRecord`) or rendered as honest empty/null values. | none — this is the correct fix pattern (honest gaps, not invented data). |
| B-3 PDF export | MISSING | STILL BROKEN | No PDF library in `package.json` (same finding as F07-A5). Only JSON is returned. | Add server-side PDF rendering — shared fix would resolve this, F07-A5, and F08-D5 simultaneously. |
| B-4 `GET /api/audit/package/[shipmentId]` + completeness score | DONE | FIXED | `reasonableCarePackage.ts:259-268` — completeness score now genuinely reflects real data presence (non-empty classification array, `declaredCustomsValue > 0`, etc.) instead of scoring fabricated sections as "complete." | none |
| B-5 Trigger via UI + chat tool | DONE | FIXED (inherits B-2 fix) | `src/modules/assistant/tools.ts` still calls the same assembler, which is now real. | none |

## F08 Capability C — Audit Population Analytics

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| C-1 `WorkMetricSnapshot` model | DONE | UNCHANGED | — | none |
| C-2 `metricComputer.ts` | DONE | UNCHANGED | — | none |
| C-3 Daily Inngest job writing snapshots | DONE | FIXED | `src/lib/inngest/functions/dailyWorkMetricSnapshot.ts` — a real function (`{ cron: "0 1 * * *" }`) that iterates every account, calls `computeAnalyticsMetrics`, and `db.workMetricSnapshot.create(...)`s a row per account per day. This directly refutes the prior "permanently empty table" finding. Registered in `src/app/api/inngest/route.ts`. | Same deployment-wiring caveat as F07-F3 — confirm Inngest is actually synced in the live environment. |
| C-4 `GET /api/dashboard/metrics` | DONE | UNCHANGED | — | none |
| C-5 `CommandCenterClient.tsx` real data | DONE | FIXED (data now flows) | Since C-3 now populates the table, historical trend charts will have real data going forward instead of permanently `[]`. | none |
| C-6 Vitest | DONE | FIXED | `tests/metrics/metricComputer.test.ts` now exists, closing the prior "no test file" gap. | none |

## F08 Capability D — Focused Assessment Defense File

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| D-1 through D-4 | DONE | UNCHANGED | — | none |
| D-5 ZIP export + AI-generated narrative | PARTIAL | FIXED (narrative), STILL BROKEN (ZIP) | See "Headline finding" #3 above — the narrative is now genuinely AI-generated via a real Anthropic call with an honest fallback. However, `package.json` still has no `archiver`/`jszip`/`adm-zip` — no ZIP packaging exists anywhere. Importer CBP number/address fabrication is also fixed (sourced from real `ImporterOfRecord`). | Add real ZIP packaging — narrative fix is complete but the export format itself is still just a JSON object, not a ZIP. |
| D-6 Vitest | MISSING | STILL BROKEN | No dedicated test file for `focusedAssessment.ts`/defense-file assembly found in `tests/`. | Add tests. |

## F08 Capability E — Portable Compliance Record Export

**Previously the single worst finding in the entire review — a fabricated, non-functional download URL. Now fixed.**

| Task | Status | Change | Evidence | Gap / Fix needed |
|---|---|---|---|---|
| E-1 `POST /api/audit/export` → signed Blob URL | DONE | FIXED (major) | See "Headline finding" #1 above. Real `@vercel/blob` `put()` call, real upload, real `blob.url` returned, honest `501`/`500` on failure instead of a fabricated link. | Verify `BLOB_READ_WRITE_TOKEN` is actually configured in the production Vercel project — the code is correct, but if the token is unset in prod this now correctly fails loud (501) rather than silently faking success, which is the right failure mode. |
| E-2 OWNER-only access control | DONE | UNCHANGED | — | none |
| E-3 `MANIFEST.json` inside the ZIP | PARTIAL | PARTIAL (structure fixed, packaging still missing) | The `manifest` object is now genuinely accurate (real counts of real uploaded data), but the export is still a single `.json` file uploaded to Blob, not a ZIP containing a `MANIFEST.json` alongside separate content files as the spec describes. | Add ZIP packaging (shared fix with D-5). |
| E-4 Chat tool `export_compliance_record` | DONE | FIXED (inherits E-1 fix) | Tool now hands back a real, working download link. | none |

---

## Cross-cutting Quality Standards violations found

1. **Fake data in legal documents — RESOLVED.** The three most severe Rule-1 violations from the prior audit (fabricated Blob export URL, fabricated CBP numbers/signature in `reasonableCarePackage.ts` and `focusedAssessment.ts`) are all fixed with real data sourcing and honest empty/error states. This is the single biggest change since the last audit.
2. **Money math — largely resolved for the live filing path.** `computeFilingTariff` (`dutyEngine.ts:350-429`) is now Decimal end-to-end. The hardcoded `"2.8%"` fallback rate is gone from `landedCost.ts`, `drawback.service.ts`, and `refunds/opportunities/scan/route.ts` — all three now call `calculateDutyStack`/`loadHtsCodesMap` for real per-HTS-code rates. One residual float-math spot: `reasonableCarePackage.ts:191` sums `shipment.lineItems` totals with plain `Number()`/`+` for a display-only valuation summary (not a filing/duty calculation) — lower severity than the prior findings but still technically a Rule-2 deviation.
3. **AuditLog coverage remains proportionally unchanged** (Rule 5). 89 of 162 write routes still lack `createAuditLog` — the fix targeted the specific routes the prior audit named (all now fixed) rather than performing the full sweep the task asked for. `products/[id]/route.ts`, `shipments/[id]/route.ts`, and `parties/*` remain the highest-value unaudited routes.
4. **`AuditAction` enum is no longer dead code** (Rule 5/F08-A2) — now used in 48 files, a genuine fix.
5. **Pagination now matches the global standard on the routes previously cited** (Rule 8). `filing/route.ts` and `audit/route.ts` both now default `limit=50, max=200`. Still offset-based (`skip`), not cursor-based, on both.
6. **Idempotency-Key support essentially unchanged** (Rule 9) — 8 of 139 POST route files reference it, about the same ratio as before (8/123).
7. **`any` types increased repo-wide**: 77 occurrences now vs. 25 previously (rough grep count, not scoped identically, so treat as directional not exact) — however the specific F08-A4 instance cited previously (`audit/route.ts:19 whereClause: any`) is fixed. The overall `any` count growing is a mild regression worth a follow-up sweep, though not concentrated in the F06/F07/F08 files re-audited here.
8. **Real Inngest infrastructure now exists** where none did before — `src/lib/inngest/client.ts`, `src/app/api/inngest/route.ts`, and two real scheduled functions (`dailyComplianceAudit`, `dailyWorkMetricSnapshot`). This resolves F07-F3 and F08-C3 outright, and provides the plumbing needed to close F06-A6 (properly, via events) and F07-D5 (15-minute status polling) in the future, though those two specific jobs were not added. Both new Inngest functions cast `inngest.createFunction as any` — a minor Rule-7 violation worth a quick typed-signature cleanup.
9. **PDF and ZIP generation remain entirely unimplemented.** No PDF library (`@react-pdf/renderer`, `puppeteer`, `pdfkit`, `pdf-lib`) and no ZIP library (`archiver`, `jszip`, `adm-zip`) exist anywhere in `package.json`. This affects F07-A5, F08-B3, and F08-D5/E3 — all three still return JSON only. This is now the single largest remaining category of incomplete work across all three features.
10. **Section 301 / AD-CVD seed data is still sparse** — the architecture fix (D-2/D-3) is real and correct, but `prisma/seed.ts` seeds exactly one Section 301 row and one AD row (zero CVD rows), so in practice most HTS codes still compute `$0` Section 301/AD/CVD, just now due to missing data rather than a hardcoded-zero code path. This is a materially different (much less severe) class of gap than before, but still affects declared duty accuracy today.

## Top 5 fixes ranked by severity

1. **[RESOLVED] Fake-data legal-risk items (F08-E1, F08-B2, F08-D5).** The fabricated Blob export URL, the fake CBP number/GRI-steps/signature in the reasonable-care package, and the mislabeled static narrative are all now real. This was correctly treated as the top priority and was fixed correctly (real data + honest empty/error states, not just cosmetic patching).
2. **Add PDF and ZIP export generation (F07-A5, F08-B3, F08-D5, F08-E3).** This is now the largest remaining gap across all three features — no PDF or ZIP library exists anywhere in the codebase. A single shared server-side PDF/ZIP utility would close four separate outstanding tasks at once.
3. **Complete the AuditLog coverage sweep for real (F08-A1).** 89 of 162 write routes are still unaudited — the fix so far has been reactive (patching cited examples) rather than the systematic sweep the task specifies. `products/[id]`, `shipments/[id]`, and `parties/*` are the highest-value remaining targets.
4. **Expand Section 301 / AD-CVD seed data (F06-D2, F06-D3).** The architecture is now correct and no longer silently zeroes these out by code-path design, but only one sample HTS code has real tranche/case data seeded — most real duty-stack computations still return $0 for these layers today due to missing data, not missing logic.
5. **Wire the two new Inngest jobs' remaining siblings (F06-A6 properly, F07-D5 15-minute polling) and verify Inngest deployment wiring in production.** The plumbing now exists (`dailyComplianceAudit`, `dailyWorkMetricSnapshot` both real and correct), but confirm the Inngest app is actually registered against Inngest Cloud/self-hosted in the deployed environment, and add the still-missing filing-status-poll job.
