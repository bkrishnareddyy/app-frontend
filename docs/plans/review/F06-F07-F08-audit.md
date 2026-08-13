# F06 Origin/Valuation/Tariff + F07 Filing & Entry + F08 Audit & Governance — Audit

F06 Overall readiness: 65%
F07 Overall readiness: 80%
F08 Overall readiness: 52%

**Legal/compliance blocker found:** No `parseFloat`-on-raw-money or `Number()*rate` pattern was found inside `calculateCustomsValuation` or `buildForm7501` (both are genuinely Decimal.js-clean). However, `computeFilingTariff` in `src/lib/tariff/dutyEngine.ts` (the function actually used by the live filing-transmission path via `filing.service.ts`) accumulates the multi-line duty totals with plain JS `+=`/`Math.round(x*100)/100` float arithmetic, not `Decimal`. Separately, `src/lib/tariff/landedCost.ts:56` and `src/modules/drawback/drawback.service.ts:47` still hardcode `generalDutyRate: "2.8%"` regardless of the actual HTS code — this is the exact "old known offender" pattern the audit was asked to check for, still alive in code that feeds duty numbers to users. See Capability D below for full detail.

---

## F06 Capability A — Origin Determination Engine

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| A-1 Remove auto-create-on-read | DONE | `src/app/api/advisory/origin-determination/route.ts:34-45` looks up `db.tradeAgreement.findUnique` and returns 404 if not seeded; no `.create()` call in the route. | none |
| A-2 `originEngine.ts` pure function | DONE | `src/lib/origin/originEngine.ts:63-179` — real substantial-transformation, tariff-shift, and RVC logic, returns the specified `OriginResult` shape. | none |
| A-3 Seed `trade-agreements.json` | PARTIAL | `prisma/seed-data/trade-agreements.json` (94 lines) — only ~6 HTS chapters for USMCA + partial CAFTA-DR, not the full Annex 4-B (2,000 rules). Matches the plan's own "data gaps" note about de-scoping to top chapters, so this is an accepted partial, not a bug. | Expand chapter coverage over time; document coverage limit in UI. |
| A-4 `POST /api/advisory/origin-determination` | DONE | Same route file: creates `OriginDetermination` row (`route.ts:69-81`), returns structured `analysis` object, not a template string. | Route does not call `createAuditLog` with the `AuditAction` enum — see cross-cutting section. |
| A-5 UI + <80% confidence → ExceptionItem | DONE | `route.ts:84-96` creates `ExceptionItem` with `category: "COMPLIANCE"` when `result.confidence < 80`, matching spec's 80% threshold exactly. | none |
| A-6 Re-run via Inngest on `productCountryFact.updated` | MISSING | No Inngest package or usage anywhere in the repo (`grep -r inngest` → only `package.json` string match, no code). `src/app/api/advisory/origin-determination/[lineItemId]/route.ts` only supports a manual POST re-run; no event-driven trigger exists. | Either wire a Vercel-cron-compatible event hook, or update the plan to reflect Inngest is not used anywhere in this codebase (confirmed via cron folder using plain Vercel Cron instead). |
| A-7 Vitest | DONE | `tests/unit/originEngine.test.ts` (62 lines, 4 test blocks), `tests/origin-determination-api.test.ts` (131 lines). | none |

## F06 Capability B — Trade Agreement Qualification

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| B-1 `POST /api/v1/trade-agreements/qualify` | DONE | `src/app/api/v1/trade-agreements/qualify/route.ts` — calls `determineOrigin`, returns `{ qualified, gaps, ... }`. | Route does **not** call `createAuditLog` at all — cross-cutting violation (writes an implicit read-only computation, arguably acceptable since no DB write occurs here). |
| B-2 Missing-evidence identification with attribute links | DONE | `originEngine.ts:72-87` populates `gaps[].attributeId` pointing at the composition/material row; route passes `result.gaps` straight through. | none |
| B-3 UI qualification tab | DONE | `src/app/app/shipments/[id]/LineItemDetailTabsModal.tsx` has an `"qualification"` tab state and renders agreement/evidence status. | none |
| B-4 USMCA CO generation | DONE | `LineItemDetailTabsModal.tsx:79-322` — `generateUsmcaCertificate()` builds a pre-filled text document ("USMCA CERTIFICATION OF ORIGIN..."), matches "document template render, not AI." | none |
| B-5 Vitest | PARTIAL | Core qualification logic covered indirectly by `tests/unit/originEngine.test.ts`; no test file targets `/api/v1/trade-agreements/qualify` specifically. | Add a route-level test for the missing-material-cost → gap (not error) case. |

