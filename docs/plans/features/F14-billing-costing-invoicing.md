# F14 · Billing, Costing, Invoicing & Profitability — Completion Plan

> Depends on: existing billing module (`src/lib/billing/*`, `src/app/app/billing/**`, `prisma/schema.prisma` billing models at line ~5138-5520), `PipelineOrchestrator` (`src/modules/agents/pipelineOrchestrator.ts`), permission catalogue + sync (`src/lib/permissions.ts`, `src/modules/admin/permissionSync.ts`), PDF generator (`src/lib/pdf/pdfGenerator.ts`), `Decisions` review route (`src/app/api/decisions/route.ts`)
> Branch: `feat/billing-completion`
> Source requirement doc: [docs/requirements/billing-costing-invoicing-profitability.md](../../requirements/billing-costing-invoicing-profitability.md) — all `§N` references below point at that file's numbered sections.
> Do NOT reread the whole billing module from scratch before starting — this plan already cites every file and line you need. Spend your first pass verifying the cited evidence is still accurate (things may have moved since this was written), not re-discovering it.

---

## 0. Starting context — what already exists

A real Phase-1/Phase-2 MVP is already built and should **not** be rewritten:

- Prisma models: `BillingEventDefinition`, `RateCard`, `RateCardVersion`, `RateRule`, `RateRuleCapabilityMapping`, `CostProfile`, `UsageEvent`, `ShipmentCharge`, `ShipmentCost`, `ChargeAdjustment`, `Invoice`, `InvoiceLine`, `Payment`, `BillingException` (`prisma/schema.prisma:5138-5520`).
- Engine: `src/lib/billing/ratingEngine.ts` (11 of 13 spec pricing models), `costingEngine.ts` (labor/tech cost, no-fake-fallback discipline), `ledger.ts` (3-layer summary + leakage scan), `invoicing.ts` (transactional invoice creation + payment recording), `telemetry.ts` (`recordUsageEvent`, idempotent).
- UI: full `Billing` workspace at `src/app/app/billing/**` (overview, rate cards, usage ledger, shipment economics, invoices, exceptions, reports, settings) with permission-gated cost/margin visibility.
- Permissions: `billing.view`, `billing.cost.view`, `billing.margin.view`, `billing.ratecard.manage`, `billing.charge.adjust`, `billing.invoice.manage`, `billing.payment.record`, `billing.reports.view` (`src/lib/permissions.ts:436-482`), backed by a real DB `Permission`/`Role`/`RolePermission` system with a sync mechanism (`src/modules/admin/permissionSync.ts`) — **reuse this, do not build a parallel bundle system**.

This plan closes the gaps between that MVP and the spec. It does not ask you to re-architect what's already correct.

### Confirmed critical gap (read this before anything else)

`recordUsageEvent` (`src/lib/billing/telemetry.ts:61`) is called from exactly 4 places:

| Call site | Event | Status |
|---|---|---|
| `src/app/api/classification/classify/route.ts:63` | `HTS_CLASSIFICATION_COMPLETED` | **Dead in production** — route returns 503 unless `ENABLE_LEGACY_CLASSIFICATION_MOCK=true` |
| `src/app/api/reconcile/route.ts:104` | `RECONCILIATION_COMPLETED` | Live |
| `src/app/api/exceptions/[id]/route.ts:71` | `EXCEPTION_MANUALLY_RESOLVED` | Live |
| `src/app/api/filing/[id]/transmit/route.ts:157` | `ACE_FILING_TRANSMITTED` | Live |

The real production classification path (`src/modules/classification/classificationCaseEngine.ts`, `src/modules/agents/htsClassificationAgent.ts`, invoked through `PipelineOrchestrator`) emits **no** usage events. Neither does document intake/OCR, product normalization, origin determination, valuation, compliance review, or filing readiness — all of which run through `PipelineOrchestrator.processEvent` (`src/modules/agents/pipelineOrchestrator.ts:118`) today with zero billing telemetry. This is Phase 1 below, and it is the highest-priority item in this plan: nothing downstream (rating, costing, invoicing, reporting) matters if the events that should drive it never fire.

---

## Phase 1 — Usage-event emission coverage (do this first)

### Capability A — Central emission hook in PipelineOrchestrator

Today, the only place usage events fire is inside individual route handlers (copy-pasted, ad hoc). `PipelineOrchestrator.processEvent` is already the single entry point for every agent-driven trigger (`src/modules/agents/pipelineOrchestrator.ts:24` comment: "Every trigger now goes through this one entry point") and already writes an `AgentExecutionRecord` per agent step in a `finally` block (`pipelineOrchestrator.ts:172-197`). That `finally` block is where billing emission belongs — one hook, not eight route-level hacks.

