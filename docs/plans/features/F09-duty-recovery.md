# F09 · Duty Recovery & Drawback
> Depends on: F01 (Decimal arithmetic), F06 (duty-stack calculation for opportunity sizing)
> Branch: `feat/duty-recovery`
> Features covered: #43 Duty-opportunity detection, #44 Drawback matching, #45 Section 301 refund readiness, #46 PSC eligibility workflow, #47 Reconciliation management

---

## Capability A — Duty Opportunity Detection

Currently uses `totalDuties * 0.4` and `totalDuties * 0.15` heuristics. These are legally meaningless and must be removed.

* **Task A-1**: Remove ALL heuristic multipliers from `POST /api/refunds/opportunities/scan`. If a real opportunity cannot be computed, return an empty list with a message: `"Opportunity scan requires actual duty rates and entry data. Ensure all line items have approved HTS classifications and duty calculations."`. No fake numbers.
* **Task A-2**: Define opportunity categories in `src/lib/refunds/opportunityTypes.ts`:
  - `CLASSIFICATION_REVIEW`: HTS code has a lower-duty alternative that passes GRI analysis
  - `SECTION_301_EXCLUSION`: HTS + product matches a granted Section 301 exclusion
  - `TRADE_AGREEMENT`: product qualifies for a preferential rate not yet claimed
  - `FIRST_SALE`: earlier transaction in the supply chain at a lower price
  - `DUTY_DRAWBACK`: exported goods eligible for drawback
  - `AD_CVD_SCOPE_EXCLUSION`: product may be outside AD/CVD scope (scope ruling opportunity)
* **Task A-3**: `POST /api/refunds/opportunities/scan`: for each line item, check applicable opportunity types using real data:
  - `SECTION_301_EXCLUSION`: query `HtsDutyRate` where `rateType: "SECTION_301_EXCLUSION"` and product description matches exclusion text
  - `TRADE_AGREEMENT`: call origin qualification engine from F06
  - `CLASSIFICATION_REVIEW`: check if alternative HTS codes at a lower rate pass GRI (this requires AI; run asynchronously, return `status: "COMPUTING"` and notify when done)
* **Task A-4**: `RefundOpportunity` rows: `{ accountId, lineItemId, filingId, type: OpportunityType, estimatedRecovery: Decimal?, confidence, status: "IDENTIFIED" | "ANALYZING" | "CONFIRMED" | "CLAIMED" | "REJECTED", evidence: string[], deadline? }`. `estimatedRecovery` is null until confirmed — never a heuristic estimate.
* **Task A-5**: Opportunity ranking UI: `src/app/app/vault/VaultClient.tsx` — rebrand "Vault" to "Recovery". Show opportunities ranked by: confirmed recovery amount (DESC) → confidence (DESC) → deadline proximity. Show only confirmed + high-confidence items first; show analyzing items in a separate pending section.
* **Task A-6**: Vitest: Section 301 exclusion match for exact HTS + exclusion text; no match for different HTS; opportunity status transitions correctly.

## Capability B — Drawback Matching (Lot Inventory)

`DrawbackClaim`, `DrawbackMatch` models exist. No inventory lot management; float math; no over-allocation prevention.

* **Task B-1**: Create `DrawbackLot` Prisma model:
  ```
  model DrawbackLot {
    id              String   @id @default(cuid())
    accountId       String
    entryNumber     String
    lineItemId      String?
    htsCode         String
    quantity        Decimal  // imported quantity in base unit
    availableQty    Decimal  // starts equal to quantity
    reservedQty     Decimal  @default(0)
    claimedQty      Decimal  @default(0)
    unitPurchasePrice Decimal
    dutyPaidPerUnit   Decimal
    importDate      DateTime
    exportDeadline  DateTime // 5 years from import for manufacturing drawback
    createdAt       DateTime @default(now())
    @@index([accountId, htsCode])
    @@index([exportDeadline])
  }
  ```
* **Task B-2**: Lot creation: when a filing reaches `ACCEPTED` status, create `DrawbackLot` rows from line items with non-zero duty paid. Use `DutyStack.base + DutyStack.section301` (not total, per 19 CFR 191).
* **Task B-3**: Refactor `POST /api/drawback/match`: serializable transaction with `SELECT FOR UPDATE` on the `DrawbackLot`. Allocation: FIFO within HTS code. Deduct from `availableQty`. Return 422 if insufficient available quantity. All arithmetic with Decimal.js.
* **Task B-4**: Drawback types: `MANUFACTURING` (99% of duties on materials incorporated into exported product) and `UNUSED_MERCHANDISE` (99% of duties on goods exported in same condition as imported). Type determines eligible duty percentage (statutory, not configurable).
* **Task B-5**: CBP claim number format: `{filer_code}-{year}-{sequence}`. Filer code from the account's `ImporterOfRecord.cbpNumber` prefix. Sequence from a `DrawbackClaimSequence` model (like `ShipmentSequence`). Not random.
* **Task B-6**: `POST /api/drawback/claims`: creates the formal claim from matched lots. Status: `DRAFT → PREPARED → SUBMITTED → ACCEPTED → REJECTED`. Only broker (with `drawback.claim` permission) can submit.
* **Task B-7**: Drawback UI: dedicated section in Recovery page. Show: eligible lots (available qty, duty paid, deadline), matched pairs, claim status. "Create claim" action runs lot matching + creates draft claim for review.
* **Task B-8**: Vitest: FIFO allocation; over-allocation returns 422; manufacturing drawback is 99% of duty not 100%; concurrent allocation — exactly one wins.

