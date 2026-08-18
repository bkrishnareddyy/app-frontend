# Customs Filing — Functional Overview

This document describes what the customs-filing module actually does today, grounded in the real
source. It builds on, and does not duplicate, `docs/shipment-filing-workflow-analysis.md` (broad
architecture: multi-tenancy, event sourcing, config tables) and
`docs/customs-filing-canonical-messaging-changelog.md` (the phase-by-phase implementation history
of the canonical-messaging layer). Where those documents describe intent, this one describes
current behavior, and calls out the couple of places they've drifted from the code.

## 1. Purpose & scope

The module takes a shipment's line items, parties, and documents and turns them into a filed US
CBP entry: it validates the data against a Form 7501 checklist, calculates duty/MPF via a real HTS
tariff engine, builds a versioned "canonical" declaration, and moves it through broker review,
transmission, and a CBP response lifecycle to release and closure — with resubmission-on-rejection
and pre/post-transmission cancellation paths. Everything downstream of "does the entry type resolve
to a real CBP procedure" is deliberately architected to be country-agnostic: entry type,
authority, message routing, response-status mapping, allowed post-submission edits, and offered
child actions are all resolved through database tables
(`FilingProcedureMapping`, `FilingAuthorityConfig`, `FilingMessageCatalog`,
`FilingResponseStatusMapping`, `FilingActionRule`, `FilingChildActionRule`,
`FilingActionDataRequirement`) keyed by `(country, procedure, ...)`, most-specific-match-wins
(`src/lib/canonicalMessaging/wildcardLookup.ts`). Germany was onboarded through these tables with
no application-code changes, proving the design
(`docs/customs-filing-canonical-messaging-changelog.md:25-35`). What is **not** yet
country-agnostic: duty/MPF calculation runs unconditionally as a US CBP calculation regardless of
destination (flagged explicitly in `src/app/api/filing/route.ts:395-400`), and the entry-type
vocabulary itself (`src/modules/filing/entryType.ts`) is CBP's 18 codes, kept as code rather than
config because it's a stable, legally-fixed standard, not a tenant preference.

## 2. Functional inventory