- **Task A-1**: In `prisma/schema.prisma`, add four new `BillingEventCategory` enum values: `ORIGIN_DETERMINATION`, `VALUATION`, `COMPLIANCE_REVIEW`, `FILING_READINESS` (enum is at `prisma/schema.prisma:5138`). Create a migration (`prisma/migrations/<timestamp>_billing_event_categories/migration.sql`) matching the style of existing enum-extension migrations (e.g. `20260812090000_filing_action_rule_allow_cancel`).
- **Task A-2**: Add corresponding entries to `DEFAULT_BILLING_EVENT_DEFINITIONS` in `src/lib/billing/constants.ts:10`:
  - `ORIGIN_DETERMINATION_COMPLETED` (category `ORIGIN_DETERMINATION`, unit `shipment`)
  - `VALUATION_COMPLETED` (category `VALUATION`, unit `shipment`)
  - `COMPLIANCE_REVIEW_COMPLETED` (category `COMPLIANCE_REVIEW`, unit `shipment`)
  - `FILING_READINESS_COMPLETED` (category `FILING_READINESS`, unit `shipment`)
  `PRODUCT_NORMALIZATION_COMPLETED` and `HTS_CLASSIFICATION_COMPLETED` already exist in this file — do not redefine them.
- **Task A-3**: Add an `AGENT_BILLING_EVENT_MAP: Record<string, { eventCode: string; quantityFrom: "lineItems" | "pageCount" | "fixed" }>` in `src/lib/billing/telemetry.ts` mapping the exact `agentName` strings used in `pipelineOrchestrator.ts`'s `determineAgentsToRun` (lines ~239-293) to billing event codes:
  - `"Document Intake Agent"` → `DOCUMENT_PROCESSED`, quantity = `output.pageCount` (confirmed field, `pipelineOrchestrator.ts:336`)
  - `"Product Intelligence Agent"` → `PRODUCT_NORMALIZATION_COMPLETED`, quantity = number of line items in `agentInput.lineItems` (built at `pipelineOrchestrator.ts:404`)
  - `"HTS Classification Agent"` → `HTS_CLASSIFICATION_COMPLETED`, quantity = number of line items classified this run — **verify the exact output field on `HTSClassificationOutput`** (`htsClassificationAgent.ts`) before wiring; it is likely a `classifications` or `lineItems` array length, or derivable from how many `AgentDecision` rows this step created
  - `"Origin Rules Agent"` → `ORIGIN_DETERMINATION_COMPLETED`, quantity = 1 (per-run)
  - `"Valuation & Assists Agent"` → `VALUATION_COMPLETED`, quantity = 1
  - `"Compliance Audit Agent"` → `COMPLIANCE_REVIEW_COMPLETED`, quantity = 1
  - `"Filing Readiness Agent"` → `FILING_READINESS_COMPLETED`, quantity = 1
  - `"Document Intelligence Agent"` → **no separate event**; it's extraction detail folded into Document Intake's `DOCUMENT_PROCESSED`, not a distinct billable capability. Confirm this reading against `§9` of the spec doc before finalizing — if the broker wants to bill extraction separately from intake, add `DOCUMENT_INTELLIGENCE_COMPLETED` instead of folding it in.
- **Task A-4**: In `pipelineOrchestrator.ts`'s per-agent loop (`processEvent`, around line 137-204), after a successful `runSingleAgent` call and before/alongside the `AgentExecutionRecord` write in the `finally` block, call `recordUsageEvent` using the map from Task A-3. Required fields: `accountId`, `shipmentId`, `clientId`/`importerId` (fetch once per `processEvent` call from the shipment, not per agent — avoid N+1), `userId: params.userId`, `agentId`/`sourceAgent: agentName`, `sourceFunction: "PipelineOrchestrator.processEvent"`, `success: status === "COMPLETED"`, `automated: true`, `processingDuration: Date.now() - stepStart` (already computed at line 140), `idempotencyKey: \`billing:${runId}:${agentName}\`` (runId is already unique per `processEvent` call, line 123 — this makes re-running the same pipeline step idempotent for free).
  - Wrap this call in its own try/catch that logs and continues, matching the existing pattern in `telemetry.ts:107-112` (`recordUsageEvent` already swallows rating/costing errors internally) — a billing failure must never fail the underlying compliance pipeline.
  - Skip emission when `status === "FAILED"` only for pricing models that require success (rating engine already handles `PER_SUCCESSFUL_OUTCOME` correctly at `ratingEngine.ts:115`); still emit the event with `success: false` so it's visible in the usage ledger and eligible for `PER_TRANSACTION`/`PER_API_EVENT` models that bill on attempt, not outcome.
- **Task A-5**: Remove the now-redundant emission from `src/app/api/classification/classify/route.ts:63` *only if* that route is confirmed fully dead — check `ENABLE_LEGACY_CLASSIFICATION_MOCK` usage across the codebase first; if any environment still sets it to `"true"`, leave the emission in place but add a comment noting it duplicates the orchestrator path and will double-count if both fire for the same classification (use the same idempotency-key derivation to prevent that, or gate one off entirely).

### Capability B — Manual review / human work events

