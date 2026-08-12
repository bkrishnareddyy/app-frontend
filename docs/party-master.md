# Global Party Master

One record per legal or natural party, per tenant, holding who they are — with
the roles they play, the registrations that prove it, and the changes to any
of that tracked as first-class history rather than silently overwritten.

## The rule the whole model exists to enforce

A party is not "verified" or "unverified" as a whole. Its *registrations* are
claimed, under review, verified or superseded, each on its own timeline, each
in its own country; its *review status* (has a person looked at this record at
all) is a separate axis from whether any one registration checks out. So there
is no `Party.verified` boolean and there never will be one — that single flag
is exactly the shortcut the spec rules out ("never fabricate verification"),
because it lets a status survive the fact that produced it.

Identity and role are also kept apart. `PartyRole` records that a party is
acting as a supplier, importer, carrier, broker, and so on, each role its own
row with its own status — a party does not carry one fixed "type." And a name
match is never treated as legal-identity proof: `partyMatching.ts`'s
name-and-country rule is capped below `EXACT_MATCH` even when exactly one party
matches, because "Acme Trading GmbH" and "Acme Trading GmbH" are two different
words that happen to render the same, not a proof of common identity.

"Global" here means one tenant's parties across every jurisdiction they touch.
It never means shared across tenants. Every table in this domain carries
`accountId`, sourced only from the authenticated actor, never from a request
body or parameter.

## Data model

New tables, all in `prisma/migrations/20260812090000_global_party_master/`
(written, not yet applied — see "Status of this work").

| Table | Holds |
| --- | --- |
| `Party` | Jurisdiction-neutral identity: `internalPartyCode` (unique per account), lifecycle status, review status, `currentVersion` |
| `PartyName` | Legal name, trade names, prior names — each typed, each with a status, `normalizedName` for matching |
| `PartyIdentifier` | EORI, DUNS, LEI, VAT, tax ID, customs ID, customer/supplier number, internal code — typed, with `normalizedValue` and, where the scheme requires one, an issuing country |
| `PartyRegistration` | Per-country registration claims: number, registering authority, legal form, status, effective window, evidence |
| `PartyAddress` | Registered, mailing, and site addresses, each typed and each independently revalidated |
| `PartyContact` | Named contacts with email/phone, scoped to the party |
| `PartyRole` | The roles a party currently or previously held (`SUPPLIER`, `IMPORTER`, `CARRIER`, `BROKER`, `MANUFACTURER`, …), each with its own status |
| `PartyRelationship` | Directed links between two parties of an account (parent/subsidiary, agent-of, …) |
| `PartySite` | Physical sites belonging to a party, distinct from its addresses |
| `PartyEvidence` | The provenance record: document, extracted fact, page, bounding box, excerpt, confidence *as reported by its source* |
| `PartyChangeEvent` | Field-level history with significance and impact flags — the version log |
| `PartyRevalidationFlag` | Open work items raised by a compliance-significant change, resolved by a person, never auto-cleared |

Extended, additively: `LegalEntity` gained a nullable `partyId`, mirroring
`CanonicalProduct.productId` in the product master. Nothing on `LegalEntity`
is replaced by it; `ShipmentParty` and `ProductParty` keep reading
`LegalEntity` exactly as they always have.

Every foreign key to `Account` cascades; every child table carries its own
`accountId` so it can be filtered without joining through its parent — the
concrete defense against a future query that forgets the join.

## What counts as a decision about a party

Two independent lifecycles, deliberately not merged into one flag:

```text
Review:         UNREVIEWED ──> IN_REVIEW ──> APPROVED
                                  │              │
                                  └──────────────>├──> NEEDS_REVIEW ──> IN_REVIEW ...
                                                  └──> REJECTED

Registration:   CLAIMED ──> UNDER_REVIEW ──> VERIFIED
                                 │               │
                                 └───────────────┴──> (back to UNDER_REVIEW, reopenable)
                            SUPERSEDED is terminal from any prior status.
```

`canApproveParty` requires the party to already be `IN_REVIEW`, a named
`reviewerUserId`, and that reviewer holding `parties.review.approve`. There is
no `source` or `confidence` parameter — no argument an automated caller could
pass makes it return `true`.

`canVerifyRegistration` requires `UNDER_REVIEW`, a named `verifiedByUserId`,
the `parties.registration.verify` permission, **and** a non-null
`evidenceId`. This last condition is the concrete anti-fabrication gate: a
reviewer who is sure but has attached nothing cannot verify a registration.