## F06 Capability C — Customs Valuation Engine

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| C-1 `valuationEngine.ts` with Decimal | DONE | `src/lib/valuation/valuationEngine.ts` — every arithmetic op (`assistsDecimal.plus(...)`, `.times(...)`) uses `Decimal`, no float math found. Genuinely clean. | none |
| C-2 Assist categories + proration | PARTIAL | `AssistInput.prorationMethod` is accepted in the type (`valuationEngine.ts:8`) but never read/branched on in `calculateCustomsValuation` — every assist is `unitCost.times(quantity)` regardless of `"per_unit"` vs `"entire_shipment"`. | Implement the proration branch the field promises, or drop the field until it's real. |
| C-3 Related-party test → ExceptionItem | DONE | `src/app/api/products/[id]/valuation/route.ts:13-33` creates `ExceptionItem` with `category: "VALUATION"` when `relatedParty: true`. | Route does not call `createAuditLog` — cross-cutting gap. |
| C-4 `POST /api/products/[id]/valuation` persistence | MISSING | `grep -rn "valuationAssistsRecord" src` returns **zero** hits anywhere in the app. The route only computes and returns a transient result; `ValuationAssistsRecord` (which exists in `prisma/schema.prisma:1753`) is never written to. Re-opening a line item loses all prior valuation input. | Add `db.valuationAssistsRecord.upsert(...)` in the route. |
| C-5 Valuation UI tab | DONE | `LineItemDetailTabsModal.tsx:332-402` — shows invoice/additions/deductions/customs value, related-party flag. | Because of C-4, this is a "calculate on click" tab with no persistence, not a durable record. |
| C-6 Vitest | DONE | `tests/unit/valuationEngine.test.ts` (43 lines, 3 blocks). | none |

## F06 Capability D — Duty-Stack Calculation

**This is the highest-severity capability in F06. Section 301 and AD/CVD are not wired to real rate data — the plan's own "old known offender" pattern is present.**

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| D-1 `DutyStack` interface + Decimal refactor | PARTIAL | `src/lib/tariff/dutyEngine.ts:29-41` matches the exact interface from the spec, and `calculateDutyStack` (line 129) does per-layer math in `Decimal`. **But**: line 134 computes the input value with raw floats — `Number(lineItem.quantity) * Number(lineItem.unitPrice)` — before ever touching Decimal, and `computeFilingTariff` (lines 265-340, the function actually used by the live filing path in `filing.service.ts:204`) sums per-line totals with plain `let total = 0; total += res.customsValue` and `Math.round(x*100)/100`, not Decimal. `calculateLineItemDuty` (line 242-244) also has a bug: `customsValue` is reported as `0` whenever `stack.base.gt(0)` is false — i.e. for a duty-free (0%) line, the reported customs value silently becomes `$0`, which would then understate MPF for that line if it were free-rated. | Route all money through `Decimal` end-to-end, including cross-line aggregation; fix the `stack.base.gt(0)` customsValue bug. |
| D-2 Section 301 rates seeded from Federal Register | MISSING | `HtsDutyRate` model (`prisma/schema.prisma:2009-2027`) has **no** `rateType: "SECTION_301"`, no `trancheId`, no `exclusion` field — only `rateColumn` (General/Special/Column 2), `programCode`, `rawRateText`. Section 301 is instead computed by a hardcoded `switch` statement in code (`dutyEngine.ts:104-124`): `List1/2/3 → 25%`, `List4A → 7.5%`, `List4B → 15%`, and **defaults to List3/25% whenever `section301Tranche` is not supplied** (`dutyEngine.ts:141-145`). `loadHtsCodesMap` (the function that actually populates rate input for real API calls) never sets `section301Tranche` at all (line 214-225: always `section301Applicable: false`). | Seed real List 1-4B data into `HtsDutyRate` per the plan's own schema, and stop defaulting unknown tranches to 25%. |
| D-3 AD/CVD rates: `HtsDutyRate` with caseNumber/manufacturer | MISSING | `HtsDutyRate` has no `caseNumber`, no `manufacturer`, no `rateType: "ANTIDUMPING"/"COUNTERVAILING"` fields at all. `AdcvdOrder` (the model that *does* exist, schema.prisma:956) has no rate field either — only scope fields (`htsCodesInScope`, `scopeLanguage`). In the live path, `antidumpingRate`/`countervailingRate` are **never populated** by `loadHtsCodesMap`, so `adRate`/`cvdRate` in `calculateDutyStack` are always `0` for real API calls — AD/CVD duty is silently `$0` on every production duty-stack computation today. | Add a real AD/CVD rate table (case number × HTS × country × manufacturer, "most specific wins") and wire `loadHtsCodesMap` to populate it. |
| D-4 `GET /api/v1/hts/codes/[code]/rates` | DONE (mechanically) | `src/app/api/v1/hts/codes/[code]/rates/route.ts:32-52` calls `calculateDutyStack` and returns `htsReleaseId`. Inherits the D-2/D-3 gaps above — the numbers it returns for Section 301/AD/CVD are the hardcoded/zero values, not real data. | Fix upstream (D-2/D-3) and this endpoint is correct by construction. |
| D-5 `ShipmentLineItem.dutyStack` persisted | MISSING | `dutyStack Json?` field exists on `ShipmentLineItem` (`schema.prisma:714`), but a full-repo grep for writes to it (`dutyStack:` inside an `update`/`create` call) found **zero** hits outside of unrelated models (`LandedCostScenarioLineItem`, simulator). Every `shipmentLineItem.update(...)` call site (`decisions/route.ts`, `productService.ts`, `lineItemReconciler.ts`, etc.) was checked — none set `dutyStack`. | Write `dutyStack` when a line item is classified/valued, as specified. |
| D-6 Vitest | DONE | `tests/unit/dutyEngine.test.ts` (53 lines, 5 blocks), `tests/duty-rate-release-scope.test.ts`. | Tests exercise the pure function correctly, but don't catch the float-aggregation issue in `computeFilingTariff` because that path isn't separately tested. |

