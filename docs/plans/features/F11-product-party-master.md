# F11 · Product & Party Master
> Depends on: F01 (normalization quality fixes), F05 (classification binding)
> Branch: `feat/product-party-master`
> Features covered: #6 Canonical product master, #7 Product intelligence enrichment

---

## Capability A — Canonical Product Master (Production Quality)

Full CRUD + import UI exists. `POST /api/products/normalize` uses regex stripping and hardcoded defaults.

* **Task A-1**: Remove ALL hardcoded defaults from `POST /api/products/normalize`: no `"PN-9901"`, no `"Germany"`, no `"8481.80.5090"`, no `"2.8%"`. If a field cannot be extracted, it must be null (or empty), never a placeholder. Return `422` if normalization cannot produce a meaningful result.
* **Task A-2**: Normalization engine in `src/lib/products/normalizationEngine.ts`: structured pipeline:
  1. Strip noise: remove size/color/config suffixes using a configurable ruleset (not a hardcoded regex)
  2. Extract identifiers: pull part numbers, SKUs, UPC codes via pattern matching
  3. Language normalization: capitalize consistently, expand abbreviations (lookup table)
  4. Alias detection: check `ProductAlias` table — if the normalized name matches a known alias, link to the canonical product
  5. Deduplication: compute a normalized fingerprint; check against existing products before creating a new one
* **Task A-3**: `POST /api/v1/products/canonical/[productId]/bind-classification` (already exists): verify it correctly links the `ProductClassification` and sets `effectiveDate`. Return the updated canonical product.
* **Task A-4**: Product match API: `POST /api/products/match`: given a free-text description, return top-3 matching canonical products with match confidence and match basis (exact part number / alias / description similarity). Used during line item creation and document extraction.
* **Task A-5**: Alias management UI: product detail "Aliases" tab — list all `ProductAlias` rows. Add/remove aliases. When a new alias is added, run deduplication check to see if it resolves to a different existing canonical product.
* **Task A-6**: Product search: `GET /api/products?q=...` — full-text search across `name`, `description`, `partNumber`, and `ProductAlias.alias`. Paginated. Return `{ id, name, partNumber, currentHtsCode, confidence }`.
* **Task A-7**: Vitest: normalization removes noise correctly; duplicate detection fires for same normalized fingerprint; alias match resolves to canonical product.

## Capability B — Product Intelligence Enrichment

`ProductAttribute`, `ProductComposition`, `ProductCountryFact` models exist. UI tabs exist.

* **Task B-1**: `POST /api/products/[id]/attributes`: create/update product attribute. Attributes have `key`, `value`, `unit?`, `source: "MANUAL" | "AI" | "ERP"`, `evidenceId?`. Examples: `material: "304 stainless steel"`, `dimensions: "10x5x3 cm"`, `weight: "0.5 kg"`, `intendedUse: "Industrial valve for oil & gas"`.
* **Task B-2**: `POST /api/products/[id]/compositions`: material composition. `{ material, percentageLow, percentageHigh, casNumber? }`. Used for AD/CVD scope analysis and origin determination. Percentage range (not exact) to account for process variation.
* **Task B-3**: `POST /api/products/[id]/country-facts`: manufacturing facts per country. `{ countryCode, step, description, addedValuePct }`. Used by origin determination engine. Multiple steps per country.
* **Task B-4**: AI enrichment: `POST /api/products/[id]/enrich` — triggers Claude API with the product name, description, and any existing attributes. Returns structured enrichment suggestions (not applied automatically): `{ suggestedAttributes: AttributeSuggestion[], confidence }`. User reviews and approves each suggestion. Each approved suggestion writes an attribute with `source: "AI"` and links to the `AgentDecision` row for audit.
* **Task B-5**: Evidence tracing: every product attribute, composition, and country fact has an optional `evidenceId` linking to a `ProductEvidence` row. `ProductEvidence` links to: a `ShipmentDocument` (e.g. spec sheet), a `ProposalEvidence` (classification reasoning), or a manual note. UI shows the evidence source on hover.
* **Task B-6**: Revalidation flags (`ProductRevalidationFlag`): when a product attribute changes that could affect classification, origin, or valuation, set a revalidation flag. UI shows products with pending revalidation. Flags clear when the affected decisions are reviewed.
* **Task B-7**: Product capability API: `GET /api/products/capabilities` — returns `{ hasAttributes, hasCompositions, hasCountryFacts, hasClassification, hasOriginDetermination }` for the account's product catalog. Used by dashboard to show enrichment completeness.
* **Task B-8**: Vitest: enrichment approval writes attribute with source AI and decision link; revalidation flag fires on classification-relevant attribute change; evidence link resolves to correct document.

## Capability C — Party Master (Production Quality)

`Party`, `PartyName`, `PartyIdentifier`, `PartyRegistration`, `PartyAddress`, `PartyContact`, `PartyRole`, `PartySite`, `PartyRelationship`, `PartyEvidence` — full schema exists. Import wizard and CRUD exist.

* **Task C-1**: Party deduplication: `POST /api/parties/match` — given a party name + address, return top-3 matching existing parties with confidence. Used during shipment creation and document extraction to suggest existing parties rather than creating duplicates.
* **Task C-2**: Party revalidation: `PartyRevalidationFlag` model exists. When a party is linked to a new shipment, check if the party has changed since last use (address, identifier, roles). If yes, set revalidation flag and create `ExceptionItem`.
* **Task C-3**: Screening integration: when a new party is added, automatically run DPS (denied party screening) via `POST /api/screening/dps` (currently a toy list — see F01 data gap, requires real watchlist data). Create `ScreeningLog` row. If a match is found, create `ExceptionItem` with `category: "COMPLIANCE"`.
* **Task C-4**: Party evidence: `POST /api/parties/[id]/evidence` — attach supporting documents (e.g. manufacturer affidavit, factory audit report). Linked to `PartyEvidence` model.
* **Task C-5**: Relationship types: `PartyRelationship` with `type: "MANUFACTURER" | "SUPPLIER" | "FREIGHT_FORWARDER" | "CUSTOMS_BROKER" | "CONSIGNEE" | "NOTIFY_PARTY"`. UI shows the relationship graph for a party (which shipments, which roles).
* **Task C-6**: Vitest: party match returns ranked results; revalidation flag fires on address change; screening runs on new party creation.

## Data gaps
- **DPS screening**: `DeniedPartyWatchlist` model has seeded toy data. Real screening requires: BIS Consolidated Screening List (free API), OFAC SDN (free download). Neither is wired. Until real data is seeded, party screening returns an honest empty result, not a false "no match".
- **Product enrichment AI quality**: The enrichment suggestions from Claude API are only as good as the product description provided. For very sparse descriptions, suggestions will be generic. Document this limitation.
