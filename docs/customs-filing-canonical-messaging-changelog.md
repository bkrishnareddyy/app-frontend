# Customs Filing Canonical Messaging — Implementation Changelog

Tracks implementation of `docs/customs-filing-canonical-messaging-prompt.md` against the real codebase. Newest entries first.

---

## 2026-08-12 — Table renaming, schema hygiene, and a real second country proving the design

Three requests, done in dependency order: rename every canonical-messaging table to the `Filing*` convention, re-check the JSON Schemas for anything still US-specific, then actually configure and prove a second country end-to-end -- not just assert the architecture supports one.

### Table rename (`Filing*` naming convention)

Renamed, via plain `RENAME TABLE`/`RENAME CONSTRAINT` migrations (not drop+recreate, so seeded data survived): `CustomsFilingMessage` → **`FilingMessage`**, `CanonicalSchemaVersion` → **`FilingSchemaVersion`**, `CanonicalResponseStatusMapping` → **`FilingResponseStatusMapping`**, `CanonicalMessageAction` → **`FilingMessageActionCatalog`** (not `FilingMessageAction` -- that name is already taken by the hand-written TS action-code type in `types.ts`; the DB table is the catalog *of* those codes). Relation fields renamed to match (`Account.customsFilingMessages` → `filingMessages`, `CustomsFiling.canonicalMessages` → `filingMessages`). Every `db.*` call site across `src/` and `scripts/` updated; `tsc` clean; reseeded and confirmed working under the new names.

**Deliberately not renamed**: `CustomsFiling` and `CustomsResponse` themselves. These are pre-existing, foundational models referenced across dozens of files well outside this feature (including the just-merged 79 upstream commits) -- renaming them is a much larger, higher-blast-radius change than the four tables this feature actually created, and shouldn't happen as a side effect of a naming-convention pass. Flagging this explicitly rather than deciding silently either way.

### Schema hygiene: `filing-request-declaration` bumped to 1.0.1

Re-reading the JSON Schemas with the same critical eye turned up two more instances of the exact "one country's vocabulary presented as universal" mistake, this time baked into the contract itself:
- `entryType`'s own field description said "CBP entry-type code" -- corrected to describe it as this deployment's internal declaration-classification code, resolved to a real per-country procedure via `FilingProcedureMapping`, never sent to a third party directly.
- `compliance.uflpaCleared` named a specific US statute as a first-class field in the canonical contract. Replaced with a generic `complianceFlags: Record<string, boolean>` (a US-bound entry sets `"uflpaCleared"`, an EU-bound one could set `"reachCleared"`, etc.) plus kept `screeningCleared` (genuinely universal) and `licensesRequired` (genuinely universal).

Followed the system's own versioning discipline for this (`CanonicalSchemaVersion`/now `FilingSchemaVersion`, DRAFT/ACTIVE/DEPRECATED/SUPERSEDED) rather than silently editing 1.0.0 in place: added `1.0.1`, and `seedSchemas()` now automatically demotes every other version of a schemaType to `SUPERSEDED` when a new one is seeded ACTIVE, instead of requiring a separate manual step. Verified: `1.0.1` is `ACTIVE`, `1.0.0` is `SUPERSEDED`, `tsc` clean after updating the matching `CanonicalCustomsDeclaration.compliance` TS type.

### A real second country: Germany (DE), zero application code changed

This is the actual proof, not an assertion. Two genuinely country-specific facts got real rows:
- **`FilingProcedureMapping`** (DE): a conservative 3-code subset mapped to the EU's harmonized Customs Procedure Codes (Commission Implementing Regulation (EU) 2015/2447) -- `01` (Consumption) → `4000` (release for free circulation), `21` (Warehouse) → `7100` (customs warehousing), `23` (TIB) → `5300` (temporary admission). Deliberately not all 18 CBP codes -- only the ones with a clean, confident CPC analogue.
- **`FilingAuthorityConfig`** (DE): `"German Customs Administration (Zoll)"` / `"ATLAS - Automated Import System"` (Germany's real electronic customs system).

Along the way, found two tables that were needlessly seeded *per-country* ("US") for data that isn't actually country-specific in value -- `FilingMessageCatalog` (our own internal message names like `CUSTOMS_DECLARATION_SUBMIT` don't vary by destination) and `FilingResponseStatusMapping` (an `ACCEPTED` response means the same state-machine transition everywhere). Generalized both to wildcard (`country: "*"`) rows and deleted the now-redundant US-specific duplicates -- Germany, and every future country, inherits these for free instead of needing them re-seeded per destination.

Also closed a small related gap while touching this code: the outbound envelope header's optional `authority` field was never populated (schema supported it, nothing set it), and `schemaVersion` was a hardcoded literal `"1.0.0"` that would have silently gone stale the moment `1.0.1` shipped. `FilingService.buildMessage()` now stamps the filing's real `authority` and resolves `schemaVersion` from whichever `FilingSchemaVersion` is actually `ACTIVE` at publish time (`getActiveSchemaVersion()`, new export on `schemaValidator.ts`).