## F06 Capability E — AD/CVD Scope Screening

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| E-1 `AdcvdOrder` model + seed | DONE | `schema.prisma:956-971` matches spec fields exactly. `prisma/seed-data/adcvd-orders.json` (57 lines) seeds a handful of real, correctly-cited orders (e.g. A-570-601 Tapered Roller Bearings, A-570-979 Solar Cells) — not fabricated case numbers, but far short of "top 50." | Expand seed coverage. |
| E-2 `scopeScreening.ts` | DONE | `src/lib/adcvd/scopeScreening.ts` — real HTS/country/text matching logic, no hardcoded verdicts, confidence scores vary meaningfully by match type (95/65/50). | none |
| E-3 AI scope analysis for "POSSIBLY" via Claude API | MISSING | No Anthropic/Claude API call anywhere in `scopeScreening.ts` or the route that calls it. "POSSIBLY" results just get a static reasoning string, no `ScopeAnalysis` with GRI-style step reasoning. | Wire an actual Claude API call for the POSSIBLY branch as specified. |
| E-4 Integration → `ExceptionItem` | DONE | `src/app/api/products/[id]/adcvd-screen/route.ts:44-61` creates `ExceptionItem` with `category: "COMPLIANCE"` for YES/POSSIBLY. | Route does not call `createAuditLog`. |
| E-5 AD/CVD UI section | DONE | `LineItemDetailTabsModal.tsx` has an `"adcvd"` tab. | none |
| E-6 `POST /api/products/[id]/adcvd-screen` manual re-screen | DONE | Route exists and works; "also runs on classification change" trigger not verified/found. | Verify/add the classification-change trigger. |
| E-7 Vitest | MISSING | No test file for `scopeScreening.ts` found anywhere in `tests/`. | Add the NO/YES/POSSIBLY test cases specified. |

---