`effectiveRegistration(registrations, country, at)` picks the in-force
`VERIFIED` row for a country at a point in time and sets `conflicting: true`
rather than silently picking a winner when more than one verified row
overlaps — a conflict is a fact to surface, not to resolve by tie-break.

## Matching

`partyMatching.ts` is rule-based, ranked strongest to weakest, and returns one
outcome with the rule and value that produced it:

| Rule | Outcome when one party matches |
| --- | --- |
| Unique identifier (EORI, DUNS, LEI, internal party code) | `EXACT_MATCH` |
| Registration number + country | `EXACT_MATCH` |
| Country-qualified identifier (VAT, TAX_ID, CUSTOMS_ID, customer/supplier number) + issuing country | `EXACT_MATCH` |
| The same schemes without a country | `POSSIBLE_MATCH` (never `EXACT_MATCH`) |
| Legal name + country | `POSSIBLE_MATCH` (never `EXACT_MATCH`, even for one unambiguous hit) |

More than one party on any rule gives `AMBIGUOUS` with every candidate
returned and none chosen; a strong rule that collides does not fall through to
a weaker one. Only a single `EXACT_MATCH` is auto-attachable
(`isAutoAttachable`). Name-and-country is capped below exact on purpose — it
is the direct implementation of "never infer legal identity from weak name
similarity alone."

## Change detection

`detectPartyChanges(before, after)` diffs two snapshots and grades each field
move `NON_MATERIAL`, `POTENTIALLY_COMPLIANCE_SIGNIFICANT` or
`COMPLIANCE_SIGNIFICANT`. `revalidationSignals` collapses the significant ones
into at most four signals:

- `IDENTITY_REVALIDATION_REQUIRED`
- `REGISTRATION_REVALIDATION_REQUIRED`
- `ADDRESS_REVALIDATION_REQUIRED`
- `SCREENING_REVALIDATION_REQUIRED`

These are workflow signals, not screening results. Raising
`SCREENING_REVALIDATION_REQUIRED` asks a person to look again because the
identity it was based on moved — it is never written as a lasting flag on the
party, per "never treat screening as a simple permanent Party flag." A legal
name change, a government-issued identifier change (EORI/DUNS/LEI/VAT/TAX_ID/
CUSTOMS_ID), a registration change, or a change to a `REGISTERED` address all
re-raise it; a trade-name rename, a `SITE`/`MAILING` address change, or a
cosmetic reformat (whitespace/case only, same country) do not.

## Evidence

`PartyEvidence` reuses Document Intelligence provenance rather than restating
it: `sourceDocumentId` points at `ShipmentDocument`, `sourceExtractedFactId` at
`ExtractedFact`, and page/bbox/excerpt come from the extraction that produced
them. Confidence is stored as the number its source reported, attributed to
that source. A user-typed fact has `sourceType: USER` and no document
coordinates — nothing here manufactures a page number for a fact nobody
extracted.

Registrations, addresses and other facts each carry an optional `evidenceId`,
so "why do we believe this?" is answerable per fact. `canVerifyRegistration`
enforces that this is not optional at the point of verification.

## CSV import

Two steps, two routes: `POST /api/parties/import/preview` parses and
validates, the browser shows the outcome per row; `POST
/api/parties/import/commit` writes only the rows the user kept.

The parser (`partyCsv.ts`) is RFC 4180 — quoted commas, doubled quotes,
embedded newlines, BOM stripped, short rows padded — and refuses a file that
ends inside a quoted field rather than half-reading it. Headers are mapped by
alias ("Legal Name", "VAT Number", "Registration Country", "Customer No") and
an unrecognised header is reported, never guessed at. Registration country and
address country are kept as disjoint fields, so a spreadsheet cannot conflate
"where this entity is registered" with "where its address is." A number or
address line supplied without its paired country is rejected or warned rather
than assigned a guessed one.

The field list is closed and deliberately contains no `status`, `approved`, or
`verified` column: a spreadsheet cannot assert a review or a verification that
never happened. `rowFingerprint` is stable across column order, whitespace and
added empty columns, so re-uploading the same file is a no-op rather than a
duplicate.

## Bulk JSON create