**Verified end-to-end with a disposable DE-destined fixture, through the real outbound/inbound queue**: procedure resolves to `4000`; authority resolves to the German config; filing created → validated → approved → transmitted; the actual published envelope carries `country: "DE"`, `procedure: "4000"`, `authority: "German Customs Administration (Zoll)"`, `schemaVersion: "1.0.1"`; the declaration re-validates cleanly against the live ACTIVE 1.0.1 schema; `CANCEL` is correctly offered (via the country-wildcard `FilingChildActionRule`, unchanged); a mock `ACCEPTED` response applied through the now-wildcard `FilingResponseStatusMapping` correctly moved `Transmitted → Accepted` -- the exact same code path US uses, with zero US-specific branching anywhere in it.

---

## 2026-08-12 — Closed the 8 gaps found in the "click Submit to Customs" audit

A customs-expert/senior-dev review of exactly what executes on `POST /api/filing` found the create-filing path itself was the most US-hardcoded part of the whole feature -- worse than the country-agnostic messaging layer sitting downstream of it. Fixed all 8, in dependency order:

- **`src/modules/shipment/countryCode.ts`** (new): ISO 3166-1 alpha-2 vocabulary + `normalizeCountryCode()`/`requireCountryCode()`, same shape and reasoning as `entryType.ts` -- a stable universal standard, kept as code, not per-tenant config.
- **`destinationCountry` finally has a real, validated write path** -- the gap flagged twice before and never closed. Added to the shipment create form and `POST /api/shipments`, to `PATCH /api/shipments/[id]` (validated, audit-logged same as `countryOfOrigin`), and a new inline `DestinationCountryEditor.tsx` on the shipment page next to the client editor.
- **`FilingAuthorityConfig`** (new table, migration `20260812200000_filing_authority_config`): `country -> authorityName, filingSystemLabel`. No wildcard fallback -- a country with no row simply can't have a filing created for it yet, same fail-closed posture as every other lookup in this system.
- **Removed the hardcoded schema defaults**: `CustomsFiling.authority` no longer defaults to `"US Customs (CBP)"`, `entryType` no longer defaults to `"Consumption Entry"`, `filingType` no longer defaults to `"ABI - Automated"`. These were baked into the column definition itself, not just app logic -- the single most direct contradiction of "generic, not country-specific" found in the whole review.
- **`entryNumber` was fabricated CBP-shaped junk with no uniqueness guarantee.** `` `5901-26-${suffix}` `` (a hardcoded filer code + hardcoded year digits) is gone, replaced by a neutral `DFT-{shipmentNumber}-{8hex}` internal reference -- real entry numbers are authority-assigned and arrive later as `authorityReference` on an accepted response, never fabricated by us. Added `@@unique([accountId, entryNumber])` and a create-with-retry loop that only retries on an actual collision (never on an explicit `customEntryNumber` conflict, which is a real error).
- **`POST /api/filing` now fails closed, early, with clear errors** instead of creating an untransmittable Draft: requires `shipment.destinationCountry` set, requires a resolvable `FilingProcedureMapping` for that country + entry type, requires at least one line item. All three used to be discoverable only much later (at Transmit, or never).
- **Entry-type options are now filtered by the shipment's actual destination** (`filing/page.tsx`) instead of unconditionally offering all 18 CBP codes regardless of where the goods are going; a destination with no procedure mapping yet shows a clear message instead of a picker full of meaningless choices.
- **Deleted `FilingService.createFiling()`** -- confirmed zero callers, a second, weaker, disconnected creation path (no duplicate check, no tariff calc) sitting dead next to the one the UI actually uses.
- **Fixed a real bug found along the way**: `filing/page.tsx`'s existing-filing lookup had no status filter, so a shipment with a Cancelled filing could never start a new one -- `findFirst` always found the terminal one and redirected there forever. Now scoped to non-terminal statuses only.

The two US-only simulation paths (`modules/agents/customsFilingAgent.ts`, `modules/demo/customsFilingAgent.ts` -- the pre-existing, `authorized`-gated demo/test-runner flows, confirmed out of scope for the canonical-messaging work back in Phase 1) needed a one-line fix each to keep compiling once the schema defaults were removed; left them as explicit CBP-shaped literals since they're demo paths by construction, not run through `FilingAuthorityConfig`.

Verified end-to-end with disposable fixtures: a shipment with no `destinationCountry` correctly has one; a destination ("DE") with no `FilingProcedureMapping` correctly resolves to zero rows; the real US path resolves procedure + authority config correctly, generates a non-CBP-shaped entry number, and creates cleanly; a deliberate duplicate `(accountId, entryNumber)` insert is correctly rejected by the new DB constraint; and a shipment whose filing was cancelled correctly shows no live filing afterward, confirming the redirect-dead-end bug is fixed.

