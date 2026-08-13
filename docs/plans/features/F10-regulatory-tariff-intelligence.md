# F10 · Regulatory & Tariff Intelligence
> Depends on: F01 (data model fixes), F05 (HTS data), F06 (duty stack)
> Branch: `feat/regulatory-tariff-intelligence`
> Features covered: #28 Regulatory monitoring, #29 Product-level policy impact, #30 Tariff scenario modeling, #31 Landed-cost simulation

---

## Capability A — Regulatory Monitoring

`RegulatoryUpdate` model exists. No Federal Register ingestion. Manual entry only.

* **Task A-1**: Federal Register API ingest: `POST /api/cron/regulatory-ingest` (new Inngest function, runs daily). Fetches CBP notices from the Federal Register API (`https://www.federalregister.gov/api/v1/documents?agencies[]=customs-border-protection&per_page=20&order=newest`). For each notice, creates a `RegulatoryUpdate` row if `documentNumber` not already present.
* **Task A-2**: Parse regulatory updates for actionable content: after creating a `RegulatoryUpdate`, pass the document summary to Claude API for structured extraction: `{ type: "TARIFF_RATE_CHANGE" | "HTS_REVISION" | "AD_CVD_ORDER" | "EXCLUSION_GRANTED" | "QUOTA" | "POLICY", affectedHtsCodes: string[], effectiveDate: string, summary: string, actionRequired: boolean }`. Store extracted metadata in `RegulatoryUpdate.metadata Json`.
* **Task A-3**: Alert creation: for each regulatory update with `actionRequired: true`, create `Notification` rows for all account members with `regulatory.review` permission.
* **Task A-4**: Regulatory updates page (`src/app/app/regulatory/page.tsx`): show updates as a feed sorted by effective date. Filter: type, affected HTS codes, action required. Each update shows: source, effective date, summary, impact assessment (from A-2), link to impact analysis.
* **Task A-5**: HTS schedule monitoring: `POST /api/cron/hts-refresh` (already exists) — wire to the USITC HTS API. When rates change, write `HtsChange` rows (model exists) and create `RegulatoryUpdate` of type `TARIFF_RATE_CHANGE`.
* **Task A-6**: Vitest: Federal Register API response parses correctly into `RegulatoryUpdate`; actionRequired = true creates notifications; duplicate document number is idempotent.

## Capability B — Product-Level Policy Impact

`RegulatoryUpdateImpact` model exists. `regulatory/[id]/impacted` route exists (partial).

* **Task B-1**: Impact analysis engine in `src/lib/regulatory/impactAnalysis.ts`: given a `RegulatoryUpdate` with `affectedHtsCodes[]`, find:
  - All `CanonicalProduct` / `Product` rows with a `ProductClassification` matching any affected HTS code
  - All `ShipmentLineItem` rows in the account with those HTS codes (open shipments)
  - All `DrawbackLot` rows affected (duty rate changes affect recovery amount)
  - Estimated duty exposure delta: for open shipments, `sum(customsValue * newRate - customsValue * oldRate)` with Decimal
* **Task B-2**: `POST /api/regulatory/[id]/impact-analysis`: trigger impact analysis. Runs via Inngest (potentially slow for large accounts). Returns `{ status: "COMPUTING" | "COMPLETE", impactSummary: { productsAffected, shipmentsAffected, estimatedDutyDelta } }`.
* **Task B-3**: `GET /api/regulatory/[id]/impacted`: return full impact with product list, shipment list, and duty delta per item. Paginated.
* **Task B-4**: Impact UI: in regulatory update detail, "Impact Analysis" tab shows: affected products (with current HTS and duty rate), affected open shipments (with exposure), affected drawback lots.
* **Task B-5**: When a rate change impacts an in-progress shipment, create `ExceptionItem` with `category: "COMPLIANCE"` and message: "Regulatory change [title] affects this shipment's HTS [code]. Review required before filing."
* **Task B-6**: Vitest: impact analysis correctly identifies products by HTS match; duty delta calculation is Decimal; no impact for HTS codes not in regulatory update.

## Capability C — Tariff Scenario Modeling