## Capability C — Section 301 Refund Readiness

No implementation. This is about maintaining the affected entry population so potential Section 301 refund actions can be launched quickly if exclusions are granted.

* **Task C-1**: Tag `FilingSnapshot` and `DrawbackLot` rows: `hasSection301 Boolean @default(false)`, `section301List String?` (List1/2/3/4A/4B). Written when duty stack is computed and `section301 > 0`.
* **Task C-2**: `GET /api/refunds/section301`: return `{ totalEntries, totalDutyPaid, byList: { list, entries, dutyPaid }[] }`. This is the "readiness inventory" — the broker can see how much duty is potentially recoverable by list.
* **Task C-3**: When a Section 301 exclusion is granted (updates to `HtsDutyRate` from the Federal Register cron), automatically find affected entries and create `RefundOpportunity` rows with `type: "SECTION_301_EXCLUSION"` for each.
* **Task C-4**: UI: Section 301 panel in Recovery page. Shows: total duty paid under each list, count of entries. If any exclusion applies, shows the opportunity with estimated recovery.

## Capability D — PSC Eligibility Workflow

`PostSummaryCorrection` model exists. Route uses `origDuty * 0.7` heuristic — remove it.

* **Task D-1**: Remove the `origDuty * 0.7` calculation from `POST /api/refunds/psc`. If actual duty paid is not available, return 422: "PSC calculation requires actual duty paid from accepted filing data."
* **Task D-2**: PSC eligibility check in `src/lib/refunds/pscEligibility.ts`:
  - Entry must be in `ACCEPTED` or `LIQUIDATED` status
  - PSC must be filed before liquidation (check `ComplianceDeadline` for PSC window, if known)
  - Correction must be material (duty impact > $0)
  - PSC cannot be filed for entries in a `DrawbackClaim`
* **Task D-3**: PSC types: `DUTY_RATE_CORRECTION` (wrong rate applied), `VALUE_CORRECTION` (declared value error), `CLASSIFICATION_CORRECTION` (wrong HTS), `QUANTITY_CORRECTION`. Each type has specific ACE procedures.
* **Task D-4**: PSC impact: compare `FilingSnapshot` (original) vs. corrected values. Compute duty delta using `dutyEngine`. Show `{ originalDuty, correctedDuty, delta, refundable: delta > 0, additionalDutyOwed: delta < 0 }`.
* **Task D-5**: PSC workflow UI: in filing detail, "Post-Summary Correction" tab. Shows PSC eligibility check results, correction type selection, value entry, impact calculation. Produces a PSC preparation package (not an ACE submission — that still goes through broker's filing system).
* **Task D-6**: Deadline tracking: PSC window is tied to liquidation. `ComplianceDeadline` row with `deadlineType: "PSC_WINDOW"` — create when filing is accepted. When liquidation date becomes known, update the deadline.
* **Task D-7**: Vitest: PSC eligible for accepted filing with wrong rate; ineligible for entry with active drawback claim; impact calculation with Decimal arithmetic.

## Capability E — Reconciliation Management (Entry-Level)

`ReconciliationIssue` model is used for cross-document issues (F03). This capability covers entry-level reconciliation issues distinct from PSCs.

* **Task E-1**: Distinguish reconciliation types: `ReconciliationIssue.issueType: "DOCUMENT_CONFLICT" | "ENTRY_DISCREPANCY" | "PSC_CANDIDATE"`. `DOCUMENT_CONFLICT` is from F03's cross-document engine. `ENTRY_DISCREPANCY` is discovered after filing (e.g. post-entry audit finds a value discrepancy). `PSC_CANDIDATE` is an issue that may warrant a PSC.
* **Task E-2**: For `PSC_CANDIDATE` issues: show a "Convert to PSC" action that pre-fills the PSC workflow from the issue details.
* **Task E-3**: Reconciliation issue deadline tracking: CBP liquidation deadlines affect when discrepancies can still be corrected. Show time remaining to correct each issue.
* **Task E-4**: Reconciliation management page: group by issue type, show financial exposure (estimated duty delta), sortable by deadline proximity and exposure.

## Data gaps
- **Section 301 exclusion texts**: The Federal Register exclusion language must be machine-parsed and matched against product descriptions. This requires NLP matching (AI) or a structured database of exclusion HTS codes + product descriptions.
- **PSC deadline (liquidation date)**: CBP liquidation dates are not available without an ACE/ABI connection. Until real data is available, PSC deadlines will show as "unknown" rather than a computed date.
- **Drawback export matching**: Manufacturing drawback requires export data (export shipments). The `ExportShipment` and `ExportDocument` models exist in the schema — need an export document intake flow.
