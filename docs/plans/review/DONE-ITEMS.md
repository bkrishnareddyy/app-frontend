# Qubere — Confirmed Done Since Baseline
> Compiled: 2026-08-13 (second-pass re-audit). Everything below was independently re-verified against current code — file:line checked, not taken from a status claim — and confirmed genuinely fixed since the 2026-08-13 baseline audit. Full detail in the linked per-feature audit file.

Overall: **~62% → ~77%** average readiness across all 13 features.

---

## Legal / compliance exposure — all three headline fake-data findings resolved

- **`/api/audit/export` no longer returns a fabricated download URL.** Now performs a real `@vercel/blob` `put()` upload and returns the actual `blob.url`; returns an honest `501` if storage isn't configured instead of a fake link. Verified independently by two audits (F08, F12). [F06-F07-F08](F06-F07-F08-audit.md), [F11-F12](F11-F12-audit.md)
- **`reasonableCarePackage.ts` no longer fabricates CBP-audit-defense data.** Hardcoded CBP importer number, fake GRI steps, fake 95% confidence, zeroed valuation, and the fake `"DIGITALLY_SIGNED_QUBERE"` signature are all gone — now genuinely sourced from `ClassificationCase`/`GriAnalysisStep`/`EvidenceItem`, the real reviewer, `ValuationAssistsRecord`, and `ImporterOfRecord`, with honest nulls where data is truly missing. [F06-F07-F08](F06-F07-F08-audit.md)
- **`focusedAssessment.ts`'s "AI-generated narrative" is now a real Anthropic API call**, not a mislabeled static template, with a clearly-logged fallback only on failure. Importer CBP number/address now sourced from real `ImporterOfRecord` data. [F06-F07-F08](F06-F07-F08-audit.md)

## Security / tenant isolation

- **`DataMode` Prisma middleware built from scratch.** `src/lib/db.ts` (19 → 166 lines) now has a real `$extends`-based interceptor using `AsyncLocalStorage`, wired through `withAuthenticatedRoute`, injecting `dataMode` filters into every query. Dedicated test suite passes (32/32). This was the single largest F12 gap and is now fully closed. [F11-F12](F11-F12-audit.md)
- **Permission-gate rollout closed from 66-of-146 to ~1-of-155 ungated mutation routes.** All specifically-cited routes (`decisions`, `decisions/bulk`, `shipments`, `filing`, `compliance/audits/run`, `bind-classification`) are now gated; remaining 13 exceptions are legitimately exempt (crons, platform-admin, session cookie route, HMAC-verified webhook). [F11-F12](F11-F12-audit.md)
- **Cross-account notification leak in the regulatory cron fixed and tested.** The unfiltered `db.accountMembership.findMany()` now filters by `accountId` + `regulatory.review` permission, covered by a passing test. (Note: a narrower availability bug was introduced in the same change — see Open Items.) [F09-F10](F09-F10-audit.md)
- **AuditLog is now genuinely append-only at the DB level.** A real migration enables Postgres RLS and a trigger that `RAISE EXCEPTION`s on any `UPDATE`/`DELETE` against the table; `assertAppendOnlyAuditPolicy()` actually enforces this now instead of unconditionally returning `true`. [F06-F07-F08](F06-F07-F08-audit.md)

## Core money/duty engine

- **`computeFilingTariff` (the live filing path) is now Decimal end-to-end** — no more `+=`/`Math.round(x*100)/100` float aggregation. The `stack.base.gt(0)` bug that silently zeroed customs value on duty-free lines is also gone. [F06-F07-F08](F06-F07-F08-audit.md)
- **The hardcoded `"2.8%"` duty-rate fallback is gone from `landedCost.ts`, `drawback.service.ts`, and the refund scanner** — all now call `calculateDutyStack`/`loadHtsCodesMap` for real per-HTS-code rates. [F06-F07-F08](F06-F07-F08-audit.md), [F09-F10](F09-F10-audit.md)
- **`HtsDutyRate` now has real schema fields for Section 301 tranche, AD/CVD case number, and manufacturer**, with "most-specific-wins" lookup logic — Section 301/AD/CVD are no longer hardcoded switches or silent `$0` by construction (seed *coverage* is still sparse — see Open Items). [F06-F07-F08](F06-F07-F08-audit.md)
- **`ValuationAssistsRecord` now actually persists** — the valuation tab is a durable record, not calculate-on-click. Assist proration method (`per_unit` vs `entire_shipment`) is now actually read and branched on. [F06-F07-F08](F06-F07-F08-audit.md)
- **`ShipmentLineItem.dutyStack` is now written** on create/update — the field existed but was never populated before. [F06-F07-F08](F06-F07-F08-audit.md)

## HTS classification / GRI engine