**Known, still-open gap, unchanged by this pass**: `computeFilingTariff()` (MPF/HMF/general duty rate) runs unconditionally regardless of destination country -- a non-US filing still gets a duty figure that means nothing. Flagged explicitly in code and left for a dedicated country-scoped duty engine, not guessed at here.

---

## 2026-08-12 — Child actions redesigned as a generic, table-driven list (not boolean columns)

The `allowCancel` boolean column added earlier the same day didn't scale: every future child action (Amendment, Invalidate) would need its own column, its own migration, and its own prop threaded through the UI -- the opposite of "works for every country without hardcoding." Replaced it before it accumulated more callers:

- **`FilingChildActionRule`** (new table): `(country, procedureCode, messageName, status, action)` -> a row exists or it doesn't. `resolveChildActions()` (`childActionRules.ts`) returns a **dynamic list** of action codes (today: `["CANCEL"]` for the eligible statuses), resolved most-specific-match-wins *per action* -- one action can come from a country-specific row while another falls back to a wildcard, in the same lookup. `FilingActionRule.allowCancel` was dropped; that table is back to its original single purpose (`allowUpdates`).
- **`FilingDetailClient.tsx`**: the Cancel button is no longer a hardcoded `canCancel &&` block. A small `CHILD_ACTION_REGISTRY` (label, icon, confirm copy, endpoint, response key) is the only place that knows what "CANCEL" *means* in the UI; the render loop, the confirmation modal, and the submit handler are all generic over whatever `childActions` the server resolved. Adding Amendment later is one registry entry plus seed-data rows -- no new prop, no new modal, no new handler.
- **Intermediate status added**: sending a child action is now itself a visible transition, not something that leaves status looking untouched until a response happens to arrive. `filingStateMachine.ts` gained `CancellationRequested` and the `cancel.request` transition (`{Transmitted, Accepted, Rejected, DocumentsRequested, CustomsHold, TransmissionPending} -> CancellationRequested`); `cbp.cancel`'s from-list narrowed to `["CancellationRequested"]` only, since confirmation now always follows a request, never fires directly from a live status. `FilingService.cancelFiling()` applies `cancel.request` and persists the new status immediately after publishing, the same pattern `transmitFiling()` already used for `transmit.send`.

Verified with a disposable fixture end-to-end: `Transmitted` correctly offers `["CANCEL"]`; sending it moves the filing to `CancellationRequested` immediately (confirmed both in `cancelFiling()`'s own return value and by re-reading the row); `CancellationRequested` correctly offers **no** child actions (can't re-cancel a cancellation already in flight); the mock `CANCELLED` response then correctly applies `cbp.cancel` -> `Cancelled`, which also offers no child actions (terminal).

**Still intentionally code, not a table**: `filingStateMachine.ts`'s transition legality itself (which statuses can reach which). That's fixed CBP procedural logic that doesn't vary by country or tenant -- the same reasoning that kept `entryType.ts` as code back in Phase 1. What varies by country/procedure, and therefore belongs in a table, is *which actions are offered when* -- that's what `FilingChildActionRule` now owns.

---

## 2026-08-12 — Closed the "cancel after transmission" gap: `cbp.cancel` transition + mapping row

Flagged as a deliberate boundary in Phase 6 and again in the mock-responder work, but left unmapped both times pending a real answer to "what should filingStatus actually become." Answer: an inbound `CANCELLED` response to an already-transmitted entry unambiguously means the filing is cancelled, so:

- `filingStateMachine.ts`: added `cbp.cancel`, `{ from: ["TransmissionPending", "Transmitted", "Accepted", "Rejected", "DocumentsRequested", "CustomsHold"], to: "Cancelled" }` — purely additive, distinct from the pre-existing `cancel` transition (which withdraws a filing *before* CBP ever saw it).
- `scripts/seed-canonical-messaging.ts`: added the `CANCELLED -> cbp.cancel` row to `CanonicalResponseStatusMapping`. `ERROR` is still deliberately unmapped -- an error responding to a SUBMIT and an error responding to a CANCELLATION don't mean the same thing for `filingStatus`, unlike `CANCELLED`.

No changes needed anywhere else: `inboundConsumer.ts` already looked up this table and called `applyTransition()` generically; the Cancel button's visibility already derived from `hasOutboundMessage && !isTerminal(filingStatus)`; `Cancelled` was already in `TERMINAL_STATUSES`. Adding the one missing row and the one missing transition was the entire fix — exactly the point of routing status changes through this table instead of hardcoding them per action.

Verified with a disposable fixture: transmit -> cancel -> mock `CANCELLED` response -> `filingStatus` correctly became `Cancelled`, the Cancel button's own visibility condition evaluated to `false` afterward, and `transmit.send` correctly became illegal (now terminal).