| Capability | Responsible function / route / component |
|---|---|
| Create draft filing from a shipment | `POST /api/filing` (`src/app/api/filing/route.ts:305-478`) — fails closed if `destinationCountry`, a `FilingProcedureMapping`, a `FilingAuthorityConfig`, or line items are missing |
| Search/list filings, aggregate metrics | `GET /api/filing` (`src/app/api/filing/route.ts:11-294`) |
| Filing detail (snapshot-aware) | `GET /api/filing/[id]` (`src/app/api/filing/[id]/route.ts:12-219`) — prefers the frozen `FilingSnapshot` over live shipment data once one exists |
| Pre-filing/pre-transmission validation | `runFilingValidation()` (`src/lib/filing/filingValidator.ts:327-344`), invoked by `POST /api/filing/[id]/validate` (`src/app/api/filing/[id]/validate/route.ts`) and again, unconditionally, inside the transmit route |
| Broker approval | `POST /api/filing/[id]/approve` (`src/app/api/filing/[id]/approve/route.ts`) — applies `broker.approve` |
| Transmit / submit to customs | `FilingService.transmitFiling()` → `buildSnapshotAndPublish()` (`src/modules/filings/filing.service.ts:54-56, 195-333`), called from `POST /api/filing/[id]/transmit` (`src/app/api/filing/[id]/transmit/route.ts`) |
| Resubmit after rejection (with line-item correction) | `FilingService.resubmitFiling()` (`src/modules/filings/filing.service.ts:64-73`), via `POST /api/filing/[id]/resubmit`; line items are edited first through the existing `PATCH /api/shipments/[id]` (reused, not a new persistence path — changelog, Phase 7) |
| Cancel filing (with action-data-requirement prompts) | `FilingService.cancelFiling()` (`src/modules/filings/filing.service.ts:90-156`), via `POST /api/filing/[id]/cancel`; prompted extra fields resolved via `GET /api/filing/[id]/action-fields` (`src/app/api/filing/[id]/action-fields/route.ts`) and `buildActionExtensions()` (`src/lib/canonicalMessaging/actionDataRequirements.ts:126-141`) |
| Status inquiry | Defined as a `FilingMessageAction` (`STATUS_INQUIRY`, recognized by `action-fields/route.ts:11`) but has **no `FilingService` method and no UI trigger** — cataloged, not implemented |
| Inbound CBP response processing | `processInboundMessage()` (`src/lib/canonicalMessaging/inboundConsumer.ts`), maps response → `FilingTransition` via `FilingResponseStatusMapping`, applies via `applyTransition()` — never writes `filingStatus` directly |
| Entry Summary / 7501 preview | `GET /api/filing/[id]/entry-summary` (`src/app/api/filing/[id]/entry-summary/route.ts`) building `buildForm7501()`, rendered by the **7501 Preview** tab in `FilingDetailClient.tsx:1346-1501` |
| Post-Summary Correction | Its own module under `src/app/app/post-entry/psc/` (`PscListClient.tsx`, `PscNewClient.tsx`, `PscDetailClient.tsx`, `src/lib/refunds/pscEligibility.ts`, `src/app/api/refunds/psc/*`); the filing detail page only surfaces a read-only **Post-Summary Correction** tab (`FilingDetailClient.tsx:1502-1527`) showing PSC eligibility and the 300-day/19 CFR 174 window — it does not itself file a PSC |
| Audit room / compliance package export | "Generate Audit Package" button (`FilingDetailClient.tsx:666-680`) calling `GET /api/audit/room/[filingId]` (`src/app/api/audit/room/[filingId]/route.ts`), which assembles a Reasonable Care package (`assembleReasonableCarePackage()`) and a Focused Assessment file (`assembleFocusedAssessmentFile()`) for a ±7-day window around the filing |
| Duty/tariff calculation | `computeFilingTariff()` (`src/lib/tariff/dutyEngine.ts:425`), driven off `loadHtsCodesMap()`; called at filing creation (`route.ts:401`), at transmit/resubmit (`filing.service.ts:231`), and at entry-summary/7501 build time |
| Child-action gating (e.g. Cancel) | `resolveChildActions()` (`src/lib/canonicalMessaging/childActionRules.ts:14-43`), rendered generically via `CHILD_ACTION_REGISTRY` (`FilingDetailClient.tsx:160-174`) |

## 3. Supported procedures/entry types today

`ENTRY_TYPES` (`src/modules/filing/entryType.ts:20-39`) defines the full internal vocabulary — all
18 CBP Block-2 entry-type codes:

| Code | Label |
|---|---|
| 01 | Consumption |
| 02 | Consumption — Quota/Visa |
| 03 | Consumption — Antidumping/Countervailing Duty |
| 06 | Consumption — Foreign Trade Zone |
| 07 | Consumption — Quota/Visa and Antidumping/Countervailing Duty |
| 11 | Informal |
| 12 | Informal — Quota/Visa |
| 21 | Warehouse |
| 22 | Re-Warehouse |
| 23 | Temporary Importation under Bond |
| 31 | Warehouse Withdrawal — Consumption |
| 32 | Warehouse Withdrawal — Quota |
| 34 | Warehouse Withdrawal — Antidumping/Countervailing Duty |
| 51 | Defense Contract Administration Service Region |
| 52 | Government — Dutiable |
| 61 | Immediate Transportation |
| 62 | Transportation and Exportation |
| 63 | Immediate Exportation |