- **`GriRulesEngine` now evaluates all of GRI 1–6** (was only ever GRI 1 and 6), derives confidence from a real evidence inventory instead of 4 hardcoded constants, and produces up to 3 competing proposals instead of always exactly one — the "compare competing proposals" UI (previously impossible) now works. [F04-F05](F04-F05-audit.md)
- **CROSS ruling relevance score is now computed, not hardcoded to `0.88`** — derived from real HTS-prefix matching. [F04-F05](F04-F05-audit.md)
- **Classification change-impact `dutyImpact` is now real Decimal arithmetic off actual duty rates**, not hardcoded to `Decimal(0)` — the duty-delta UI can now actually render. [F04-F05](F04-F05-audit.md)
- **AD/CVD "POSSIBLY" scope screening now makes a real Claude API call** for GRI-style reasoning, replacing a static string. [F06-F07-F08](F06-F07-F08-audit.md)

## Bulk actions & queue

- **Bulk-approve idempotency check fixed** — now checks all status/triageState aliases, not a string that was never actually stored. [F04-F05](F04-F05-audit.md)
- **Bulk-waive on exceptions fixed** — `resolutionReasonCode` is now read from the request body and passed through; previously every bulk-waive call failed. [F04-F05](F04-F05-audit.md)
- **`/app/actions` now selects and renders `triageState`/`blockedReason`/`autoApprovalPolicy`** — previously deliberately excluded on a mistaken belief the migration hadn't landed. [F04-F05](F04-F05-audit.md)
- **`AgentPolicyConfig` per-account thresholds are genuinely wired into `applyAutoApprovalPolicy`** — confirmed independently, not just claimed. [F01](F01-audit.md)
- **Pagination confirmed real and bounded on all 7 spec'd endpoints** (previously only 3 were verified) — none of `exceptions`/`findings`/`drawback/claims`/`shipments`/`documents`/`parties`/`products` are unbounded. [F01](F01-audit.md)

## Duty recovery / drawback

- **`createDrawbackLotsFromFiling` is now wired into the real filing-acceptance flow** (was dead code before, only reachable via a fake seed script). [F09-F10](F09-F10-audit.md)
- **A real drawback claim workflow state machine now exists** (`Draft→Prepared→Submitted→{Accepted,Rejected}→Paid`, broker-only submit enforced) — claims were previously permanently stuck at Draft. [F09-F10](F09-F10-audit.md)
- **`POST /api/drawback/match` now returns 422 on insufficient lot quantity** instead of silently under-matching. [F09-F10](F09-F10-audit.md)
- **`FilingSnapshot.hasSection301`/`section301List` are now written** at filing time — the Section 301 Readiness Inventory no longer always reports zero entries. [F09-F10](F09-F10-audit.md)
- **PSC eligibility, correction-type enum, and impact calculation are all now real** — Decimal-based, checks the real `PSC_WINDOW` compliance deadline (which is now actually created on filing acceptance). [F09-F10](F09-F10-audit.md)
- **A real dedicated reconciliation-management page now exists** (`/app/reconciliation`) with type/status filtering — previously entirely absent. [F09-F10](F09-F10-audit.md)

## Regulatory & tariff intelligence

- **Regulatory-ingest's hardcoded mock Federal Register document fallback is gone** — an honest 502 on fetch failure instead. [F09-F10](F09-F10-audit.md)
- **The fake 1.7% regulatory-impact rate delta is gone**, replaced with real computation from `HtsChange` rows; the unit test no longer encodes the fake number as ground truth. [F09-F10](F09-F10-audit.md)
- **Tariff scenario modeling is now fully real**: `manufacturer`/`tradeAgreementClaim` fields added to the schema, `calculate`/`compare` routes now use real per-HTS-code rates (the prior line-items-real-but-calculate-fake disconnect is resolved), the "HTS Release" label shows a real date, `Shipment.scenarioId` linking works end-to-end. [F09-F10](F09-F10-audit.md)
- **A real alternative-sourcing breakeven function now exists**, replacing the prior arbitrary formula, for the `/compare` endpoint. [F09-F10](F09-F10-audit.md)

## Platform / product / party

- **API key management UI built from scratch** (`ApiKeyPanel.tsx`) — create/label/revoke, full backend was already there. [F11-F12](F11-F12-audit.md)
- **Dashboard now has real three-section layout and a real filing cycle-time timeline chart** consuming actual `WorkMetricSnapshot` history. [F11-F12](F11-F12-audit.md)
- **Client-level dashboard filtering now actually wired into the metrics fetch** (selector existed before but was never plumbed through). [F11-F12](F11-F12-audit.md)
- **Real Inngest infrastructure now exists** — two live scheduled jobs (`dailyComplianceAudit`, `dailyWorkMetricSnapshot`) replace what was previously zero Inngest code anywhere in the repo. [F06-F07-F08](F06-F07-F08-audit.md)
- **Webhook delivery genuinely fires for 2 of 6 event types** (`decision.approved`, `filing.submitted`) — was fully-built but zero-call-sites before. [F11-F12](F11-F12-audit.md)
- **`bind-classification` route permission gap closed.** [F11-F12](F11-F12-audit.md)

## Infrastructure

- **A real CI pipeline now exists** (`.github/workflows/ci.yml`) — Postgres service container, runs lint/test/openapi-generation on every push/PR. There was none before. [F01](F01-audit.md)
- **`x-request-id` header is now read from the incoming request** before generating a fresh one — client/server trace correlation now works. [F01](F01-audit.md)