`LandedCostScenario`, `LandedCostScenarioLineItem` models exist. `simulator` routes exist. Float math; no versioned rates.

* **Task C-1**: Refactor scenario data model: each `LandedCostScenario` has a `htsReleaseId` capturing which tariff schedule was used. `LandedCostScenarioLineItem` has `dutyStack Json` (the full `DutyStack` structure from F06-D).
* **Task C-2**: Scenario dimensions: a scenario models one set of choices for a product: `{ htsCode, countryOfOrigin, manufacturer, tradeAgreementClaim }`. Multiple scenarios on the same product allow comparison.
* **Task C-3**: `POST /api/simulator/scenarios`: create scenario. `POST /api/simulator/scenarios/[id]/line-items`: add a line item with scenario dimensions. `POST /api/simulator/scenarios/[id]/calculate`: compute full duty stack for each line item using `dutyEngine.ts` (Decimal, real HTS rates). No inline static multipliers.
* **Task C-4**: `POST /api/simulator/compare`: compare up to 5 scenarios side by side. Returns `{ scenarios: [{ id, totalDuty, totalMpf, totalHmf, totalLandedCost }] }` for each scenario plus a savings delta matrix.
* **Task C-5**: Scenario modeling UI (`src/app/app/shipments/new/page.tsx` or a dedicated `/app/simulator` page): create scenarios by selecting HTS code alternatives, origin countries, trade agreement claims. Show duty breakdown per scenario. Highlight lowest-cost scenario.
* **Task C-6**: Rate snapshot label: every calculated scenario shows "Calculated using HTS Release [date]" so the user knows when to recalculate after rate changes.
* **Task C-7**: Save scenario to shipment: when a scenario is approved as the filing basis, link it to the shipment via `Shipment.scenarioId`. The filing pulls from this scenario's calculated values.
* **Task C-8**: Vitest: scenario with USMCA claim has zero Section 301 rate for qualifying goods; scenario without claim has full rate; compare returns delta.

## Capability D — Landed-Cost Simulation

* **Task D-1**: Landed cost components in `src/lib/tariff/landedCost.ts`:
  ```typescript
  interface LandedCostBreakdown {
    productCost: Decimal       // FOB value
    freightToUSPort: Decimal
    insuranceToUSPort: Decimal
    customsValue: Decimal      // = productCost + assists + royalties + ...
    baseDuty: Decimal
    section301: Decimal
    section232: Decimal
    adcvd: Decimal
    mpf: Decimal
    hmf: Decimal
    stateFees: Decimal?        // optional: harbor maintenance, state inspection
    inland: Decimal?           // post-port delivery
    total: Decimal             // sum of all
    perUnit: Decimal           // total / quantity
  }
  ```
* **Task D-2**: `POST /api/simulator/scenarios/[id]/calculate` calls `computeLandedCost()` using the above structure. All Decimal.
* **Task D-3**: Landed cost UI: waterfall chart showing each cost component as a bar. User can edit freight, insurance, inland values and see total update in real time (client-side Decimal calculation using same formulas).
* **Task D-4**: "Alternative sourcing" comparison: given 2 scenarios (e.g. China vs. Vietnam origin), show landed cost comparison table. Include breakeven analysis: "Vietnam scenario is more expensive at this quantity; below [X] units per year, China is cheaper despite Section 301."
* **Task D-5**: Vitest: landed cost with all components; per-unit calculation at varying quantities; incoterm FOB excludes freight in customs value.

## Data gaps
- **Federal Register API**: Public API, no key required. Rate-limited to 1,000 req/day. Document this in the cron implementation.
- **HTS rates source**: USITC publishes HTS schedule. `prisma/import-hts.ts` already has an import script. The cron must call a reliable endpoint. Verify the current URL in the script is still valid.
- **Section 301 rates in HTS database**: Section 301 additional duties are published as Federal Register annexes, not in the base HTS schedule. Need a separate ingestion pipeline for these.
- **AD/CVD orders and rates**: Commerce publishes final determination notices. Annual review rates require parsing USITC/Commerce PDFs — complex data ingestion.
