# Global Product / Item Master

One record per product, per tenant, holding what is true about the goods
everywhere — and, hanging off it, the separate customs positions each
jurisdiction has been given.

## The rule the whole model exists to enforce

A product does not have *a* tariff code. It has a US code, an EU code, a UK
code, each decided by someone, each with a status and a date range, each capable
of disagreeing with the others. So there is no `Product.hsCode` column and there
never will be; classification lives in `ProductClassification`, keyed by
jurisdiction and nomenclature.

The same split applies to origin. `ProductCountryFact` distinguishes
`MANUFACTURE_COUNTRY`, `PRODUCTION_COUNTRY` and `ORIGIN_CLAIM` because they are
different facts. Where something was assembled is an observation; what its
country of origin is under a given rule set is a legal determination, and the
system will not turn the first into the second.

"Global" here means one tenant's products across many jurisdictions. It never
means shared across tenants. Every table in this domain carries `accountId`.

## Data model

New tables, all in `prisma/migrations/20260811120000_global_product_master/`.

| Table | Holds |
| --- | --- |
| `Product` | Jurisdiction-neutral identity: names, three descriptions, brand, model, lifecycle and review status, `internalSku` (unique per account), `currentVersion` |
| `ProductIdentifier` | SKUs, GTIN/UPC/EAN, part and model numbers, with `normalizedValue` for lookup and an optional issuing `LegalEntity` |
| `ProductAttribute` | Typed, coded facts (`NET_WEIGHT`, `POWERED`, `HAZMAT`, …) with value, unit, status and evidence |
| `ProductComposition` | Materials and percentages, with `isCompleteDeclaration` recorded rather than assumed |
| `ProductParty` | Manufacturer / supplier / brand owner, as `LegalEntity` references, plus manufacturing site |
| `ProductCountryFact` | Manufacture, production and origin-claim facts, each with its own status and basis |
| `ProductClassification` | Per-jurisdiction, per-nomenclature codes with status, effective window, method, reviewer, supersession chain |
| `ProductEvidence` | The provenance record: document, extracted fact, page, bounding box, excerpt, confidence *as reported by its source* |
| `ProductChangeEvent` | Field-level history with significance and impact flags — the version log |
| `ProductRevalidationFlag` | Open work items raised by customs-significant change |

Extended, additively: `ShipmentLineItem` gained `productId`,
`productMatchStatus`, `productMatchedAt`; `CanonicalProduct` gained a nullable
`productId` so the older lookup table points at the master rather than competing
with it.

Every foreign key to `Account` cascades; every classification, fact and
identifier carries its own `accountId` so a child row can be filtered without
joining through its parent.

## What counts as a customs decision

```text
CANDIDATE ──> PROPOSED ──> UNDER_REVIEW ──> APPROVED
    │             │              │
    └─────────────┴──────────────┴────────> REJECTED
```

`APPROVED` is the only status that means anything downstream —
`EFFECTIVE_CLASSIFICATION_STATUSES` is literally `["APPROVED"]`. A candidate
never becomes approved by being edited, imported, or proposed confidently. The
jump from `CANDIDATE` or `PROPOSED` straight to `APPROVED` is refused by
`canTransitionClassification`; approval additionally requires an identified
reviewer holding `products.classification.approve`, and optionally a different
person from the proposer.

`canApproveClassification` has no `source`, `confidence` or `agent` parameter.
There is no argument an automated caller could pass that would make it return
true.

Country facts move `CLAIMED → UNDER_REVIEW → VERIFIED` on the same principle: a
claim is not a verification.