## F07 Capability A — Automated 7501 Preparation

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| A-1 Field mapping in `form7501.ts` | DONE | `src/lib/filing/form7501.ts:1-92` — every CBP block documented with source model/field, Block 35 computed as Block29 × Block34 via `Decimal` (`roundToCents(customsValue.times(new Decimal(dutyRateDecimal)))`, line 175). Genuinely clean money math. | none |
| A-2 Refactor `POST/GET /api/filing/[id]/entry-summary` | DONE | `src/app/api/filing/[id]/entry-summary/route.ts` — fully rebuilt on `buildForm7501`, no float math, no prose summary; returns typed `form7501` structure. This directly refutes the plan's baseline claim that this route is still "a prototype with float math" — it has been fixed. | `FilingSnapshot` is written later at transmit time (`filing.service.ts`), not on this preview GET — reasonable, but worth confirming intentional. |
| A-3 Entry-line provenance | DONE | Every field in `Form7501FieldResult` carries `{ value, sourceModel, sourceId, sourceField, approvedByUserId, approvedAt }` (`form7501.ts:13-31`, populated throughout `buildForm7501`). | none |
| A-4 7501 preview UI | DONE | `src/app/app/filing/[id]/FilingDetailClient.tsx` has a `"form7501"` tab that loads `entry-summary` data. | Did not verify the exact green/amber/red color coding pixel-for-pixel, but `FieldStatus` values (`sourced_approved`/`sourced_unapproved`/`missing`) are present in the data the UI consumes. |
| A-5 7501 export (JSON + server PDF) | PARTIAL | JSON is trivially available via the API response. No PDF generation library found anywhere (`package.json` has no `@react-pdf/renderer`, no `puppeteer`, no headless-Chromium dependency; `pdfjs-dist` is a PDF *reader*, not a generator). | Add a server-side PDF renderer. |
| A-6 Vitest | DONE | `tests/form7501-builder.test.ts` (180 lines). | none |

## F07 Capability B — Pre-Filing Validation

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| B-1 `filingValidator.ts` | DONE | `src/lib/filing/filingValidator.ts` — every rule from the spec is present almost verbatim: 7501 blocks populated, all lines approved, blocking reconciliation issues, blocking exceptions, bond expiry + sufficiency, CBP number 9-digit format, ACE port code lookup against `prisma/seed-data/ace-ports.json`, entry-type/mode compatibility, HTS release >30-day freshness. Pure, DB-free, directly testable. | none |
| B-2 `POST /api/filing/[id]/validate` | DONE | Calls `runFilingValidation`, returns `{ valid, blockers, warnings }`. | none |
| B-3 Server-enforced `POST /api/filing/[id]/transmit` | DONE | `src/app/api/filing/[id]/transmit/route.ts:26-110` — runs `runFilingValidation` unconditionally server-side before any transmission logic, returns 422 with the blocker list if invalid. This is a genuine server-side gate, not client-trust. | none |
| B-4 Vitest | DONE | `tests/filing-validator.test.ts` (218 lines). | none |

## F07 Capability C — Filing Readiness Gate (Server-Enforced)

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| C-1 `readinessScore ≥ 80` (configurable) | DONE | `filingValidator.ts:306-323` (`checkReadinessScore`) + `transmit/route.ts:53-57` reads threshold from `AgentPolicyConfig.autoThreshold`, defaults to 80. | none |
| C-2 `PreFilingReadiness.tsx` reflects server validation | DONE | `src/app/app/shipments/[id]/PreFilingReadiness.tsx` exists; fetches from the validate endpoint per the pattern seen elsewhere in the app. | Did not fully trace every render branch to confirm zero client-side blocker computation. |
| C-3 "File this entry" disabled not hidden | Not fully verified | Not confirmed line-by-line in this pass. | Spot-check button `disabled` attribute + tooltip content. |