`POST /api/parties/bulk` takes `{ items: CreatePartyInput[] }` — up to
`BULK_CREATE_PARTY_MAX_ITEMS` (500) per request, the same shape as the body
of a single `POST /api/parties`, just batched. It exists for a caller that
already has structured records (an ERP export, another system's API) rather
than a spreadsheet to fill in by hand.

`bulkCreateParties` runs each item through the same matcher a CSV row goes
through before writing anything: `EXACT_MATCH` is reported `ALREADY_PRESENT`
and left untouched, `POSSIBLE_MATCH`/`AMBIGUOUS` is reported `NEEDS_REVIEW`
and left untouched, and only `NO_MATCH` items are created. This is
insert-only — an item that matches an existing party is never used to update
it, so this path cannot be used to silently overwrite a fact a person already
reviewed. One item failing on a constraint the schema could not see is
reported as that item's own `FAILED` outcome, not an abort of the batch.

Authenticated exactly like every other route in this codebase: a Clerk
session, not an API key or service credential. That means it is not, today,
callable by a genuinely external system — only by something that can act as
an authenticated user of this app. It is shaped so that adding an API-key
layer later changes only how the caller authenticates, not this request or
response contract.

## API

All under `/api/parties`, all through `withAuthenticatedRoute`, all scoped to
`ctx.accountId`.

| Route | Purpose |
| --- | --- |
| `GET/POST /api/parties` | Search and create |
| `GET/PATCH/DELETE /api/parties/[id]` | Detail, edit, archive (soft delete) |
| `.../names`, `.../identifiers`, `.../addresses`, `.../contacts`, `.../roles`, `.../sites`, `.../relationships` (+ child id routes) | Add, edit, and remove facts |
| `.../registrations` (+ `[registrationId]`) | Claim a registration; review/verify it |
| `.../review` | Move a party's review status |
| `.../evidence` | Attach provenance |
| `.../history` | Change events |
| `.../revalidation/[flagId]` | Resolve a flag |
| `/api/parties/match` | Deterministic match for a candidate party |
| `/api/parties/import/{template,preview,commit}` | CSV round trip |
| `POST /api/parties/bulk` | Bulk create from a JSON array, no CSV in between |

A party in another account is reported `PARTY_NOT_FOUND` with 404, never 403:
a 403 confirms the id exists somewhere, which is itself a leak. Every
child-entity lookup (`nameId`, `identifierId`, `registrationId`, `addressId`,
`contactId`, `roleId`, `siteId`, `relationshipId`, `flagId`, `evidenceId`) is
scoped by `accountId: actor.accountId` in the same query as the id itself, not
checked afterward — so a foreign child id cannot be reached through a party
that does belong to the caller.

## The legacy path, still standing

`LegalEntity`, `ShipmentParty` and `ProductParty` predate this work and are
untouched: they still read and write `LegalEntity`'s own fields exactly as
they always did. What has changed is that `LegalEntity.partyId` now exists as
a nullable pointer at the master, so the two can be read together while
callers move across — nothing in the new domain reads `LegalEntity`'s inline
address or tax fields as a substitute for a `Party` registration or address.

## Permissions

| Permission | Default roles |
| --- | --- |
| `parties.create` | all but viewer |
| `parties.edit` | all but viewer |
| `parties.import` | owner, admin |
| `parties.review.approve` | owner, admin |
| `parties.registration.verify` | owner, admin |
| `parties.revalidation.resolve` | owner, admin |

Reading the party master needs only an account, like shipments and products.
Every write action in the UI is gated individually and disappears rather than
failing on submit.

## Extension points, and what is not behind them

`partyIntelligence.ts` defines `RegistryVerificationProvider` and
`ScreeningProvider`, and a registry that currently has neither registered.
`allCapabilityStatuses()` reports each as unavailable with a message written
for the person reading it, not a generic placeholder: "no external registry
lookup is connected" and "this party has not been screened against any
list," never "no matches found."

Not implemented, by design: sanctions/PEP/denied-party screening, beneficial
ownership graphs, corporate registry ingestion, autonomous party approval,
ERP/CRM/TMS connectors, and vector-based or fuzzy name matching. The seams
exist so these can arrive as providers later. The system says so out loud
rather than presenting an unscreened party as a clean bill of health.

## Status of this work

The migration in
`prisma/migrations/20260812090000_global_party_master/` has been written and
has **not** been applied to any database. Applying it (`prisma migrate
deploy`) is a decision for whoever owns that environment, not something this
change makes for them.