**This is the code's entry-type vocabulary, not its process coverage.** Codes 21/22/31/32/34
(warehouse) and 61/62/63 (transit) exist as selectable/normalizable labels, but the entire
downstream action catalog — validation (`filingValidator.ts`), the canonical declaration builder
(`declarationBuilder.ts`), the state machine, and the 7501 preview — implements one generic
consumption-style entry workflow. There is no warehouse-specific bonded-storage tracking, no
transit/in-bond movement tracking, and no excise-specific handling anywhere in the action catalog.
`FilingProcedureMapping` for Germany, for example, was deliberately seeded for only a 3-code subset
(01/21/23) that has a clean Customs Procedure Code analogue
(`docs/customs-filing-canonical-messaging-changelog.md:28`) — proof that the mapping table can
express other regimes, but no such regime-specific behavior exists in the application code today.

## 4. End-to-end lifecycle walkthrough

All status names below are exactly as declared in `FILING_STATUSES`
(`src/modules/filings/filingStateMachine.ts:6-23`). Note: the `docs/shipment-filing-workflow-analysis.md`
document lists a `PartiallyReleased` status and a five-phase happy path — neither exists in the
current code; the real status list and transition graph are below.

1. **Draft.** `POST /api/filing` (`src/app/api/filing/route.ts:305`) creates the `CustomsFiling`
   row directly in `Draft`, after checking `destinationCountry`, a resolvable
   `FilingProcedureMapping`, a `FilingAuthorityConfig`, and at least one shipment line item exist.
   Duty/MPF is computed via `computeFilingTariff()` and persisted (`totalValue`, `totalDuties`,
   `totalAmount`); if any line is unrated, the duty fields stay `null` rather than understating.

2. **Preparing / ValidationFailed / ReadyForBrokerReview.** `POST /api/filing/[id]/validate`
   (`validate/route.ts`) runs `runFilingValidation()` against the entry's real data and applies
   `validate.pass` (→ `ReadyForBrokerReview`) or `validate.fail` (→ `ValidationFailed`) via
   `canTransition`/`applyTransition` (`filingStateMachine.ts:69-70`). `Preparing` itself
   (reached via `prepare`, from `Draft`/`ValidationFailed`) has no dedicated route in this codebase
   pass — it exists in the transition table but is not driven by any caller found here; the live
   validate flow moves straight `Draft → ReadyForBrokerReview` (or `→ ValidationFailed`) when legal.

3. **BrokerApproved.** `POST /api/filing/[id]/approve` (`approve/route.ts:19-67`) applies
   `broker.approve` (`ReadyForBrokerReview → BrokerApproved`). Without this route the filing can
   never legally reach a status from which `transmit.send` is allowed (per the route's own
   comment, `approve/route.ts:13-18`).

4. **Transmitted.** `POST /api/filing/[id]/transmit` (`transmit/route.ts`) first re-runs
   `runFilingValidation()` server-side unconditionally (422 on any blocker, regardless of what the
   client believes), then calls `FilingService.transmitFiling()` →
   `buildSnapshotAndPublish(accountId, filingId, "SUBMIT", "transmit.send")`
   (`filing.service.ts:54-56`). This method: re-checks the transition is legal
   (`applyTransition(filing.filingStatus, "transmit.send")`, legal from `BrokerApproved` or
   `TransmissionPending`), re-verifies line items exist and are rated, upserts a `FilingSnapshot`
   (frozen shipment/line-item/document/header data), builds a `CanonicalCustomsDeclaration`
   (`buildCanonicalDeclaration()`), resolves `{country, procedure, messageName, queueName}` via
   `resolveMessageContext()`, and publishes the outbound message. It then persists
   `filingStatus: "Transmitted"`, `submittedAt`, and increments `version`
   (`filing.service.ts:322-330`). No CBP response exists synchronously at this point; in dev, the
   transmit route optionally calls `simulateAndApplyResponse()` (`devStub.ts`) to fabricate one
   immediately so the Response tab isn't empty (`transmit/route.ts:127-142`).