## F07 Capability D — ACE/ABI Filing Integration

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| D-1 `CustomsFilingTransmissionProvider` interface | DONE | `src/lib/filing/transmissionProvider.ts:73-77` matches spec's interface (transmit/getStatus/parseAcknowledgment) almost exactly. | none |
| D-2 Mock provider active, health check gates prod | DONE | `src/app/api/health/route.ts:29-48` — checks `CBP_ABI_FILER_CODE`/`CBP_ABI_FILER_PASSWORD`, returns 503 in production if mock is still active. Well implemented. | none |
| D-3 `AbiPayload` (CATAIR-aligned) | DONE | `transmissionProvider.ts:18-41` — structured payload with line items, matches the 7501 field mapping. | none |
| D-4 `RealAceProvider` stub | DONE | `transmissionProvider.ts:92-132` — reads `process.env.CBP_ABI_*`, throws clear "not yet implemented" errors, structured so only HTTP calls need adding. | none |
| D-5 Acknowledgment parsing + 15-min status-polling cron | PARTIAL | `CustomsResponse` handling exists in the dev-stub simulation path (`simulateAndApplyResponse`). No Inngest/cron polls filing status every 15 minutes — `vercel.json` only has 2 crons (`hts-refresh`, `document-processing`), consistent with the documented Vercel Hobby-plan 2-cron/1-per-day limit. A 15-minute poll is not achievable on the current hosting tier. | Either implement webhook-based status push (CBP doesn't offer this) or accept/document the Hobby-plan constraint explicitly rather than leaving the task silently undone. |
| D-6 Filing status transitions + rejection → `ExceptionItem` | Not fully verified | `filingStateMachine.ts` exists implementing `DRAFT→...→LIQUIDATED`; did not trace the rejection-code parsing → `ExceptionItem(category: "FILING")` path to completion in this pass. | Verify rejection handling creates the exception with parsed code. |

## F07 Capability E — Filing Status Tracking

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| E-1 Status timeline + AuditLog | PARTIAL | `FilingDetailClient.tsx:530-545` renders a stage timeline, but it's derived from filing-record timestamp fields (`stageDates`), not a literal query against `AuditLog` rows, and does not surface "actor" or "notes" per the spec. | Back the timeline with real `AuditLog` rows scoped to the filing. |
| E-2 `GET /api/filing?status=...` paginated | DONE | `src/app/api/filing/route.ts:1-60` — supports comma-separated multi-status filter, ACE reference number implied via `entryNumber`. Pagination defaults to `limit=10, max=100` (not the global standard's `default 50 / max 200 / cursor-based`) — cross-cutting gap, not F07-specific. | Align pagination defaults with the global standard. |
| E-3 Filing list in shipment workspace | Not fully verified | Plausible given `FilingDashboardClient.tsx` exists. | — |
| E-4 Rejection UI + Re-file action | Not fully verified | Not traced in this pass. | — |

## F07 Capability F — Continuous Compliance Monitoring

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| F-1 Typed `auditChecklist.ts` | DONE | `src/lib/compliance/auditChecklist.ts` — 5 real, typed checks (HTS change, value discrepancy >5%, AD/CVD coverage, bond-vs-liquidation, broker approval for >$2,500), no hardcoded strings/scores, matches spec almost verbatim. | none |
| F-2 Refactor `POST /api/compliance/audits/run` | DONE | `src/app/api/compliance/audits/run/route.ts` — runs `runAuditChecks`, creates `ComplianceFinding` rows, **upserts by `(filingId, rule)`** so re-runs don't duplicate (idempotent, satisfying F-5's requirement too). | none |
| F-3 Daily Inngest compliance cron | MISSING | No Inngest anywhere; no cron route (`src/app/api/cron/*`) calls `runAuditChecks`/`/compliance/audits/run`. Only manually triggerable via the API. | Add a scheduled trigger (subject to the same Hobby-plan cron-count constraint noted in F07-D5). |
| F-4 Findings UI | DONE | `src/app/app/compliance/page.tsx` + `ComplianceFindingsClient.tsx` exist. | Did not verify severity grouping renders exactly CRITICAL/HIGH/MEDIUM/LOW. |
| F-5 Vitest (idempotent) | DONE | `tests/compliance-audit-engine.test.ts` (207 lines), `tests/audit-checklist.test.ts` (333 lines). | none |

---

## F08 Capability A — Immutable Audit Trail

**This capability was claimed "done" but the coverage audit itself (Task A-1) was clearly never completed.**

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| A-1 Audit coverage audit across all POST/PATCH/DELETE routes | MISSING | Of 146 route files exporting POST/PATCH/DELETE, **80+ have zero `createAuditLog` call**, including domain-write-heavy areas like `src/app/api/products/[id]/*` (compositions, attributes, classifications, parties, valuation, adcvd-screen), `src/app/api/parties/[id]/*`, `src/app/api/v1/trade-agreements/qualify`, `src/app/api/decisions*`-adjacent product routes, and several `src/app/api/cron/*` jobs. This directly contradicts the task's own instruction ("grep all POST/PATCH/DELETE route handlers... add the missing ones"). | Run the actual audit and add the missing calls — largest single gap found in this review. |
| A-2 Typed `AuditAction` enum, replace freehand strings | MISSING (dead code) | `src/lib/audit/auditActions.ts` defines an 11-value enum, but `grep -rl "AuditAction\." src` (excluding the definition file) returns **zero** hits. All 65 files that call `createAuditLog` use freehand strings (`"advisory.origin.determined"`, `"filing.transmit"`, `"compliance_audit.run"`, `"REASONABLE_CARE_GENERATED"`, etc.) instead of the enum. | Either wire the enum in or remove it — currently pure dead code. |
| A-3 Diff capture with redaction | PARTIAL | `src/lib/audit/diffHelper.ts` implements `diff(before, after)` with key-based redaction (`password`, `token`, `secret`, etc.) correctly — but `grep -rl "diffHelper" src` finds **zero** call sites. Two route files build `previousValue`/`newValue` manually instead of using the shared helper. | Wire the helper into PATCH routes generally. |
| A-4 `GET /api/audit` query API | DONE | `src/app/api/audit/route.ts` — supports `entityId`, `entity`, `action`, `from`, `to`, paginated, scoped to `accountId`. Uses `whereClause: any` (violates the "no `any`" global rule). | Type the where clause with `Prisma.AuditLogWhereInput`. |
| A-5 Append-only enforcement + RLS | PARTIAL | No `auditLog.update`/`auditLog.delete` call exists anywhere in the app (good — app-level immutability holds). But no Postgres RLS migration was found (`grep -rl "ROW LEVEL SECURITY\|DENY DELETE" prisma/migrations` → nothing); the constraint exists only as a comment in `src/lib/audit.ts:73-81` (`assertAppendOnlyAuditPolicy()` literally just `return true`, doing nothing). | Add the actual RLS migration the plan asked for, or drop the misleading function name. |
| A-6 Vitest (auto-approval writes `DECISION_AUTO_APPROVED`) | MISSING | `grep -rn "DECISION_AUTO_APPROVED" src tests` only matches the enum's own definition — the action string is never used in production code or asserted in any test. | Wire the enum into the auto-approval path and add the test. |

## F08 Capability B — Reasonable-Care Record

**Severe fake-data violation: a legal defense document contains fabricated CBP numbers, GRI steps, and a fake digital signature.**

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| B-1 `ReasonableCarePackage` structure | DONE | `src/lib/audit/reasonableCarePackage.ts:58-81` — interface matches spec closely. | none |
| B-2 Populate from real data, no synthetic data | **MISSING / FAKE DATA** | `assembleReasonableCarePackage` (same file, lines 86-210) never queries `FilingSnapshot`, `ClassificationDecision`, `GriAnalysisStep`, `ExtractionField`, or `ValuationAssistsRecord` despite the spec naming all five explicitly. Instead: (1) line 189 hardcodes `cbpNumber: "CBP-99-1234567"` for **every** shipment regardless of the real importer; (2) line 114 hardcodes `griSteps: ["GRI 1: Terms of headings", "GRI 6: Subheading comparison"]` for every line item, not the real classification reasoning; (3) line 116 hardcodes `approver: "System Classifier Agent"`; (4) line 161 hardcodes `confidence: 95` for every decision; (5) lines 125-131 hardcode the entire valuation section to zeros (`assistsTotal: 0, royalties: 0, ...`) rather than querying the real `ValuationAssistsRecord`; (6) lines 202-207 fabricate a certification: `name: "Qubere System Filer"`, `signature: "DIGITALLY_SIGNED_QUBERE"`. This is precisely the "no fake data, ever" violation the audit was asked to check for, and it appears in a document meant to be handed to CBP as evidence of reasonable care. | Rewrite to source every field from the named real models; remove the fabricated CBP number/signature entirely — a missing value should render as an honest gap, not an invented one. |
| B-3 PDF export | MISSING | No PDF generation library in the repo (see F07-A5). Only JSON is returned. | Add server-side PDF rendering. |
| B-4 `GET /api/audit/package/[shipmentId]` + completeness score | DONE | Route exists and returns `completenessScore`; the score itself is naive (counts non-empty sections, doesn't distinguish real vs. fake completeness) given B-2's fake data. | Completeness score is misleading until B-2 is fixed — it can currently report high completeness on entirely fabricated sections. |
| B-5 Trigger via UI + chat tool | DONE | `src/modules/assistant/tools.ts:443-473` implements `generate_reasonable_care_record` chat tool calling the same (currently fake-data) assembler. | Fix flows through once B-2 is fixed. |

## F08 Capability C — Audit Population Analytics

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| C-1 `WorkMetricSnapshot` Prisma model | DONE | `prisma/schema.prisma:3839-3855` — matches the spec's field list and index almost exactly. | none |
| C-2 `metricComputer.ts` pure functions | DONE | `src/lib/analytics/metricComputer.ts` — genuinely computes cycle time (median), first-pass rate, touch rate, exception age, and duty-per-entry from real `CustomsFiling`/`ExceptionItem`/`ExtractionField` rows. `dutyPerEntry` correctly uses `Decimal` (line 98-105) — this file is clean. | none |
| C-3 Daily Inngest job writing `WorkMetricSnapshot` | **MISSING** | `grep -rn "workMetricSnapshot" src` finds exactly **one** hit — a `findMany` read in `src/app/api/dashboard/metrics/route.ts`. Nothing anywhere ever calls `.create()` on this model. The snapshot table is permanently empty in production; the dashboard's historical trend view (`snapshots` array) will always be `[]`. | Add the daily job (subject to the same Hobby-plan cron-slot scarcity noted elsewhere). |
| C-4 `GET /api/dashboard/metrics` | DONE | `src/app/api/dashboard/metrics/route.ts` — returns `live` (real-time computed) + `snapshots` (empty, per C-3) + honest `emptyState` flag. | none |
| C-5 `CommandCenterClient.tsx` real data | DONE | Fetches `/api/dashboard/metrics` (line 122); no `Math.random()`/hardcoded KPI values found in the file. | Historical trend charts will show nothing until C-3 is fixed. |
| C-6 Vitest | MISSING | No test file targeting `metricComputer.ts` exists in `tests/`. | Add the cycle-time/touch-rate tests specified. |

## F08 Capability D — Focused Assessment Defense File

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| D-1 `FocusedAssessmentFile` structure | DONE | `src/lib/audit/focusedAssessment.ts:21-46` matches spec closely. | none |
| D-2 `POST /api/audit/room` | DONE | `src/app/api/audit/room/route.ts` calls `assembleFocusedAssessmentFile`. | Did not verify `AuditTimeline` row is written as spec requires. |
| D-3 `GET /api/audit/room/[filingId]` | DONE | Route exists, includes the filing's reasonable-care package (inherits B-2's fake-data problem). | — |
| D-4 `ControlEvidence` model | DONE | `prisma/schema.prisma:3857-3869` exists and is genuinely queried (`focusedAssessment.ts:89-99`), not faked. | none |
| D-5 ZIP export + AI-generated narrative | **MISSING / MISLABELED** | `focusedAssessment.ts:135-140` — the code comment claims "AI-generated remediation narrative," but it's a static JS template string with no Claude API call anywhere in the file or its callers. Also: `importer.cbpNumber: "CBP-99-1234567"` and `importer.address: "123 Importer Way, Los Angeles, CA 90001"` (lines 146-147) are hardcoded fabricated values, same pattern as B-2. No ZIP file generation exists anywhere (no `archiver`/`jszip`/`adm-zip` dependency). | Call the real Claude API for the narrative and stop labeling a template string as AI-generated; source the importer address/CBP number from `ImporterOfRecord`; add real ZIP packaging. |
| D-6 Vitest | MISSING | No test file for `focusedAssessment.ts`/defense-file assembly found. | Add the specified tests. |

## F08 Capability E — Portable Compliance Record Export

| Task | Status | Evidence | Gap / Fix needed |
|---|---|---|---|
| E-1 `POST /api/audit/export` → signed Blob URL | **MISSING / FAKE DATA** | `src/app/api/audit/export/route.ts:82-84` — the `downloadUrl` is a hand-built string (`` `https://vercel-blob.qubere.ai/compliance-exports/export-${ctx.accountId}-${Date.now()}.zip?token=exp_24h_val_${...}` ``) with the code's own comment admitting it's "(simulated mockup Vercel Blob URL)." **No ZIP file is ever created, no Vercel Blob upload occurs.** Clicking the returned link would 404. This is a fabricated artifact returned to the user as if it were real, in direct violation of the plan's own "no fake data, ever" rule — arguably the single worst violation found in this review, since it's an outright non-functional deliverable presented as functional. | Actually generate and upload the ZIP to Vercel Blob and return the real signed URL, or return an honest "not yet implemented" error instead of a URL that will fail. |
| E-2 OWNER-only access control | DONE | `route.ts:8-15` — checks `ctx.roleNames.includes("OWNER")`, returns 403 otherwise. Correctly account-scoped queries throughout. | none |
| E-3 `MANIFEST.json` inside the ZIP | PARTIAL | A `manifest` object is built and returned in the JSON response (`route.ts:53-68`), but since no ZIP is ever created (E-1), there is no actual `MANIFEST.json` file inside anything. | Depends on E-1 being fixed. |
| E-4 Chat tool `export_compliance_record` | DONE (mechanically) | `src/modules/assistant/tools.ts:474+` implements the tool, calling the same fake-URL endpoint. | Inherits E-1's problem — the chat tool will hand the user a broken link. |

---

## Cross-cutting Quality Standards violations found

1. **Float math for money in the live filing path** (Rule 2, "Decimal.js EVERYWHERE"). `computeFilingTariff` in `src/lib/tariff/dutyEngine.ts:265-340` — used by `filing.service.ts:204`, `pipelineOrchestrator.ts:91`, `src/app/api/filing/route.ts:401`, `src/app/api/filing/[id]/route.ts:96` — aggregates duty/customs-value totals with plain JS number `+=` and `Math.round(x*100)/100`, not `Decimal`. Per-line math inside `calculateDutyStack` is Decimal-clean, but the roll-up across lines is not.
2. **Hardcoded "2.8%" duty rate still present** in two files: `src/lib/tariff/landedCost.ts:56` and `src/modules/drawback/drawback.service.ts:47` (`generalDutyRate: "2.8%"` regardless of the actual product's HTS code) — this is the literal "old known offender" the review was told to watch for. Also present in `src/app/api/refunds/opportunities/scan/route.ts:105`: `new Decimal(Number(item.totalValue || 0) * 0.028)` — a hardcoded 2.8% "preferential duty savings" estimate computed via plain `Number()*0.028` before ever touching Decimal.
3. **AuditLog coverage is far from universal** (Rule 5). 80+ of 146 POST/PATCH/DELETE route files never call `createAuditLog`, including several F06 write endpoints (`trade-agreements/qualify`, `products/[id]/valuation`, `products/[id]/adcvd-screen`).
4. **`AuditAction` enum (Rule 5/F08-A2) is dead code** — defined, never imported anywhere else in the codebase.
5. **Pagination inconsistent with the global standard** (Rule 8: "default 50, max 200, cursor-based"). `src/app/api/filing/route.ts` defaults to `limit=10, max=100`; `src/app/api/audit/route.ts` defaults to `limit=50` but both use offset (`skip`) pagination, not cursor-based.
6. **Idempotency-Key support is rare** (Rule 9). Only 8 of 123 POST route files reference `checkIdempotency`/`Idempotency-Key`, though the ones that matter most for money (filing transmit) do implement it correctly.
7. **Fabricated data presented as real** (Rule 1, "no fake data, ever") in F08: hardcoded CBP importer numbers (`"CBP-99-1234567"`, appears twice, in both `reasonableCarePackage.ts` and `focusedAssessment.ts`), a fabricated importer address, a fake "digitally signed" certification, and — most seriously — a completely fabricated, non-functional Vercel Blob download URL returned from `/api/audit/export`.
8. **`any` types present** (Rule 7) — 25 occurrences repo-wide, including `src/app/api/audit/route.ts:19` (`whereClause: any`). Not extensive, but present in an audited file.
9. **Cron/Inngest mismatch with the plan.** The plan assumes Inngest throughout (F06-A6, F07-D5, F07-F3, F08-C3) but the codebase uses plain Vercel Cron with only 2 scheduled jobs wired in `vercel.json` (Hobby-plan constraint per project history). None of the four Inngest-dependent tasks above are implemented; this is a structural mismatch between the plan and the actual infra, not just an oversight.

## Top 5 fixes ranked by severity

1. **Stop returning a fake download URL from `/api/audit/export` (F08-E1).** This is a functionally broken deliverable presented as real — the most severe single finding. Either implement real ZIP generation + Vercel Blob upload, or return an explicit "not implemented" error.
2. **Remove fabricated legal-document data from `reasonableCarePackage.ts` and `focusedAssessment.ts` (F08-B2, F08-D5).** Hardcoded CBP numbers, addresses, GRI steps, confidence scores, and a fake "digital signature" appear in documents meant for CBP audit defense — a genuine legal risk, and a direct rule-1 violation.
3. **Wire real Section 301 and AD/CVD rate data into the duty stack (F06-D2, F06-D3).** `HtsDutyRate` has no fields for tranche/case-number/manufacturer, so Section 301 is a hardcoded rate switch and AD/CVD duty is silently `$0` on every real duty-stack computation today. This directly affects declared duty amounts on filings.
4. **Fix float aggregation in `computeFilingTariff` and remove the hardcoded "2.8%" fallback duty rate (`landedCost.ts`, `drawback.service.ts`, `refunds/opportunities/scan`).** Money aggregation across line items must be Decimal end-to-end, and no code path should substitute a static percentage for a real HTS-code lookup.
5. **Complete the AuditLog coverage sweep and actually use the `AuditAction` enum (F08-A1, F08-A2).** 80+ write routes are unaudited today, and the typed-enum task was set up but never adopted, undermining the "every write goes to AuditLog" guarantee the audit trail is supposed to provide.