- **Task B-1**: In `src/app/api/decisions/route.ts`, inside the `POST` handler, after the `applied.count` guard succeeds (around line 367-408) and after `classificationApplied` is resolved, call `recordUsageEvent` with `eventCode: "HTS_MANUAL_REVIEW_COMPLETED"` when `decision.agentName` indicates an HTS classification decision (reuse whatever pattern `MemoryExtractorWorker.processEvent`'s `task` derivation already uses at lines 456-461 — `decision.agentName?.includes("HTS")`). Fields: `shipmentId: decision.shipmentId`, `clientId`/`importerId` (resolve from shipment), `userId: ctx.userId`, `success: action === "APPROVE"`, `automated: false`, `metadata: { overridesClassification, action }`.
- **Task B-2**: **Do not fabricate `processingDuration` for this event.** There is no client-side review timer today. Leave `processingDuration` unset — `costingEngine.ts:67-81` already does the honest thing when duration is missing (logs an `UNTRACKED_LABOR_DURATION` `BillingException` instead of guessing). This matches the codebase's existing no-fake-fallback discipline (`costingEngine.ts:6` docstring). Do not compute a proxy from `decision.createdAt` — that measures queue wait time, not review effort, and would misrepresent broker labor cost.
- **Task B-3** (stretch, separate PR if time-boxed out of this pass): add a real client-side review timer — start on decision-detail open, stop on submit — and pass it through as `processingDuration` in the `POST /api/decisions` body. This is the only way to make `HTS_MANUAL_REVIEW_COMPLETED` labor costing accurate; flag it explicitly to the broker as a known gap until built.
- **Task B-4**: Locate where a customs entry is marked filed/accepted (search `src/modules/filing/` and `src/app/api/filing/` for a status transition to something like `ACCEPTED` or `FILED` distinct from `filing/[id]/transmit`, which already emits `ACE_FILING_TRANSMITTED`). Wire `CUSTOMS_ENTRY_COMPLETED` there. If no such distinct transition exists (i.e. transmission *is* completion in this system), skip this task and note in the PR description that `CUSTOMS_ENTRY_COMPLETED` and `ACE_FILING_TRANSMITTED` are the same real-world event here — don't emit both for one occurrence.

### Capability C — Explicit non-scope (data gaps, do not invent integration points)

- **PGA_PROCESSING_COMPLETED, ISF_FILING_TRANSMITTED, drawback-related events**: no PGA-specific module, no ISF module exists in this codebase today (confirmed by search). Do not wire these to a loosely-related agent just to check a box — that would silently misattribute cost/revenue to the wrong capability. Leave `PGA_PROCESSING_COMPLETED` and `ISF_FILING_TRANSMITTED` defined in `constants.ts` (already present) but unemitted, and note this explicitly in the PR description as deferred until those product capabilities exist. `RECONCILIATION_ENTRY_PREPARED` (distinct from the already-wired `RECONCILIATION_COMPLETED`) is in the same position — check `src/modules/drawback/` and `src/modules/reconciliation/` briefly; if there's a real "reconciliation entry prepared for filing" step distinct from cross-document reconciliation, wire it, otherwise defer.

### Capability D — Fix the CONDITIONAL pricing silent gap

- **Task D-1**: `ratingEngine.ts:190-199` currently requires the *producer* of a usage event to set `metadata.billingConditionMatched === true`, or the rule silently produces no charge and no exception. Replace this with a real (small, non-Turing-complete) condition evaluator: `evaluateRateRuleCondition(conditions: Json, usageEvent: UsageEvent): boolean` in a new file `src/lib/billing/conditionEvaluator.ts`, supporting simple `{ field, operator, value }` comparisons against `usageEvent.metadata` and core fields (e.g. `{ field: "metadata.confidence", operator: "lt", value: 0.8 }` for the spec's "$20 only when AI confidence is below a threshold" example, §13). Operators: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`.
- **Task D-2**: When a `CONDITIONAL` rule's condition evaluates false, that's expected (not billable) — return `null` as today. When the condition *references a field that doesn't exist on the event* (e.g. rule expects `metadata.confidence` but the event has no such key), create a `BillingException` (`type: "CONDITION_FIELD_MISSING"`) instead of silently skipping — this is the same honesty principle as the missing-cost-profile and missing-rate-card exceptions already in `ratingEngine.ts:84-107` and `costingEngine.ts:24-39`.

### Validation — Phase 1

- **Task V-1**: Replace `tests/billing-engine.test.ts` — it currently re-implements the pricing math inline (e.g. `const grossAmount = billableQty * unitRate` duplicated by hand) rather than calling the real functions, so it would pass even if `ratingEngine.ts` were broken. Rewrite it to import and call `evaluateAndRateUsageEvent`, `calculateAndRecordEventCost`, and `getShipmentFinancialSummary` directly.
  - These functions call `db` (Prisma) directly, which is not how this repo's other pure-logic modules are tested (see `src/modules/admin/permissionSync.ts`'s injectable `PermissionSyncStore` interface, and `src/modules/shipments/resolveShipment.ts`'s injectable `ShipmentLookup`, both exercised in `tests/tenant-isolation-routes.test.ts` without a live database). Follow that pattern: refactor `ratingEngine.ts` to separate a pure `computeChargeAmount(rule: RateRuleLike, usageEvent: UsageEventLike): { grossAmount: number; trace: object } | null` from the DB-touching `evaluateAndRateUsageEvent` wrapper. Same split for `costingEngine.ts` (pure `computeCost(...)` vs. DB-touching `calculateAndRecordEventCost`). This refactor is also a hard prerequisite for Phase 5's rate simulation (Capability, below) — do it once, use it twice.
  - Test the pure functions directly with constructed inputs for all 13 pricing models, the min/max clamp, the once-per-shipment dedup logic, and the new condition evaluator (Task D-1).
- **Task V-2**: Add an integration-style test (using a real/test Postgres connection the way any DB-touching test in this repo does — check `tests/` for the existing convention before assuming one) for `PipelineOrchestrator.processEvent` asserting that a `DOCUMENT_UPLOADED` trigger produces the expected `UsageEvent` rows with correct `eventCode`/`quantity`/`shipmentId`, and that re-running the same `runId` doesn't double-emit (idempotency).
- **Task V-3**: Manual QA: upload a document end-to-end in the running app, then confirm rows appear in `Billing → Usage Ledger` (`src/app/app/billing/usage/page.tsx`) with non-empty `sourceFunction`/`sourceAgent`, and that a `ShipmentCharge` appears if an active rate card maps the emitted event codes.

---

## Phase 2 — Rate card lifecycle completeness

Current state: `src/app/app/billing/actions.ts` only has `createRateCardAction`, `saveRateRuleMappingsAction`, `activateRateCardAction`. There is no edit, retire, duplicate, or new-version action anywhere — `RateCardVersion` supports multiple versions in the schema but nothing ever creates a second one.

### Capability A — Version lifecycle

- **Task A-1**: Add `createNewRateCardVersionAction(rateCardId)` to `actions.ts`: clones the latest version's `RateRule` rows (and their `RateRuleCapabilityMapping`s) into a new `RateCardVersion` with `version: currentVersion + 1`, `status: "DRAFT"`, bump `RateCard.currentVersion`. Block if the rate card's current ACTIVE version has an `effectiveDate` in the future with no gap logic needed — just require the new version's `effectiveDate` to be set explicitly by the user (default: today) before activation.
- **Task A-2**: Add `updateDraftRateRuleAction` / `deleteDraftRateRuleAction` / `addDraftRateRuleAction` to `actions.ts`, all guarded by `rateCardVersion.status === "DRAFT"` (reject with a clear error otherwise — this is what makes activated versions immutable per §6). Reuse the validation already in `createRateCardAction` (name/rate non-negative checks, `actions.ts:38-40`).
- **Task A-3**: Add `retireRateCardAction(rateCardId)`: sets `RateCard.status = "RETIRED"`. Must not affect any `RateCardVersion` already referenced by historical `ShipmentCharge.rateCardVersionId` — verify `resolveActiveRateCardVersion` (`ratingEngine.ts:19`) already filters on `status: "ACTIVE"` for the parent `RateCard` (it does, line 34) so retiring is safe by construction; add a test to lock that in (see Validation).
- **Task A-4**: Add `duplicateRateCardAction(rateCardId, targetClientId?, targetImporterId?)`: clones name/currency/rules/capability mappings into a brand-new `RateCard` + v1 `RateCardVersion` in `DRAFT` status, optionally re-targeted at a different client/importer (spec §8 "duplicate from another client").
- **Task A-5**: UI: on `src/app/app/billing/rate-cards/[id]/page.tsx`, add "Create New Version" (visible when `status === "ACTIVE"`), "Retire", and "Duplicate" buttons next to the existing "Activate Rate Card" button (line 59). Add a version-history list (query `rateCard.versions` — already fetched at line 22-26, just render more than `versions[0]`).
- **Task A-6**: UI: on `rate-cards/[id]/page.tsx`, when the current version is `DRAFT`, render an editable line-item table (add/edit/delete rows) instead of the read-only view implied by the current mapping-only `MappingClient.tsx`. This can be a new client component `RateRuleEditor.tsx` alongside `MappingClient.tsx`.

### Capability B — XLSX import

- **Task B-1**: Add an XLSX parsing dependency. `package.json` currently has `csv-parse` only. Add `xlsx` (SheetJS) or `exceljs` — check for any existing license/security constraint on new dependencies in this repo before picking (grep `package.json` for a pattern; if none, prefer `exceljs` for safer parsing of untrusted uploads).
- **Task B-2**: In `src/app/app/billing/rate-cards/import/actions.ts`, extend `parseRateCardUploadAction` (currently rejects non-`.csv` at line 28) to branch on `.xlsx`/`.xls` extension and parse the first sheet into the same `{ headers, rows }` shape the CSV path already produces, so `createImportedRateCardAction` needs no changes.
- **Task B-3**: Update `src/app/app/billing/rate-cards/import/page.tsx` — remove the "XLSX is intentionally blocked" copy (line 162) and the `accept=".csv"` restriction (line 164) once B-2 lands.
- **Task B-4**: Enforce the same `MAX_UPLOAD_BYTES` (5MB, `import/actions.ts:10`) and row-preview cap (`MAX_PREVIEW_ROWS`, 250) for XLSX.

### Validation — Phase 2

- **Task V-1**: Vitest for the pure clone logic in A-1/A-4 (extract the "clone these rules into a new version/card" step into a testable pure function taking arrays in, arrays out, rather than only testing through `db.$transaction`).
- **Task V-2**: Vitest confirming `resolveActiveRateCardVersion` never returns a `RETIRED` card's version even if a version row is still `status: "ACTIVE"` (lock in A-3's safety claim).
- **Task V-3**: Manual QA: upload a real multi-sheet XLSX rate card, confirm only the first sheet is used and preview rows match Excel's values exactly (watch for date/number auto-coercion — a common SheetJS footgun with rate/currency columns).
- **Task V-4**: Manual QA: activate v1, create v2 as a draft, edit a rate in v2, activate v2, then check a historical `ShipmentCharge` created against v1 still shows v1's rate in its calculation trace (§6 "changing a rate card must never retroactively change historical billing").

---

## Phase 3 — Billing operations: payments, invoice lifecycle, export

### Capability A — Wire up payment recording (currently dead code)

`recordInvoicePayment` (`src/lib/billing/invoicing.ts:121`) is fully implemented — transactional, validates payment doesn't exceed balance, updates `paidAmount`/`balanceDue`/`status` — but is **never called from anywhere**, and the `billing.payment.record` permission (`permissions.ts:472`) is never checked anywhere either. There is also no invoice detail page — only the list at `src/app/app/billing/invoices/page.tsx`.

- **Task A-1**: Build `src/app/app/billing/invoices/[id]/page.tsx` — invoice detail with drill-down: invoice → lines → shipment → underlying `ShipmentCharge` → `UsageEvent` (the trace chain §23/§26 requires). Reuse the "Why this charge exists" pattern from `charges/[id]/page.tsx:48-66`.
- **Task A-2**: Build `src/app/app/billing/invoices/[id]/actions.ts` with `recordPaymentAction(invoiceId, formData)` calling `recordInvoicePayment`, gated by `hasPermission("billing.payment.record")` (finally using the permission that already exists). Form fields: amount, payment method, reference number, notes, date.
- **Task A-3**: Add a payment form + payment history list to the invoice detail page (A-1), modeled on the adjustment form/history pattern already in `charges/[id]/page.tsx:68-102`.
- **Task A-4**: Link invoice rows in `invoices/page.tsx` to the new detail page (currently rows aren't clickable).

### Capability B — Invoice lifecycle states

Today only `DRAFT`, `INVOICED`/`RATED` (on charges), and `PAID`/`PARTIALLY_PAID` (on invoices, set by `recordInvoicePayment`) are ever set. `InvoiceStatus` has `PENDING_APPROVAL`, `APPROVED`, `SENT`, `OVERDUE`, `VOID`, `DISPUTED`, `CREDITED` defined in the enum (`schema.prisma:5186-5198`) but nothing transitions to them.

- **Task B-1**: Add `submitInvoiceForApprovalAction` (`DRAFT` → `PENDING_APPROVAL`), `approveInvoiceAction` (`PENDING_APPROVAL` → `APPROVED`), `sendInvoiceAction` (`APPROVED`/`SENT` idempotent → `SENT`) to a new `src/app/app/billing/invoices/[id]/actions.ts` (co-locate with A-2). Gate `approveInvoiceAction` and `sendInvoiceAction` behind the new granular permissions from Phase 4 (`billing.invoice.approve`, `billing.invoice.send`) — until Phase 4 lands, gate behind existing `billing.invoice.manage` as an interim.
- **Task B-2**: Add `voidInvoiceAction(invoiceId, reason)`: only allowed pre-payment (`paidAmount === 0`); on void, set `Invoice.status = "VOID"` **and** unlock every `ShipmentCharge` referencing this invoice's lines back to `status: "RATED"`, `invoiceLineId: null` so they become eligible for a new invoice (mirrors the reversal pattern §21/§47 requires — "corrections must use reversal, not mutation"). Do this inside one `db.$transaction`, following the pattern already used in `invoicing.ts:41` and `invoicing.ts:133`. Require a `reason` string and write an audit log (`createAuditLog`, matching every other billing action in `actions.ts`).
- **Task B-3**: Decide and document the `OVERDUE` approach rather than guessing at query time inconsistently: recommend computing "is this invoice overdue" as a derived value (`dueDate < now && balanceDue > 0`) everywhere it's displayed, rather than a stored cron-flipped status — this avoids needing a new scheduled job for something Vercel Hobby's 1x/day cron cadence makes awkward to keep fresh (see prior audit note on cron constraints). Apply this derived check in `invoices/page.tsx` (badge) and the billing overview dashboard (`page.tsx:42-44`, which already counts `OVERDUE` invoices as `0` today since nothing sets that status). If the team later wants `OVERDUE` to be a real queryable status (e.g. for report filters), that's a stretch task: a daily Inngest step scanning `SENT`/`PARTIALLY_PAID` invoices past due and flipping status — follow the existing Inngest patterns in `src/lib/inngest/`.
- **Task B-4**: `DISPUTED`/`CREDITED` states: add `disputeInvoiceAction`/mark-credited as thin status-transition actions once B-1/B-2 land; low priority relative to the rest of this phase — implement only if time remains after B-1/B-2/B-3 and Phase 3 Capability C.

### Capability C — Invoice export (PDF / CSV / XLSX)

- **Task C-1**: PDF: add `GET /api/billing/invoices/[id]/export?format=pdf` using the existing `generateSimplePdfBuffer` (`src/lib/pdf/pdfGenerator.ts:6`) — pass invoice metadata (number, client, dates, totals) and a `sections` array with one section per invoice line. This reuses infrastructure already proven for other compliance PDFs in this codebase; do not add a new PDF library.
- **Task C-2**: CSV: same route, `?format=csv` — invoice lines to CSV. Check whether `csv-stringify` (sibling of the already-installed `csv-parse`) is available before hand-rolling CSV escaping; if not installed, add it (small, well-understood dependency, safer than manual string joining for a financial export).
- **Task C-3**: XLSX: same route, `?format=xlsx`, using the library added in Phase 2 Capability B.
- **Task C-4**: Support the three invoice detail levels from §24 (Summary / Detailed / Fully Detailed) as a query param (`?detail=summary|detailed|full`) controlling whether line-level, shipment-level, or transaction-level rows are included. Summary is the default (aggregated service totals, matching how `InvoiceLine` already groups by description in `invoicing.ts:80-84`).
- **Task C-5**: Wire "Export" buttons on both the invoice list (`invoices/page.tsx`) and invoice detail (A-1) pages, each gated by `billing.report.export` (new, Phase 4) or `billing.invoice.manage` as interim.

### Validation — Phase 3

- **Task V-1**: Vitest for `voidInvoiceAction`'s charge-unlock transaction: assert charges return to `RATED`/`invoiceLineId: null`, and that voiding a partially-paid invoice is rejected.
- **Task V-2**: Vitest for `recordPaymentAction` permission gate (denies without `billing.payment.record`) and for the existing `recordInvoicePayment` overpayment guard (`invoicing.ts:138`) — this function has logic but, per the audit, zero test coverage since it was never called; write a real test against it now that it's wired up.
- **Task V-3**: Manual QA: full lifecycle — create draft invoice → submit for approval → approve → send → record partial payment → record final payment → confirm status reaches `PAID` and `Billing Overview`'s Outstanding AR tile drops accordingly (`page.tsx:87-93`).
- **Task V-4**: Manual QA: export a real invoice to PDF/CSV/XLSX and open each in its native viewer — confirm line totals sum to the invoice total in every format.

---

## Phase 4 — Granular billing permissions

The spec (§42) wants ~30 granular codes; the app has 8 coarse ones. The good news: the underlying permission infrastructure (`Permission`/`Role`/`RolePermission` tables, `syncPermissionCatalogue`, the admin "Sync Permissions" button at `RolesPermissionsPanel.tsx:15-46`) is already generic and DB-backed — **no new tables, no new sync mechanism needed.** This phase is additive entries in `PERMISSION_CATALOGUE` plus updating call sites to check the more specific code.

- **Task A-1**: Add these new entries to `PERMISSION_CATALOGUE` in `src/lib/permissions.ts` (after line 482), each with a `category: "Billing"` and sensible `defaultRoles` (mirror the existing pattern — `OWNER`/`ADMIN` for admin-tier, `+BROKER` for manager-tier where the existing `billing.charge.adjust` already includes `BROKER`):
  - `billing.ratecard.view`, `billing.ratecard.create`, `billing.ratecard.upload`, `billing.ratecard.edit`, `billing.ratecard.activate`, `billing.ratecard.retire` — split out of today's single `billing.ratecard.manage`. **Keep `billing.ratecard.manage` in the catalogue** (mark its description as "legacy umbrella — superseded by the specific `billing.ratecard.*` codes" rather than deleting it) so existing role grants don't silently lose access mid-migration; update call sites to check the specific new code, falling back to `billing.ratecard.manage` with an `||` for one release, then remove the fallback in a follow-up cleanup once roles have been re-synced.
  - `billing.mapping.view`, `billing.mapping.edit` — gate `MappingClient.tsx`'s save action (currently under `billing.ratecard.manage`, `actions.ts:89`) behind `billing.mapping.edit` specifically, since a Billing Manager per §39 should manage mappings without needing full rate-card admin.
  - `billing.usage.view` — gate `usage/page.tsx` (currently ungated beyond `billing.view` from the layout).
  - `billing.charge.view`, `billing.charge.waive` — split `billing.charge.waive` out of today's `billing.charge.adjust` so waivers (which already require admin-tier approval in `charges/[id]/actions.ts:38`) have their own auditable grant, matching §20's "waivers need their own threshold."
  - `billing.discount.create`, `billing.discount.approve`, `billing.credit.create`, `billing.credit.approve` — same split from `billing.charge.adjust`.
  - `billing.invoice.view`, `billing.invoice.create`, `billing.invoice.edit`, `billing.invoice.approve`, `billing.invoice.send`, `billing.invoice.void` — split out of `billing.invoice.manage` (kept as legacy umbrella per the same transition strategy as ratecard); wire into Phase 3 Capability B's new actions.
  - `billing.payment.view` (view-only, distinct from the already-existing `billing.payment.record`).
  - `billing.report.export` — split from `billing.reports.view` (view vs. export, per §42).
  - `billing.settings.manage` — gate `settings/actions.ts`'s `saveCostProfileAction` (currently under `billing.ratecard.manage`, `settings/actions.ts:19`, with its own comment already acknowledging this is a stand-in — replace it now).
  - `billing.permissions.manage`, `billing.audit.view` — new, no current equivalent; `billing.permissions.manage` should gate nothing billing-specific beyond what the existing admin roles page already does (document this as effectively an alias unless a dedicated billing-permissions sub-screen is built — not required by this plan).
- **Task A-2**: Update every `requireBillingPermission(...)` / `hasPermission(...)` call site touched by Phases 1-3 to use the new specific codes (list: `actions.ts`, `charges/[id]/actions.ts`, `settings/actions.ts`, `rate-cards/import/actions.ts`, the new `invoices/[id]/actions.ts`).
- **Task A-3**: Run the existing `POST /api/admin/permissions/sync` (or trigger it via the admin UI button) after merging — confirm new permissions appear for existing system roles per each entry's `defaultRoles`, and that no existing role silently loses a capability it had under the old coarse code (this is exactly what `syncPermissionCatalogue`'s `descriptionsUpdated`/`grantsAdded` result is for — check it, don't assume).

### Validation — Phase 4

- **Task V-1**: Vitest for `syncPermissionCatalogue` (already testable via the injectable `PermissionSyncStore`, `permissionSync.ts:21-29`) asserting the new billing permissions get created and granted to their default roles, and that running sync twice is a no-op the second time (idempotency, already asserted for the existing catalogue — extend, don't duplicate).
- **Task V-2**: Manual QA: log in as each of the four spec'd personas (Admin, Manager/BROKER, User/MEMBER, Read-Only/VIEWER — map to this repo's actual role names) and confirm the Billing nav tabs and action buttons that appear/disappear match §38-41's capability tables.

---

## Phase 5 — Reporting, profitability analytics, rate simulation

### Capability A — Broker/user reporting (§33 — entirely missing today)

- **Task A-1**: New page `src/app/app/billing/reports/brokers/page.tsx` (or a new tab on the existing `reports/page.tsx`), gated `billing.reports.view`. Group `UsageEvent` by `userId` where `automated: false`: shipments handled (distinct `shipmentId` count), manual interventions (row count), hours (sum `ShipmentCost.durationSec` where `costType: "LABOR"` joined by `userId`), internal labor cost (sum `ShipmentCost.amount` for those rows), average handling time.
- **Task A-2**: Frame this per §33's explicit instruction — do not present it as productivity monitoring. Label it "Operational Workload & Automation Opportunity," not "Broker Performance."

### Capability B — Service-level reporting (§30, §35 "which services are underpriced/lose money")

- **Task B-1**: Group `ShipmentCharge` by `rateRule.serviceCode` (join through `RateRule`), joined against `ShipmentCost` by shared `usageEventId` for cost-per-service. Add to `reports/page.tsx` as a third table alongside the existing Agent and Client tables.

### Capability C — Real customs pass-through economics (currently hardcoded to zero)

`getShipmentFinancialSummary` (`src/lib/billing/ledger.ts:91-99`) returns `{ duty: 0, mpf: 0, hmf: 0, taxes: 0, otherFees: 0, totalPassThrough: 0 }` unconditionally — the comment claims these are "extracted from shipment metadata" but nothing extracts them.

- **Task C-1**: Locate where duty/MPF/HMF/tax are actually computed and persisted today — `pipelineOrchestrator.ts:88-94`'s `computeDutyDue` calls `computeFilingTariff` (`src/lib/tariff/dutyEngine.ts`), and there's a `FilingSnapshot` concept referenced elsewhere in this codebase (check `src/modules/filing/` and the Prisma schema for where a duty stack is actually stored per shipment/entry, not just computed transiently).
- **Task C-2**: Wire `getShipmentFinancialSummary` to read the persisted duty stack for the shipment (not recompute it — that's the tariff engine's job, this function should just read the result) and populate the `customsEconomics` block for real.
- **Task C-3**: This is the one place in the ledger where getting the source wrong causes real harm (conflating duty with broker revenue is exactly what §16 and §45 warn against) — do not guess a field name; if the persisted duty-stack location isn't obvious after a targeted search, flag it as a blocking question rather than wiring to something that might be a preview/estimate value rather than a filed/final one.

### Capability D — Rate simulation (§36 — entirely missing today)

- **Task D-1**: This depends on Phase 1 Validation Task V-1's refactor (pure `computeChargeAmount` extracted from `evaluateAndRateUsageEvent`). Build `simulateRateCard(proposedRateCardVersionId: string, historicalUsageEvents: UsageEvent[]): { totalRevenue, byClient, byService }` in `src/lib/billing/rateSimulation.ts` — for each historical `UsageEvent`, run it through the pure calculation function against the *proposed* version's rules instead of the version that was actually active at the time, without writing anything to `ShipmentCharge`.
- **Task D-2**: Server action `runRateSimulationAction(proposedRateCardVersionId, months: number)` — pull the last N months of `UsageEvent` rows for the accounts/clients the proposed rate card targets, run Task D-1, compare against the *actual* historical revenue (sum of real `ShipmentCharge.netAmount` for the same events) to produce the current-vs-proposed delta from §36's example.
- **Task D-3**: New page `src/app/app/billing/rate-cards/[id]/simulate/page.tsx` — form to pick a historical window, results table (current revenue / proposed revenue / difference / current margin / proposed margin, with client and service breakdowns per §36).

### Validation — Phase 5

- **Task V-1**: Vitest for `simulateRateCard` using the same pure-function test fixtures built in Phase 1 V-1 — confirm it produces identical numbers to what `evaluateAndRateUsageEvent` would have produced had the proposed version been active (i.e., the simulation math is provably the same code path as real rating, not a parallel reimplementation that can drift).
- **Task V-2**: Manual QA: simulate a rate card against a client with real historical usage, spot-check 3-5 individual shipment totals by hand against the on-screen numbers.

---

## Phase 6 — Data model refinements (do only after Phases 1-5; lowest priority)

- **Human work tracking (§14)**: recommend **against** adding a dedicated `HumanWorkActivity` entity as spec'd literally. The existing `UsageEvent` (user, shipment, client, automated flag, processingDuration, metadata) + `ShipmentCost` (`costType: "LABOR"`, `durationSec`, `userId`) combination already captures everything §14 asks for once Phase 1 Capability B's `HTS_MANUAL_REVIEW_COMPLETED` wiring (and its future real duration timer, B-3) lands. Adding a parallel entity would duplicate data and create a reconciliation problem between two "sources of truth" for the same review event. If a future need arises for freeform "reason for intervention" taxonomy beyond what `metadata` JSON supports, extend `UsageEvent.metadata` with a documented shape rather than a new table.
- **`ServiceCatalogItem` / `BillingCapability` as separate entities (§44)**: the spec's data model lists these as distinct from `BillingEventDefinition` and `RateRule.serviceCode`. In practice, `BillingEventDefinition` (capability/event catalog) and `RateRule.serviceCode` (commercial service naming) already cover this distinction. Do not add two more tables unless a concrete need emerges (e.g. a service sold without any billing-event mapping at all, which the current model can't express since every `RateRule` implies at least a name/rate independent of mappings — check whether that's actually a real requirement before building it).

---

## Sequencing

Phase 1 must land before Phases 2-6 produce meaningful data (rate cards and reports are only as good as the usage events feeding them). Phase 2 and Phase 3 can proceed in parallel once Phase 1's engine refactor (V-1's pure-function split) is merged, since Phase 3 doesn't depend on it. Phase 4 (permissions) should land alongside or immediately after Phase 3, since Phase 3's new actions are written to check the new granular codes directly. Phase 5 depends on Phase 1's pure-function refactor (Capability D) and is otherwise independent. Phase 6 is a documentation/design decision, not blocked by anything — could be resolved and written up first if a fast "no-code" win is wanted early.

Suggested PR breakdown (small enough to review, in dependency order):
1. Phase 1 Capability A (central emission hook) + Validation V-1's engine refactor
2. Phase 1 Capabilities B-D + remaining validation
3. Phase 2 (rate card lifecycle + XLSX)
4. Phase 3 Capability A (payments) — highest user-visible value, do before B/C
5. Phase 3 Capabilities B-C (invoice lifecycle + export)
6. Phase 4 (permissions) — touches call sites from 1-5, so sequence last among the "core" work
7. Phase 5 (reporting + simulation)
8. Phase 6 (write-up only, no code — can move earlier if useful)

## Definition of Done (maps to source doc §52)

| # | Requirement | Closed by |
|---|---|---|
| 1-3 | Rate card create/upload/mapping/pricing models | Already done (MVP) + Phase 2 |
| 4 | Operational functions emit immutable usage events | Phase 1 |
| 5-6 | Usage events auto-create charges, real-time | Already done (MVP), extended by Phase 1 |
| 7 | 3-layer shipment view | Already done for revenue/cost/margin; Phase 5 Capability C for real customs economics |
| 8 | Discounts/credits/waivers/surcharges/adjustments | Already done (adjustments) + Phase 4 (granular approval) |
| 9 | Fully auditable | Already done via `createAuditLog` throughout |
| 10-11 | Permissions, admin can edit active config | Phase 4 |
| 12 | Invoiced history immutable | Already enforced (`charges/[id]/actions.ts:27`) |
| 13 | Generate invoices from unbilled charges | Already done (MVP) |
| 14 | Export PDF/CSV/XLSX | Phase 3 Capability C |
| 15 | Payments, outstanding, overdue | Phase 3 Capability A + B |
| 16 | Report at all levels incl. broker/user, service | Phase 5 Capabilities A-B |
| 17 | Revenue leakage / exceptions | Already done (MVP) |
| 18 | Explain every charge | Already done (`charges/[id]/page.tsx`'s calculation trace), extend to invoices in Phase 3 Capability A-1 |

Every phase above should be validated against its own Validation section before being marked done — do not mark a Definition-of-Done row complete based on code existing; validate it does what the row claims.