5. **CBP response, accept path.** The inbound consumer looks up `FilingResponseStatusMapping` for
   the response's canonical status and applies the mapped `FilingTransition` — e.g. `cbp.accept`
   (`Transmitted → Accepted`, `filingStateMachine.ts:75`), later `cbp.release`
   (`Accepted`/`CustomsHold`/`DocumentsRequested` → `Released`, `filingStateMachine.ts:79`), and
   finally `close` (`Released`/`Rejected → Closed`, `filingStateMachine.ts:109`) — reaching one of
   the module's terminal states, `Closed` (`TERMINAL_STATUSES`, `filingStateMachine.ts:32`).

6. **CBP response, reject-and-resubmit path.** A `cbp.reject` response moves the filing
   `Transmitted → Rejected` (`filingStateMachine.ts:76`). The filer corrects the underlying
   shipment/line-item data (HTS code, country of origin — the only two fields the Declaration
   tab's editor allows, gated by `resolveAllowUpdates()`) via the existing, audited
   `PATCH /api/shipments/[id]`, then calls **Save & Resubmit**
   (`FilingDetailClient.tsx:682-702`) → `POST /api/filing/[id]/resubmit` →
   `FilingService.resubmitFiling()` (`filing.service.ts:64-73`), which finds the last outbound
   `FilingMessage`, then calls the same shared `buildSnapshotAndPublish(..., "RESUBMIT",
   "resubmit", priorMessage.messageId)` helper transmit uses — rebuilding the declaration from the
   shipment's *current* (corrected) data and re-applying the `resubmit` transition
   (`ValidationFailed`/`Rejected`/`DocumentsRequested → Transmitted`,
   `filingStateMachine.ts:113`). The new message threads `priorMessageId` back to the original.

7. **Cancellation, request-then-confirm path.** From any of `TransmissionPending`, `Transmitted`,
   `Accepted`, `Rejected`, `DocumentsRequested`, or `CustomsHold`
   (`filingStateMachine.ts:96-99`), the operator can send **Cancel Filing**. `FilingService.cancelFiling()`
   (`filing.service.ts:90-156`) finds the last outbound message, reuses its *already-transmitted*
   declaration verbatim (not a fresh snapshot — a cancellation withdraws a specific declaration),
   resolves any extra required fields via `buildActionExtensions()` against
   `FilingActionDataRequirement` (e.g., a German guarantee reference), publishes a `CANCELLATION`
   message, and immediately applies `cancel.request` (→ `CancellationRequested`) — visible before
   any response arrives. Once CBP's `CANCELLED` response is later processed, the inbound consumer
   applies `cbp.cancel` (`CancellationRequested → Cancelled`, `filingStateMachine.ts:105-108`),
   reaching the other terminal status. (Separately, `cancel` — with no `.request` suffix — lets a
   filing be withdrawn pre-transmission, straight to `Cancelled`, from `Draft` through
   `TransmissionPending`, `filingStateMachine.ts:80-90`.)

Throughout, `Simulation` is excluded from every transition check
(`canTransition()`, `filingStateMachine.ts:127-129`) so practice-mode filings can never reach a
real CBP status.

## 5. Validation model

`runFilingValidation()` (`src/lib/filing/filingValidator.ts:327-344`) is pure/DB-free — callers
fetch the data and pass it in — and runs these checks every time (from `validate/route.ts` and,
unconditionally, from `transmit/route.ts`):

| Rule name | Field | Blocking? | Message pattern |
|---|---|---|---|
| `REQUIRED_7501_BLOCKS_POPULATED` | form7501 | Yes | "Required 7501 blocks missing: Entry Type (Block 2), Importer of Record (Block 23), Port of Entry (Block 45), Line Items (Block 28–35)." (only the missing ones listed) |
| `ALL_LINES_HAVE_APPROVED_DECISION` | lineItems | Yes | "N line item(s) have no HTS code or approved classification decision..." / "...have an HTS code but no approved classification decision..." |
| `NO_BLOCKING_RECONCILIATION_ISSUES` | reconciliationIssues | Yes | "N reconciliation issue(s) with blocksFiling=true remain unresolved." |
| `NO_BLOCKING_EXCEPTIONS` | exceptions | Yes | "N blocking exception(s) are unresolved." |
| `BOND_NOT_EXPIRED` | bond | Yes (when an expiration date is on file) | "Bond expired on {date}." / "Bond valid until {date}." — if no expiration date is on file, both bond checks degrade to non-blocking "cannot verify" passes |
| `BOND_SUFFICIENT` | bond | No | "Bond amount ($x) may be insufficient to cover estimated duties ($y)." |
| `IMPORTER_CBP_NUMBER_VALID` | importerOfRecord | Yes | fails if no importer linked, no CBP number on file, or the number isn't 9 digits after stripping non-digits |
| `PORT_OF_ENTRY_VALID_ACE_CODE` | portOfEntry | Yes | fails if unset, no 4-digit code extractable, or the code isn't in the seeded ACE port list (`prisma/seed-data/ace-ports.json`) |
| `ENTRY_TYPE_VALID_FOR_MODE` | entryType | No | only runs when a mode-specific rule is actually configured (`validEntryTypesForMode`); otherwise passes as "skipped" |
| `HTS_RELEASE_CURRENT` | htsRelease | No | fails if the latest published US HTS release is more than 30 days old |
| `READINESS_SCORE_THRESHOLD` | readinessScore | Yes | fails if the shipment's AI readiness score is below the configured threshold (`AgentPolicyConfig.autoThreshold`, default 80) |

`ValidationOutcome.valid` is `blockers.length === 0`; any blocker returns a 422 from both the
validate and transmit routes with the full `blockers`/`warnings` arrays.

## 6. Child actions and per-action data requirements

"Child actions" are the operator-invocable actions offered on a filing beyond the main
approve/transmit/resubmit flow — today, only `CANCEL`. They are not hardcoded booleans; they're a
dynamic list resolved per `(country, procedureCode, messageName, status)` from the
`FilingChildActionRule` table by `resolveChildActions()`
(`src/lib/canonicalMessaging/childActionRules.ts:14-43`). Rows are grouped by action and
most-specific-match-wins is applied independently per action, so one action could come from a
country-specific row while another falls back to a wildcard row in the same lookup. Adding a new
child action (e.g. `AMEND`) is a seed-data row plus one entry in the client's
`CHILD_ACTION_REGISTRY` (`FilingDetailClient.tsx:160-174`) — the resolver, the render loop, and the
confirmation modal never change.

Separately, `FilingActionDataRequirement` supplies whatever *extra* fields a given `(country,
procedure, messageName)` + action needs beyond the base declaration — e.g. a German NCTS guarantee
reference for a `CANCELLATION`. `resolveActionDataFields()`
(`src/lib/canonicalMessaging/actionDataRequirements.ts:103-114`) returns the field tree (scalars or
recursively nested `grid` types, each field sourced either from an automatic `shipment.<path>`
lookup or from an operator `prompt`); `GET /api/filing/[id]/action-fields` exposes this to the UI
for rendering a confirmation form before an action is sent, and `buildActionExtensions()`
(`actionDataRequirements.ts:126-141`) resolves and validates those same fields (throwing
`MissingActionFieldError` for any unmet `required` field) when `cancelFiling()` actually builds and
publishes the message. This is the one mechanism through which country-specific extra data enters
an outbound message — `cancelFiling()` never branches on country itself; it only asks "what does
this context need."

Note: `resolveAllowUpdates()` (`src/lib/canonicalMessaging/filingActionRules.ts:16-34`, reading
`FilingActionRule`) is a related but distinct gate — it controls whether the Declaration tab's
line-item edit surface (and Save/Save & Resubmit) is shown at all, independent of which child
actions are offered.
