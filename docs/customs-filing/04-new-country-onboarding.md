# Onboarding a New Country

This runbook explains what actually has to happen to add a new country to the
customs-filing module, grounded in the Germany ("DE") rollout that proved the
design (`scripts/seed-canonical-messaging.ts`, and
`docs/customs-filing-canonical-messaging-changelog.md`'s 2026-08-12 entry "A
real second country: Germany (DE), zero application code changed").

## 1. What "onboarding a country" means in this design

There is no per-country branch anywhere in the resolution path. Every place
that needs a country-specific fact — which procedure code an entry type maps
to, which authority a filing is addressed to, what message name to publish,
how an inbound status maps to a filing transition, what extra fields an
action needs — resolves it by querying a reference table and picking the most
specific matching row via `findMostSpecificMatch()`
(`src/lib/canonicalMessaging/wildcardLookup.ts:10-37`), which scores candidates
by how many of their key columns are a literal `"*"` wildcard versus an exact
match, and picks the fewest-wildcards (most specific) match. Because every
lookup is written this way, adding a country is populating rows in a fixed
set of tables, not writing or branching code. The DE rollout is the existence
proof: the changelog states plainly it required "zero application code
changed" — only `seedGermanyConfig()` and a wildcard cleanup in
`scripts/seed-canonical-messaging.ts:94-115`.

## 2. The reference tables to populate, in order

### `FilingProcedureMapping`

Maps `(entryType, country)` → the destination's procedure code. For DE, only
a conservative 3-code subset was mapped, chosen because they have a clean
analogue in the EU's harmonized Customs Procedure Code (CPC) scheme
(`scripts/seed-canonical-messaging.ts:94-107`):

```
{ entryType: "01", procedureCode: "4000" }  // Consumption -> release for free circulation
{ entryType: "21", procedureCode: "7100" }  // Warehouse -> customs warehousing
{ entryType: "23", procedureCode: "5300" }  // Temporary Importation under Bond -> temporary admission
```

Note this is deliberately not all 18 `entryType.ts` codes — only the ones
with a confident CPC mapping were seeded; the rest simply have no DE row yet.

If a shipment's `(entryType, country)` has no row and no `"*"` wildcard row
exists, `resolveMessageContext()` throws:

> `No FilingProcedureMapping row for entryType "${entryTypeCode}" and country "${country}" (and no "*" wildcard fallback exists). Add the mapping before filing to this destination.`

(`src/lib/canonicalMessaging/resolveMessageContext.ts:43-48`)

### `FilingAuthorityConfig`

One row per country: `country → { authorityName, filingSystemLabel }`. DE's
row (`scripts/seed-canonical-messaging.ts:109-114`):

```
{ country: "DE", authorityName: "German Customs Administration (Zoll)", filingSystemLabel: "ATLAS - Automated Import System" }
```

This table deliberately has **no wildcard fallback** — the seed script's own
comment is explicit that "adding a country is adding a row, not widening a
fallback that would silently apply the wrong authority name to a country
nobody has configured yet" (`scripts/seed-canonical-messaging.ts:217-220`). A
country with no `FilingAuthorityConfig` row simply cannot have a filing
created for it (enforced upstream in `POST /api/filing`, per the changelog's
"fails closed" entry).

### `FilingMessageCatalog`

Maps `(action, country, procedureCode)` → `{messageName, queueName}`. As of
the DE rollout this table is seeded **once, as wildcard rows**, not
per-country — the message names (`CUSTOMS_DECLARATION_SUBMIT`, etc.) are the
system's own internal identifiers, not a destination's wire format, so they
don't vary by country (`scripts/seed-canonical-messaging.ts:117-153`). A new
country needs no new row here unless it genuinely requires a different
message name for some action/procedure combination (see section 4). Missing
row error: `No FilingMessageCatalog row for action "${action}", country "${country}", procedure "${procedure}" (and no "*" wildcard fallback exists).` (`resolveMessageContext.ts:63-67`).

### `FilingResponseStatusMapping`

Maps `(country, messageName, canonicalStatus)` → `filingTransition`. Also
seeded as wildcard rows only, on the same reasoning ("an ACCEPTED response
accepts the filing" isn't US-specific) (`scripts/seed-canonical-messaging.ts:155-198`):

```
ACCEPTED -> cbp.accept
REJECTED -> cbp.reject
NEEDS_INFO -> cbp.requestDocuments
RELEASED -> cbp.release
CANCELLED -> cbp.cancel
```

There is deliberately no `ERROR` row — the seed comment explains an error
responding to a SUBMIT and an error responding to a CANCELLATION don't mean
the same thing for `filingStatus`, so there's no single correct transition to
guess at (`scripts/seed-canonical-messaging.ts:156-158`). A new country
inherits all five rows for free. If a country's authority genuinely needs a
different mapping, it gets its own country-specific row, which wins over the
wildcard via most-specific-match. No row (and no wildcard) means the inbound
consumer records the response but leaves `filingStatus` unchanged rather than
guessing (`inboundConsumer.ts`, per changelog Phase 5).

### `FilingActionRule`

Governs whether declaration edits are allowed (`allowUpdates`) for a given
`(country, procedureCode, messageName, status)`. Seeded as wildcard rows
keyed only on status — `ValidationFailed`, `Rejected`, `DocumentsRequested`
(`scripts/seed-canonical-messaging.ts:200-215`). A new country inherits these;
add a country-specific row only if that country's edit-access rules genuinely
differ by status.

### `FilingChildActionRule`

Which dynamic child actions (today: `CANCEL`) are offered for a given
`(country, procedureCode, messageName, status)`. Seeded as wildcard rows for
six statuses (`scripts/seed-canonical-messaging.ts:232-263`). Again, DE
inherits this unchanged; the changelog's DE verification confirms `CANCEL` is
correctly offered "via the country-wildcard `FilingChildActionRule`,
unchanged."

### `FilingActionDataRequirement`

The nested field tree an action (e.g. `CANCELLATION`, `AMENDMENT`) needs
beyond the base declaration, resolved most-specifically over `(country,
procedureCode, messageName)` with `action` as an exact filter
(`src/lib/canonicalMessaging/actionDataRequirements.ts:96-114`). No match
returns an empty field list — "a safe default: the action still works with
just the base declaration" (`actionDataRequirements.ts:101`).
`scripts/seed-action-data-requirements.ts` is the real example: it seeds a
two-level-deep nested grid for `CANCELLATION` (`affectedGoodsItems` rows, each
with a nested `affectedPackages` grid) and `AMENDMENT` (`amendedLineItems`
rows, each with a nested `fieldChanges` grid), with fields sourced either from
`"prompt"` (asked of the operator, e.g. `cancellationReason`,
`cancellationReasonCode`) or automatically from
`"shipment.filing.entryNumber"` (`scripts/seed-action-data-requirements.ts:15-149`).

**Note:** this existing seed script keys its rows as `country: "US"` rather
than the wildcard `"*"` convention used everywhere else
(`scripts/seed-action-data-requirements.ts:154-159`). That means DE currently
has no `FilingActionDataRequirement` row for `CANCELLATION`/`AMENDMENT` and
falls back to the safe empty-list default (no extra prompted fields) rather
than inheriting the US fields — this is a genuine inconsistency with the
wildcard-first pattern established elsewhere, not a deliberate DE decision,
and worth resolving (either re-seed as `"*"` if the fields really are
universal, or add a DE-specific row if Zoll's ATLAS system needs different
ones) when a real second country's action requirements are worked out.

## 3. Country-specific message formats

Be clear-eyed about a real limitation: `CanonicalCustomsDeclaration` (the JSON
envelope validated against `schemas/customs-filing/filing-request-declaration/1.0.1.json`)
is the **same shape for every country** today. There is no per-country wire
format transformer. This is consistent with the fact that there is no real
authority integration yet — `PgCanonicalMessagePublisher` writes to an
internal outbound queue table, and a dev stub / mock responder answers it,
not a real customs authority (see changelog's "Post-Phase-7" and "dev stub"
entries).

If/when a real integration for a country needs a different wire format (say,
DE's ATLAS system expects XML rather than this JSON envelope), the natural
plug-in point is immediately before the publish call in
`src/modules/filings/filing.service.ts`, e.g. at
`await new PgCanonicalMessagePublisher().publish(context.queueName, message);`
(`filing.service.ts:148`, and the equivalent call at `filing.service.ts:321`).
A country-aware transform would sit between building the canonical `message`
and that `.publish()` call — transforming the universal shape into whatever
that specific queue/consumer expects — without touching `resolveMessageContext`,
the declaration builder, or the reference-table lookups upstream of it.

## 4. Handling multiple workflows/variations for one country

The same most-specific-match mechanism that lets a country fall back to
wildcard rows also lets it override them per entry type or procedure. Because
`findMostSpecificMatch()` scores a candidate by how many of its key columns
are non-wildcard exact matches (`wildcardLookup.ts:18-33`), a row scoped to
`(action: "SUBMIT", country: "DE", procedureCode: "5300")` always outranks
the universal `(action: "SUBMIT", country: "*", procedureCode: "*")` row, even
though both match.

Worked example (hypothetical — not present in the current seed data, but
directly buildable on top of it): suppose DE's temporary-admission procedure
(`5300`, from the TIB mapping above) needs its own message name because
Zoll's ATLAS system routes temporary-admission declarations through a
separate queue. Today `FilingMessageCatalog` only has the universal
`(SUBMIT, *, *) -> CUSTOMS_DECLARATION_SUBMIT` row. Adding:

```
{ action: "SUBMIT", country: "DE", procedureCode: "5300", messageName: "ATLAS_TEMP_ADMISSION_SUBMIT", queueName: "customs-filing-outbound-de-atlas" }
```

means any DE filing under procedure `5300` resolves to the new row (2
non-wildcard matches: country + procedureCode) while every other DE
procedure, and every other country, keeps resolving to the universal wildcard
row (0 non-wildcard matches). No code change, no branch — just a more
specific row.

## 5. Status handling for a new flow

`FilingResponseStatusMapping` maps a country's incoming `canonicalStatus`
string to one of the `FilingTransition` values already defined in
`src/modules/filings/filingStateMachine.ts:43-60`. This mapping is fully
data-driven — a new country can freely decide that its `"NEEDS_INFO"` status
means `cbp.requestDocuments`, for instance.

What is **not** data-driven: the target vocabulary itself.
`FilingTransition` (`filingStateMachine.ts:43-60`) and `FilingStatus`
(`filingStateMachine.ts:6-23`) are closed TypeScript union types, and
`TRANSITIONS` (`filingStateMachine.ts:67-114`) is a fixed, hand-written
transition graph enforced by `applyTransition()`/`canTransition()`. A new
country's `FilingResponseStatusMapping` rows can only point at transitions
that already exist (`cbp.accept`, `cbp.reject`, `cbp.requestDocuments`,
`cbp.hold`, `cbp.release`, `cbp.cancel`, etc.) — it cannot invent a new status
or a new transition purely through seed data. If a country's actual customs
process needs a status this graph has no equivalent for (e.g. a distinct
"partially released" state), that requires a code change to
`filingStateMachine.ts` (a new `FilingStatus` value, a new `FilingTransition`,
and a new `TRANSITIONS` entry with its own legal `from`/`to` list) before any
seed data can reference it. This mirrors exactly how `cbp.cancel` itself was
added as a genuine code change (changelog, 2026-08-12 "Closed the 'cancel
after transmission' gap") before the corresponding `CANCELLED -> cbp.cancel`
mapping row could be seeded.

## 6. New action types

The same closed-union limitation applies one level up. `FilingMessageAction`
(`src/lib/canonicalMessaging/types.ts:10-15`) is a fixed TypeScript union:
`"SUBMIT" | "AMENDMENT" | "CANCELLATION" | "RESUBMIT" | "STATUS_INQUIRY"`.
Every table keyed partly by `action` (`FilingMessageCatalog`,
`FilingActionRule`, `FilingChildActionRule`, `FilingActionDataRequirement`)
assumes the action already exists in this list.

If a country needs a genuinely new action — the changelog's own example is a
transit-regime action, and historically `AMENDMENT` itself was "a defined
`FilingMessageAction` with no `FilingService` method, no route, and no UI"
for a period (changelog, "Post-Phase-7 walkthrough fixes") — onboarding that
action requires:

1. Adding the new action string to the `FilingMessageAction` union
   (`types.ts:10-15`).
2. Adding a corresponding `FilingTransition` (and `TRANSITIONS` entry) to
   `filingStateMachine.ts` if the action changes filing status.
3. A new `FilingService` method (mirroring `cancelFiling()`'s shape: resolve
   context, build/reuse a declaration, call `buildActionExtensions()`,
   publish) and a route/UI entry point.

Only once the action type exists in code does it become fully config-driven:
which fields it needs (`FilingActionDataRequirement`), which procedure/message
name it resolves to (`FilingProcedureMapping`/`FilingMessageCatalog`), and
which statuses offer it (`FilingChildActionRule`) are all seed data from that
point on, identical in mechanism to `CANCELLATION`/`AMENDMENT` today.

## 7. Worked checklist: onboarding country "XX"

1. **Confirm entry types.** Decide which of the existing `entryType.ts`
   codes (`ENTRY_TYPE_CODES`) XX's declarations will actually use — don't
   assume all 18 apply, the way DE only mapped 3.
2. **`FilingProcedureMapping`** — add one row per `(entryType, "XX")` with
   XX's real procedure code for that entry type. Skip codes with no clean
   analogue rather than guessing.
3. **`FilingAuthorityConfig`** — add exactly one row:
   `{ country: "XX", authorityName, filingSystemLabel }`. No wildcard exists
   for this table; without this row, filing creation for XX is blocked.
4. **`FilingMessageCatalog`** — verify the existing wildcard
   (`action: "*", country: "*", procedureCode: "*"`) rows are sufficient
   (they usually are, since message names are internal identifiers). Add a
   country/procedure-specific row only if XX genuinely needs a different
   message name or queue for some action (see section 4's worked example).
5. **`FilingResponseStatusMapping`** — verify the existing wildcard rows
   cover XX's inbound status vocabulary once translated to canonical
   statuses (`ACCEPTED`/`REJECTED`/`NEEDS_INFO`/`RELEASED`/`CANCELLED`). Add
   an XX-specific row only if XX's authority's status semantics genuinely
   diverge from the universal mapping — and only pointing at
   `FilingTransition` values that already exist in
   `filingStateMachine.ts:43-60`.
6. **`FilingActionRule` / `FilingChildActionRule`** — verify the existing
   status-keyed wildcard rows are correct for XX's workflow (which statuses
   allow edits, which offer `CANCEL`). Add XX-specific rows only on genuine
   divergence.
7. **`FilingActionDataRequirement`** — if XX's authority needs extra fields
   for `CANCELLATION`/`AMENDMENT`/etc. beyond the base declaration, add a row
   per action scoped to `(country: "XX", procedureCode, messageName)` with
   the field tree (see `scripts/seed-action-data-requirements.ts` for the
   pattern, including nested grids). Note the current US-keyed inconsistency
   flagged in section 2 before assuming XX will inherit anything by default.
8. **Wire-format transform (only if a real integration exists for XX)** —
   if XX's authority needs a non-JSON wire format, add the transform
   immediately before `PgCanonicalMessagePublisher.publish()` in
   `filing.service.ts` (see section 3). Not needed while XX runs through the
   dev stub / mock responder.
9. **Verify end-to-end with a disposable fixture**, mirroring the DE
   verification in the changelog: create a shipment with
   `destinationCountry: "XX"`, confirm procedure and authority resolve,
   create → validate → approve → transmit a filing, confirm the published
   envelope carries the right `country`/`procedure`/`authority`/
   `schemaVersion`, confirm a mock response moves `filingStatus` via the
   expected transition, confirm `CANCEL` (or other child actions) is offered
   correctly, then delete the fixture.
10. **Only if XX needs an action or status this design has no vocabulary
    for** — stop and make the code change first (sections 5–6): extend
    `FilingStatus`/`FilingTransition`/`TRANSITIONS` in
    `filingStateMachine.ts` and/or `FilingMessageAction` in `types.ts`, add
    the `FilingService` method and route, then return to steps 2–9 to
    configure it for XX.