---

## 2026-08-12 — Post-Phase-7 walkthrough fixes: create-filing flow, broker approval, inline mock responder

Found and closed while walking a real user through the app end-to-end (not part of the original 7 phases, but directly blocking them):

- **`POST /api/filing` had no caller anywhere in the UI.** "Send to Customs Filing" on the shipment page linked to `/app/filing?shipmentId=...`, which the dashboard silently ignored. Added: `src/app/app/filing/page.tsx` now redirects to an existing filing for that shipment, or renders a new `CreateFilingPrompt.tsx` (entry-type confirmation) that actually calls `POST /api/filing`.
- **`broker.approve` (`ReadyForBrokerReview` -> `BrokerApproved`) had no route or UI anywhere**, meaning `BrokerApproved` -- and therefore `transmit.send` -- was unreachable through the app regardless of how ready a filing was. Added `POST /api/filing/[id]/approve` and wired **Run Pre-Filing Validation** / **Approve for Transmission** buttons into `FilingDetailClient.tsx`, gated by `canTransition()` exactly like the existing Transmit/Resubmit/Cancel buttons.
- **Seeded the missing Acme Corporation ENTERPRISE account.** `README.md` documents seeded accounts for `*.acme@qubere.ai`/`*.global@qubere.ai`, but no script in the repo ever created them (only Target.com's users are actually seeded, in `scripts/seed-target-users.ts`). `scripts/seed-acme-owner-membership.ts` creates the account + grants OWNER to `owner.acme@qubere.ai` against an already-existing Clerk identity, without touching Clerk.
- **`src/lib/canonicalMessaging/devStub.ts`**: since no real third party is wired up, an outbound message published today would sit `PENDING` forever unless `scripts/dev-stub-third-party.ts` and `scripts/customs-filing-inbound-worker.ts` are both run by hand. `simulateAndApplyResponse()` inlines that same round trip (answer the one just-published message, then drain the inbound queue) directly into the transmit/resubmit/cancel routes, so the Response tab populates immediately without manual scripts. A `CANCELLATION` message is answered `CANCELLED` rather than `ACCEPTED` -- correctly recorded without moving `filingStatus`, since no `CanonicalResponseStatusMapping` row exists for `CANCELLED` (deliberate, see Phase 2's entry). Toggle off via `CUSTOMS_FILING_MOCK_RESPONSES=false` once a real integration exists; a simulation failure is caught and logged, never allowed to fail the real transmit/resubmit/cancel it's riding along with.

Verified live: a real user walked shipment creation -> client assignment -> document upload -> resolving a real HIGH-severity compliance blocker (line-level HTS + sanctioned-country-of-origin data) -> filing creation -> validate -> approve -> transmit, and the mock responder correctly moved a transmitted filing to `Accepted` inline. Separately verified via a disposable fixture that a mock `CANCELLED` response is recorded without illegally changing status.

**Known gap surfaced, not yet built**: `AMENDMENT` is a defined `FilingMessageAction` with no `FilingService` method, no route, and no UI -- unlike `RESUBMIT`/`CANCELLATION`, which are fully implemented. Left for a follow-up; see conversation for the proposed design (mirrors `cancelFiling()`'s "reference the last outbound message, don't touch `filingStatus`" shape, since CBP entry amendments/PSCs don't invalidate the underlying entry the way a rejection does).

---

## 2026-08-11 — Repository assessment: design doc reconciled against current code

Before writing any migration, re-read the actual current state of the filing subsystem (it had moved on considerably since the design doc was written). Several things the design doc assumed needed to be built already exist, well-engineered, and should be **reused, not duplicated**:

| Design doc assumed | Actually already exists | Decision |
|---|---|---|
| `CustomsFiling.canonicalSnapshot: Json` (new field) | `FilingSnapshot` model (1:1 with `CustomsFiling`, `snapshotData: Json`), already populated by `FilingService.transmitFiling()` per a typed `FilingSnapshotData` shape | **Reuse.** Extend `FilingSnapshotData` with the multi-country fields (HS6/national-suffix split, parties, GRI rationale, compliance flags) instead of adding a parallel field. |
| Hardcoded `country`/`procedure` derivation would need building from scratch | `src/modules/filing/entryType.ts` already canonicalizes CBP entry-type codes (typed const array + alias normalization, `requireEntryTypeCode()`, no silent defaulting) | **Reuse as the internal entry-type source of truth.** This is a *stable, legally-fixed* CBP vocabulary — keeping it as tested TypeScript is the right call, the same reasoning the design doc already applied to JSON Schema files. The **new** `(entryType, country) -> third-party procedure code` table is still needed and still belongs in the database, since *that* mapping genuinely varies as countries are onboarded — it wraps `entryType.ts`, it doesn't replace it. |
| `CanonicalStatusValue` reference table redefining valid statuses | `src/modules/filings/filingStateMachine.ts` already defines `FILING_STATUSES`, a full transition graph (`applyTransition`, `FilingTransitionError`), terminal/CBP-controlled status sets, and derived UI stage helpers | **Reuse the state machine; do not bypass it.** Repurposed the new reference table: instead of redefining statuses, it now maps *incoming canonical response status -> which `FilingTransition` to apply* (`cbp.accept` / `cbp.reject` / `cbp.requestDocuments` / `cbp.hold` / `cbp.release`). The inbound response consumer must call `applyTransition()`, never write `filingStatus` directly — this is the one behavior correction from the original design. |
| `FilingActionRule` gating Save/Resubmit only | — | **Kept as designed**, but scoped narrower now: it governs *declaration edit access in the UI*, a distinct concern from filing-status legality, which `filingStateMachine.ts` already owns. |
| A synchronous, in-process `CustomsTransmissionProvider.submitEntry()` call in `filing.service.ts` (via `MockCustomsTransmissionProvider`) | Confirmed still the current, live integration point | **This is the real target for the async swap** — not the pipeline's `CustomsFilingAgent` (that path is gated behind an explicit `authorized` flag and is simulation-only; it doesn't call `FilingService` at all today, a pre-existing inconsistency out of scope for this work unless it starts blocking us). |
| A new outbound/inbound queue table | `PgQueue`/`PipelineJob` exists but is shaped specifically around agent-pipeline steps, not generic messages | **No new queue table.** `CustomsFilingMessage` itself doubles as the queue: add a `queueStatus` column and reuse the exact `FOR UPDATE SKIP LOCKED` claiming pattern already proven in `pgQueue.ts`, rather than a redundant parallel table. |
| `Shipment.destinationCountry` | Confirmed genuinely absent | **New field, as designed.** |

**Net effect**: less net-new schema than the original doc implied, and — more importantly — this implementation now plugs into the filing subsystem's existing state machine and snapshot mechanism instead of running an inconsistent parallel one next to it.

---

## 2026-08-11 — Phase 1 complete: schema migration

Added, purely additive (one nullable column, six new tables, no changes to existing columns/data):

- `Shipment.destinationCountry` (nullable) — the genuinely-missing field identified above.
- `CustomsFilingMessage` — doubles as both the audit log and the outbound/inbound queue (`queueStatus`/`lockedAt`/`attempts`, same `FOR UPDATE SKIP LOCKED` claiming pattern as `PipelineJob`), avoiding a redundant separate queue table.
- `CanonicalSchemaVersion` — versioned JSON Schema documents, mirroring `HtsRelease`'s `publicationStatus` promotion pattern.
- `CanonicalResponseStatusMapping` — replaces the originally-designed `CanonicalStatusValue`; maps an inbound response's canonical status to which `FilingTransition` to apply, rather than redefining `filingStateMachine.ts`'s existing status vocabulary.
- `CanonicalMessageAction`, `FilingProcedureMapping`, `FilingMessageCatalog`, `FilingActionRule` — as originally designed.

Applied as migration `20260811020000_customs_filing_canonical_messaging`. One unrelated pre-existing migration (`20260810180000_document_processing_runs`) was found pending and applied first — not part of this work, just discovered along the way. `prisma migrate dev`'s shadow-database replay fails on an older, unrelated migration (`20260810140000_declare_out_of_band_schema`) that doesn't fully replay from empty by its own design; used `migrate diff` against the live database + manual migration folder + `migrate deploy` instead, same workaround pattern as the earlier session's baselining fix. Did not attempt to fix that pre-existing shadow-db issue — out of scope here.

Verified: `prisma validate` clean, `prisma generate` succeeded, `tsc --noEmit` shows only the pre-existing unrelated Playwright errors.

---

## 2026-08-11 — Phase 2 complete: resolveMessageContext + seed data

- `src/lib/canonicalMessaging/resolveMessageContext.ts` — derives `{entryTypeCode, country, procedure, messageName, queueName}` from `Shipment`/`entryType.ts` plus the reference tables, most-specific-match-wins (`wildcardLookup.ts`), fails closed with a descriptive error on any unmapped combination.
- `schemas/customs-filing/{envelope-header,filing-request-declaration,filing-response-data}/1.0.0.json` — the three JSON Schema documents authored as version-controlled files, per the design doc's schema-authoring rule.
- `scripts/seed-canonical-messaging.ts` — loads the schema files into `CanonicalSchemaVersion` (status `ACTIVE`), and seeds `CanonicalMessageAction`, `FilingProcedureMapping` (one row per `ENTRY_TYPE_CODES` entry, country `US`), `FilingMessageCatalog` (5 actions × US × wildcard procedure), `CanonicalResponseStatusMapping`, and `FilingActionRule`. Every write is an upsert, safe to re-run.
- **Known limitation, deliberate**: no `CanonicalResponseStatusMapping` row for `CANCELLED` or `ERROR`. Neither has a legal `FilingTransition` from `Transmitted` in `filingStateMachine.ts` today (`cancel` only applies pre-transmission) — seeding one would force an incorrect transition. The inbound consumer (Phase 5) records the response and leaves status unchanged when no mapping matches, rather than guessing.

Verified: `npx tsx scripts/seed-canonical-messaging.ts` runs clean; a throwaway script confirmed `resolveMessageContext` resolves `SUBMIT`/`US`/`01` correctly, normalizes a free-text entry type ("Consumption Entry") the same way, and fails closed with a clear message for an unmapped country.

---

## 2026-08-11 — Phase 3 complete: publisher/consumer

- `src/lib/canonicalMessaging/publisher.ts` — `CanonicalMessagePublisher` interface + `PgCanonicalMessagePublisher`. Validates header + declaration against the active schemas before writing an `OUTBOUND` `CustomsFilingMessage` row (`queueStatus: PENDING`).
- `src/lib/canonicalMessaging/consumer.ts` — `CanonicalMessageConsumer` interface + `PgCanonicalMessageConsumer`. Claims one `INBOUND` `PENDING` row at a time via `FOR UPDATE SKIP LOCKED` (same stale-claim window as `PgQueue`), validates, and marks `PROCESSED`/`FAILED`.
- `src/lib/canonicalMessaging/schemaValidator.ts` — loads the `ACTIVE` `CanonicalSchemaVersion` row per `schemaType`, compiles with Ajv, caches the compiled validator in memory keyed by `schemaType@version`. **Correction made during implementation**: had to switch from Ajv's default export to `ajv/dist/2020` (`Ajv2020`) — the plain `Ajv` class only fully supports draft-07 meta-schemas, and these schema files declare draft 2020-12 with `$defs`/`$ref`.
- `scripts/dev-stub-third-party.ts` — dev-only stand-in for the real third-party service; drains `OUTBOUND` `PENDING` rows and always answers `ACCEPTED`, so the full loop is exercisable locally with no real integration. Per the design doc's own "Required final response" item 5.
- Added `ajv` and `ajv-formats` as direct dependencies (only present transitively before).

---

## 2026-08-11 — Phase 4 complete: FilingService wired to publish async

- `src/lib/canonicalMessaging/declarationBuilder.ts` — builds `CanonicalCustomsDeclaration` from the same `FilingSnapshotData`/tariff result `transmitFiling()` already computes (not a re-fetch). Splits each line's HTS code into universal `hsCode6` + `nationalTariffSuffix`. Enriches importer/exporter from `ShipmentParty`/`LegalEntity` (roles `IMPORTER_OF_RECORD`/`EXPORTER`) when present, degrades gracefully when absent.
- `filing.service.ts#transmitFiling()` — removed the synchronous `MockCustomsTransmissionProvider.submitEntry()` call and the synchronous `CustomsResponse` creation. Now: builds the declaration, resolves the message context, publishes via `PgCanonicalMessagePublisher`, applies `transmit.send` to `Transmitted`, and returns `{ filing, messageId }` — no response, because none exists yet.
- `src/app/api/filing/[id]/transmit/route.ts` — updated to the new return shape; documents in-line that the client should poll `GET /api/filing/[id]` for status rather than expect a response synchronously.

Verified with a disposable fixture (real account, real shipment against the seeded HTS chapter-84 valve code so duty rates resolve): filing moved `Draft` → (test-only manual `BrokerApproved`) → `Transmitted`, a valid `CustomsFilingMessage` `OUTBOUND` row was created with the correctly-split HS6/suffix line items, and `tsc --noEmit` stayed clean.

---

## 2026-08-11 — Phase 5 complete: inbound response consumer

- `src/lib/canonicalMessaging/inboundConsumer.ts` — `processInboundMessage()` looks up `CanonicalResponseStatusMapping` (most-specific match), applies the resulting `FilingTransition` via `applyTransition()` (never writes `filingStatus` directly), and writes a `CustomsResponse` row either way — preserving the existing Response-tab data source, just populated asynchronously now instead of synchronously inside `transmitFiling()`.
- Hardened against bad config data: both an illegal transition (`FilingTransitionError`) and a `filingTransition` string naming no known transition at all are caught and logged as warnings, never thrown — a typo in a reference-table row must degrade to "record the response, don't change status," not crash message processing.
- `scripts/customs-filing-inbound-worker.ts` — long-running poll loop, same shape as `src/worker/pipelineWorker.ts`.

**Full loop verified live**: transmitted a real filing, ran `dev-stub-third-party.ts`, drained the inbound queue — filing correctly progressed `Transmitted -> Accepted` (exactly matching `filingStateMachine.ts`'s legal `cbp.accept` transition), and a `CustomsResponse` row appeared with the stub's message. This is the first point where the entire canonical-messaging loop has actually run end-to-end, not just been designed.

---

## 2026-08-11 — Phase 6 complete: FilingActionRule + resubmit/cancel

- `src/lib/canonicalMessaging/filingActionRules.ts` — `resolveAllowUpdates()`, most-specific-match against `FilingActionRule`, fails closed.
- **Genuine state-machine extension, made deliberately**: `filingStateMachine.ts` had no path back from `Rejected`/`ValidationFailed`/`DocumentsRequested` to a transmitted state — resubmit fundamentally needs one. Added a new `resubmit` transition (`from: ["ValidationFailed", "Rejected", "DocumentsRequested"]`, `to: "Transmitted"`). Purely additive — no existing transition's `from`/`to` list was touched.
- `FilingService.transmitFiling()` refactored to share a private `buildSnapshotAndPublish()` helper with the new `resubmitFiling()` (rebuilds the declaration from the shipment's *current*, post-edit data; requires the `resubmit` transition to be legal). `cancelFiling()` is separate: reuses the *last transmitted* declaration verbatim rather than rebuilding one — a cancellation declares "cancel that specific declaration," not a fresh snapshot of possibly-since-changed data.
- **Bug caught by the smoke test, fixed**: `FilingSnapshot.filingId` is `@unique` (one snapshot per filing) — the original `create()` call worked for a first transmit but collided on resubmit. Changed to `upsert()`. The full historical record of what was actually sent at each point in time is unaffected — it lives in each `CustomsFilingMessage.envelope`, one immutable row per message; `FilingSnapshot` was always "latest effective state," not an archive.
- **Deliberately left as a known boundary, not fixed**: `cancelFiling()` never changes `CustomsFiling.filingStatus`. `filingStateMachine.ts`'s `cancel` transition only applies pre-transmission; widening it to cover an already-transmitted entry is a real CBP workflow (and a real product decision about what "cancelled after transmission" even means) that wasn't guessed at here. Status will change once a follow-up adds the legal transition and a response mapping for it.
- New routes: `POST /api/filing/[id]/resubmit`, `POST /api/filing/[id]/cancel`, matching the existing `transmit` route's idempotency/audit-log conventions.

Verified live: `BrokerApproved` correctly resolves `allowUpdates: false`; simulated a CBP rejection, confirmed `Rejected` resolves `allowUpdates: true`; resubmitted successfully back to `Transmitted`; the message chain correctly threads `priorMessageId` (`SUBMIT` -> `RESUBMIT` -> `CANCELLATION`, each referencing the one before); cancellation left `filingStatus` at `Transmitted` exactly as documented.

---

## 2026-08-12 — Phase 7 complete: Customs Filing module dashboard + detail view

- `src/app/app/filing/page.tsx` + `FilingDashboardClient.tsx` — replaced the old single-filing preview with a searchable dashboard: entry number/importer/country/filing-type search, a status filter (backed by `FILING_STATUSES`, not a hardcoded list), and a table (Entry Number, Importer, Country, Filing Type, Status as `Badge`, Total Value, Filed Date, Last Updated) with client-side pagination via the existing `modules/tables/tableQuery.ts` helpers (same pattern as `ShipmentsWorkbenchClient`). Rows open the detail route on double-click and via a visible "View" button.
- `src/app/app/filing/[id]/page.tsx` + `FilingDetailClient.tsx` — new detail route (not a modal), three tabs:
  - **Overview** — the existing 4-step timeline (`filingStages()`), entry summary, and duty/tax breakdown, carried over from the old single-page view.
  - **Declaration** — parties/transport from the shipment, an editable line-items table (HTS code, country of origin) gated by `resolveAllowUpdates()`, and a compliance/evidence panel read from the *last transmitted* declaration's `CustomsFilingMessage.envelope` (there is no separate "declaration draft" storage — editing means editing the underlying `Shipment`/`ShipmentLineItem` rows, and resubmission already rebuilds the declaration from their current state).
  - **Response** — latest `CustomsResponse`, full response history when more than one exists, and a collapsed raw-envelope viewer over every `CustomsFilingMessage` for the filing.
- Action buttons are gated by real backend rules, not by UI-side guesses:
  - **Transmit to CBP** — shown iff `canTransition(filingStatus, "transmit.send")`.
  - **Save** — shown iff `resolveAllowUpdates()` is true; persists only the changed line items via the existing `PATCH /api/shipments/[id]` (reused as-is — it already writes `FactAuditService`/`FactService` audit trail entries and triggers selective agent re-execution for HTS/CoO edits, so no new persistence path was built).
  - **Save & Resubmit** — shown iff `allowUpdates` and `canTransition(filingStatus, "resubmit")`; saves the same edits, then calls the existing resubmit route.
  - **Cancel Filing** — shown iff the filing has at least one outbound `CustomsFilingMessage` and its status is not terminal (mirrors `FilingService.cancelFiling()`'s actual preconditions, since that function does not check `filingStatus` at all); confirmed via a `Modal`/`ModalHeader`/`ModalBody`/`ModalFooter` dialog before sending.
  - No new UI concept was invented for "edit access" vs. "transition legality" — the two existing, independent rule sources (`FilingActionRule` and `filingStateMachine.ts`) are read directly and combined only in the gating booleans passed down from the server component.
- Reused the existing `Badge`/`Button`/`Card`/`Modal`/`Input` component library throughout; no new UI primitives were added.

**Verified live in the browser** (signed in as `owner.acme@qubere.ai`, real Supabase-backed dev server, not a mock): found a leftover, not-yet-cleaned-up `Rejected` test fixture from the Phase 6 smoke test and used it end-to-end —
1. Dashboard rendered it correctly (search, status filter, badge, pagination) and the empty state rendered correctly once the fixture was later removed.
2. Detail page on a `Rejected` filing showed exactly `Save` / `Save & Resubmit` / `Cancel Filing` (no `Transmit`) — matching `allowUpdates=true`, `canResubmit=true`, `canTransmit=false`.
3. Edited a line item's country of origin (DE → CN) via **Save**: `PATCH /api/shipments/[id]` returned 200 with the corrected value persisted and a `ShipmentChangeEvent` audit row created — confirmed by reading the raw response body, not just trusting a 200 status.
4. **Save & Resubmit** moved the filing `Rejected → Transmitted`; the timeline, badge, and action buttons all updated correctly (`Transmit`/`Save`/`Resubmit` disappeared, only `Cancel Filing` remained) after a full reload; the Response tab's raw payload viewer showed the new `CUSTOMS_DECLARATION_RESUBMIT` message correctly carrying the corrected `originCountry: "CN"` and correctly chained via `priorMessageId` to the original `SUBMIT` message.
5. **Cancel Filing** opened the confirmation modal, sent the cancellation on confirm, and left `filingStatus` at `Transmitted` exactly as documented in `FilingService.cancelFiling()`.
6. Cleaned up the (pre-existing, not created by this phase) leftover test fixture afterward via a disposable script, same discipline as every prior phase.

**Known, deliberate scope boundary carried over from Phase 6**: the Declaration tab's edit surface is limited to HTS code and country of origin — the two fields `PATCH /api/shipments/[id]` already supports editing with a real audit trail. Broader declaration editing (transport, valuation, parties) was not added a new persistence path for, since none of those fields have an existing, audited write path outside the normal shipment-editing UI, and inventing one was out of scope for wiring up the canonical-messaging flow.

---

### Final Summary — all 7 phases complete

What shipped, end to end: a shipment's filing data is converted into a versioned, schema-validated JSON canonical declaration (`resolveMessageContext()` derives `country`/`procedure`/`messageName` from the shipment and reference tables — nothing hardcoded); published to an outbound queue (`CustomsFilingMessage`, doubling as queue and durable audit log via `FOR UPDATE SKIP LOCKED`); picked up, "filed," and answered by a third-party stand-in (`dev-stub-third-party.ts`); the response is correlated back by `messageId`/`correlationId`, mapped through `CanonicalResponseStatusMapping` to a `filingStateMachine.ts` transition (never a direct status write), and applied; and the whole lifecycle — including edit/resubmit-on-rejection and cancellation — is now visible and actionable from a real UI instead of only from disposable test scripts.

What changed from the original design doc along the way, and why, is captured in full in the repository-assessment entry at the top of this file and in each phase's own entry — the net effect was consistently *less* new schema than first proposed, because the filing subsystem already had a state machine, a snapshot mechanism, and an entry-type vocabulary worth reusing rather than duplicating.

What's deliberately left as a boundary rather than guessed at: `CustomsFiling.filingStatus` has no transition for "cancelled after transmission" (CBP's real-world handling of that case was never specified, so none was invented); `CanonicalResponseStatusMapping` has no row for `CANCELLED`/`ERROR` responses for the same reason; and the Declaration tab's live edit surface covers HTS code and country of origin only, matching the one persistence path that already carries a real audit trail. Each is called out at the point it was decided, not discovered late.

### Status
- [x] Repository assessment
- [x] Phase 1 — schema migration
- [x] Phase 2 — `resolveMessageContext()` + procedure/message-catalog tables
- [x] Phase 3 — `CanonicalMessagePublisher`/`Consumer` (Postgres-backed, reusing `CustomsFilingMessage` as the queue)
- [x] Phase 4 — wire `FilingService.transmitFiling()` to publish instead of calling the mock provider synchronously
- [x] Phase 5 — inbound consumer: correlate, validate, call `applyTransition()`
- [x] Phase 6 — `FilingActionRule` + UI edit/resubmit/cancel actions
- [x] Phase 7 — Customs Filing module dashboard + detail view
