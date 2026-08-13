# F06 · Origin, Valuation & Tariff
> Depends on: F01 (Decimal arithmetic), F05 (HTS classification for duty rates)
> Branch: `feat/origin-valuation-tariff`
> Features covered: #23 Origin determination, #24 Trade-agreement qualification, #25 Customs valuation engine, #26 Duty-stack calculation, #27 AD/CVD scope screening

---

## Capability A — Origin Determination Engine

`OriginDetermination` model exists. The API auto-creates `TradeAgreement` rows on the fly and defaults RVC to 65%.

* **Task A-1**: Remove all auto-create-on-read from `POST /api/advisory/origin-determination`. Never create `TradeAgreement` rows inside a route handler.
* **Task A-2**: Create `src/lib/origin/originEngine.ts`: pure function `determineOrigin({ product, manufacturingSteps, materials, claimedCountry }) → OriginResult`. Evaluates using: (1) substantial transformation test — is the tariff classification change sufficient? (2) specific rules of origin per trade agreement (USMCA Chapter 4 rules from `TradeAgreement` rows). Returns `{ determinedCountry, basis: "SUBSTANTIAL_TRANSFORMATION" | "TARIFF_SHIFT" | "REGIONAL_VALUE_CONTENT" | "SPECIFIC_PROCESS", confidence, gaps: string[] }`.
* **Task A-3**: Seed `TradeAgreement` rules from a static data file (`prisma/seed-data/trade-agreements.json`): USMCA tariff shift rules by HTS chapter, CAFTA-DR rules, GSP rules. These are legally defined; no AI guessing. Data task: create the JSON file from CFR text.
* **Task A-4**: `POST /api/advisory/origin-determination`: accepts `{ lineItemId }`, calls `originEngine` with product facts from `ProductCountryFact` and `ProductComposition`, writes `OriginDetermination` row. Returns structured result — never a template string.
* **Task A-5**: Origin determination UI: in shipment line item detail, show origin determination result with basis explanation. Confidence below 80% creates `ExceptionItem` for specialist review.
* **Task A-6**: `POST /api/advisory/origin-determination/[lineItemId]`: re-run determination after product facts are updated. Triggers via Inngest when `productCountryFact.updated` event fires.
* **Task A-7**: Vitest: substantial transformation test passes for chapter-change; fails for same chapter; RVC calculation at boundary values.

## Capability B — Trade Agreement Qualification

* **Task B-1**: `POST /api/v1/trade-agreements/qualify`: `{ lineItemId, agreementId }`. Runs qualification test using `originEngine`. Returns `{ qualified: boolean, gaps: { requirement, missing }[] }`.
* **Task B-2**: Missing evidence identification: for each gap, identify what data would close it (e.g. "RVC cannot be computed — material costs not entered", "Tariff shift check failed — HTS of input material unknown"). Each gap links to the product attribute or composition record that would supply the missing data.
* **Task B-3**: UI: trade agreement qualification tab in shipment line item detail. Shows: agreement name, result (qualified/not qualified/unknown), required evidence list with green/red status per item.
* **Task B-4**: USMCA CO support: if qualified under USMCA, the "Generate USMCA Certification of Origin" action becomes available on the shipment. Generates a pre-filled text document from product facts. This is a document template render, not AI.
* **Task B-5**: Vitest: qualification test with all evidence present → qualified; missing material cost → gap returned, not error.

## Capability C — Customs Valuation Engine

`ValuationAssistsRecord` model exists. No computation logic.

* **Task C-1**: Create `src/lib/valuation/valuationEngine.ts`. Input: `{ invoiceValue, currency, assists, royalties, commissions, freightToUSPort, insuranceToUSPort, relatedParty: boolean, discounts }`. Output: `{ transactionValue, customsValue, assists_total, additions, deductions, basis: "TRANSACTION" | "IDENTICAL_GOODS" | "SIMILAR_GOODS" | "DEDUCTIVE" | "COMPUTED" }`. All arithmetic via Decimal.js.
* **Task C-2**: Assist categories (19 CFR 152.103): materials, tools, engineering, molds supplied free or at reduced cost. Each assist has `unitCost`, `quantity`, `prorationMethod`. Calculate assist value to apportion across units.
* **Task C-3**: Related-party test: if `relatedParty: true`, flag for additional scrutiny. Create `ExceptionItem` with `category: "VALUATION"` and a note explaining the related-party indicator. The broker must document the arm's-length test.
* **Task C-4**: `POST /api/products/[id]/valuation`: store valuation inputs per shipment line item. `ValuationAssistsRecord` model already has these fields — map them.
* **Task C-5**: Valuation UI in shipment line item detail: "Valuation" tab. Show each component: transaction price, assists, royalties, commissions, freight, insurance. Total customs value. Highlight related-party flag if present.
* **Task C-6**: Vitest: customs value with assists is invoice + assists; royalties threshold; freight excluded when FOB.