`assertOriginNotInferred` throws if a basis is a manufacturer address, supplier
country, seller country, export country or shipping origin, in any spelling. A
rule-based basis ("CTH rule applied by analyst", "supplier declaration
document") passes.

## Matching

`productMatching.ts` is rule-based and returns one of four outcomes with the
rule that produced it and the value that matched:

| Rule | Outcome when one product matches |
| --- | --- |
| Unique identifier (GTIN, UPC, EAN, internal SKU) | `EXACT_MATCH` |
| Manufacturer-qualified part or model number | `EXACT_MATCH` |
| Unqualified part or model number | `POSSIBLE_MATCH` |
| Exact name **and** brand agreement | `POSSIBLE_MATCH` |

More than one product on any rule gives `AMBIGUOUS` with every candidate
returned and none chosen; a strong rule that collides does not fall through to a
weaker one. Only a single `EXACT_MATCH` is auto-attachable.

No embeddings, no similarity score, no edit distance. A near-miss on a part
number attaches goods to the wrong classification and the wrong origin claim,
and the resulting entry is wrong in a way nobody reviews because it looked
confident.

## Change detection

`detectProductChanges(before, after)` diffs two snapshots and grades each field
move `NON_MATERIAL`, `POTENTIALLY_CUSTOMS_SIGNIFICANT` or `CUSTOMS_SIGNIFICANT`.
`revalidationSignals` collapses the significant ones into at most four signals:

- `CLASSIFICATION_REVALIDATION_REQUIRED`
- `ORIGIN_REVALIDATION_REQUIRED`
- `REGULATORY_REVALIDATION_REQUIRED`
- `VALUATION_REVIEW_REQUIRED`

These are workflow signals, not customs decisions. Raising one asks a person to
look again; it does not change a code, an origin or a value, and the approved
position stays in force until someone changes it.

Rules worth knowing: reformatting a customs description is non-material;
renaming or rebranding is non-material; any composition percentage move is
significant with no threshold; an attribute code the catalogue does not know is
treated as significant on all three fronts, because an unknown fact that turns
out to matter is worse than a review that turns out to be unnecessary.

## Evidence

`ProductEvidence` reuses Document Intelligence provenance rather than restating
it: `sourceDocumentId` points at `ShipmentDocument`, `sourceExtractedFactId` at
`ExtractedFact`, and page/bbox/excerpt come from the extraction that produced
them. Confidence is stored as the number its source reported, attributed to that
source. Nothing here manufactures a page number or a bounding box for a fact
that a person typed in — a user-sourced fact has `sourceType: USER` and no
document coordinates.

Attributes, compositions, parties, country facts and classifications each carry
an optional `evidenceId`, so "why do we believe this?" is answerable per fact
rather than per product.

## CSV import

Three steps, three routes: `POST /api/products/import/preview` parses and
validates, the browser shows the outcome per row, `POST
/api/products/import/commit` writes only the rows the user kept.

The parser is RFC 4180 (quoted commas, doubled quotes, embedded newlines, BOM
stripped, short rows padded) and refuses a file that ends inside a quoted field
rather than half-reading it. Headers are mapped by alias — "Product Name",
"HS Code", "Made in", "Country of Origin" — and an unrecognised header is
reported, never guessed at. Two columns claiming one field make the file
ambiguous and it is refused whole.

The field list is closed, and deliberately contains no `status` or `approved`
column: a spreadsheet cannot assert a review that never happened. Imported
classifications land as `CANDIDATE`.

Idempotency is per row: `rowFingerprint` is stable across column order,
whitespace and added empty columns, and a row whose identifiers already resolve
to a product is reported `ALREADY_PRESENT` and skipped. Re-uploading the same
file creates nothing. A row that matches a product only possibly is skipped as
`NEEDS_REVIEW` rather than guessed at.

## Bulk JSON create

`POST /api/products/bulk` takes `{ items: CreateProductInput[] }` — up to
`BULK_CREATE_PRODUCT_MAX_ITEMS` (500) per request, the same shape as the body
of a single `POST /api/products`, just batched. It exists for a caller that
already has structured records (an ERP export, another system's API) rather
than a spreadsheet to fill in by hand. There is no `classifications` field
here, same as the single-item create: a tariff classification has its own
lifecycle and its own endpoint.

`bulkCreateProducts` mirrors `bulkCreateParties`: each item runs through the
same matcher a CSV row goes through before writing anything — `EXACT_MATCH`
is `ALREADY_PRESENT` and left untouched, `POSSIBLE_MATCH`/`AMBIGUOUS` is
`NEEDS_REVIEW` and left untouched, only `NO_MATCH` items are created. This is
insert-only, never an update of a matched product. One item failing on a
constraint the schema could not see is reported as that item's own `FAILED`
outcome, not an abort of the batch.

Authenticated exactly like every other route in this codebase: a Clerk
session, not an API key or service credential. That means it is not, today,
callable by a genuinely external system — only by something that can act as
an authenticated user of this app. It is shaped so that adding an API-key
layer later changes only how the caller authenticates, not this request or
response contract.

## API

All under `/api/products`, all through `withAuthenticatedRoute`, all scoped to
`ctx.accountId`.

| Route | Purpose |
| --- | --- |
| `GET/POST /api/products` | Search and create |
| `GET/PATCH/DELETE /api/products/[id]` | Detail, edit, archive (soft delete) |
| `.../identifiers`, `.../attributes`, `.../compositions`, `.../parties` | Add and remove facts |
| `.../country-facts` (+ `[factId]`) | Add a fact; review a claim |
| `.../classifications` (+ `[classificationId]`) | Propose; review/approve |
| `.../evidence` | Attach provenance |
| `.../history` | Change events |
| `.../revalidation/[flagId]` | Resolve or dismiss a flag |
| `/api/products/match` | Deterministic match for a description of goods |
| `/api/products/line-items/[lineItemId]` | `GET` what the matcher makes of a shipment line; `POST` to attach it (or detach with `null`) |
| `/api/products/import/{template,preview,commit}` | CSV round trip |
| `POST /api/products/bulk` | Bulk create from a JSON array, no CSV in between |
| `/api/products/capabilities` | What the intelligence registry can and cannot do |

A product in another account is reported `PRODUCT_NOT_FOUND` with 404, never
403: a 403 confirms the id exists somewhere, which is itself a leak.

## The legacy path, still standing

`CanonicalProduct` / `ProductAlias` and `POST /api/products/normalize` predate
this work. That model is exactly what this domain exists to replace: a single
`htsCode` and a single `countryOfOrigin` on the product record, with no
jurisdiction and no status. It has not been deleted, because live rows and
callers depend on it.

What has changed is that `CanonicalProduct.productId` now points at the master,
backfilled by the migration, so the two can be read together while callers move
across. The legacy route is untouched and still writes what it always wrote;
nothing in the new domain reads its `htsCode` as a customs position.

## Permissions

| Permission | Default roles |
| --- | --- |
| `products.create` | all but viewer |
| `products.edit` | all but viewer |
| `products.import` | owner, admin |
| `products.classification.approve` | owner, admin |
| `products.origin.verify` | owner, admin |

Reading the catalogue needs only an account, like shipments. Every write action
in the UI is gated individually and disappears rather than failing on submit.

## Extension points, and what is not behind them

`productIntelligence.ts` defines `ClassificationProvider`, `OriginProvider` and
`RegulatoryProvider`, and a registry that currently has none of them
registered. `allCapabilityStatuses()` reports each as unavailable with the
reason, and the Trade & Customs tab prints that list under "What Qubere does not
do here".

Not implemented, by design: HS/HTS classification inference, rules-of-origin
determination, FTA qualification, BOM roll-up, duty or landed-cost calculation,
trade remedies, sanctions, export control, denied-party screening, ERP/PIM
connectors, and vector or semantic matching. The seams exist so these can arrive
as providers. The system says so out loud rather than presenting an empty tab as
a clean bill of health.