## Capability D — Duty-Stack Calculation

`HtsDutyRate`, `HtsDutyRateHistory` models exist. `dutyEngine.ts` uses floats.

* **Task D-1**: Refactor `src/lib/tariff/dutyEngine.ts` (continuing F01-C-2): ensure duty stack returns separate layers:
  ```typescript
  interface DutyStack {
    htsReleaseId: string           // which HTS dataset was used
    base: Decimal                  // column 1 or 2 or free
    section301: Decimal            // List 1/2/3/4A/4B from Federal Register
    section232: Decimal            // steel/aluminum
    antidumping: Decimal           // AD order rate
    countervailing: Decimal        // CVD order rate
    other: Decimal                 // GSP, preference, etc.
    total: Decimal                 // sum of above
    mpf: Decimal                   // statutory formula
    hmf: Decimal                   // statutory formula
    totalWithFees: Decimal         // total + mpf + hmf
  }
  ```
* **Task D-2**: Section 301 rates: seed from Federal Register annexes (Lists 1-4B). Store in `HtsDutyRate` with `rateType: "SECTION_301"`, `trancheId` (List1/2/3/4A/4B). Add `exclusion: boolean` for granted exclusions.
* **Task D-3**: AD/CVD rates: `HtsDutyRate` with `rateType: "ANTIDUMPING" | "COUNTERVAILING"`, `caseNumber` (e.g. A-570-601), `manufacturer` (company-specific rates). Seed with active orders from USITC/Commerce. Rate lookup: match by HTS code + country of origin + manufacturer (most specific match wins).
* **Task D-4**: `GET /api/v1/hts/codes/[code]/rates?countryOfOrigin=CN&manufacturer=...` — returns full duty stack for a given product scenario. Records `htsReleaseId` in response.
* **Task D-5**: Duty calculation stored per line item: `ShipmentLineItem.dutyStack Json?` (the `DutyStack` object). Written when line item is classified and valued. Recalculated when classification or valuation changes.
* **Task D-6**: Vitest: Section 301 List 3 rate applies to CN origin; AD/CVD rate matches manufacturer-specific rate over country rate; MPF clamped to statutory min/max.

## Capability E — AD/CVD Scope Screening

No implementation today.

* **Task E-1**: Create `AdcvdOrder` model: `{ caseNumber, title, petitioner, respondentCountries, htsCodesInScope[], scopeLanguage, effectiveDate, suspensionAgreement, status: "ACTIVE" | "REVOKED" }`. Seed with major active AD/CVD orders (top 50 by import value from USITC data).
* **Task E-2**: Create `src/lib/adcvd/scopeScreening.ts`: `screenForAdcvd({ htsCode, countryOfOrigin, productDescription, physicalCharacteristics }) → { orders: AdcvdScopeResult[] }`. Each result: `{ caseNumber, title, inScope: "YES" | "POSSIBLY" | "NO", confidence, scopeLanguageMatch }`. "POSSIBLY" means product characteristics match the scope broadly but a scope ruling would be needed to confirm.
* **Task E-3**: AI scope analysis: for "POSSIBLY" results, pass scope language + product description to Claude API for a structured scope analysis (GRI-style step-by-step reasoning against the written scope). Output is a `ScopeAnalysis` with reasoning and recommendation.
* **Task E-4**: Integrate into shipment line item processing: after classification, screen for AD/CVD. Create `ExceptionItem` with `category: "COMPLIANCE"` for any "YES" or "POSSIBLY" results requiring specialist review.
* **Task E-5**: AD/CVD UI: in line item detail, "AD/CVD Screening" section shows active orders, scope determination, and any exceptions created.
* **Task E-6**: `POST /api/products/[id]/adcvd-screen`: manual re-screen trigger. Also runs on classification change.
* **Task E-7**: Vitest: scope screening returns "NO" for HTS codes not in any order; returns "YES" for exact HTS + country match; "POSSIBLY" for HTS match without country.

## Data gaps
- **Trade agreement rules**: USMCA tariff shift rules from Annex 4-B of the USMCA agreement are publicly available but must be structured as machine-readable rules. This is a substantial data-entry task (~2,000 rules). For v1, prioritize the top 50 HTS chapters by import volume.
- **AD/CVD orders**: Commerce ITAD publishes scope orders. Need to parse and seed `AdcvdOrder` rows. Initially seed manually for the most common orders.
- **Section 301 rates**: Federal Register annexes are public. Need to parse and seed by List and HTS code. The cron `hts-refresh` should include this.
- **Actual AD/CVD rates**: Company-specific rates from annual reviews are complex. V1 can use country-wide rates; company-specific rates are an enhancement.
