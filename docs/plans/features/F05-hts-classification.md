# F05 · HTS Classification Engine
> Depends on: F01 (auto-approval policy), F02 (product evidence links)
> Branch: `feat/hts-classification`
> Features covered: #17 Evidence-backed HTS proposals, #18 GRI reasoning workspace, #19 CROSS ruling retrieval, #20 Bulk catalog classification, #21 Classification version history, #22 Classification change impact

---

## Capability A — Classification Case Workflow

The `ClassificationCase`, `ClassificationProposal`, `ProposalEvidence`, `GriAnalysisStep`, `ClassificationRun`, `ClassificationDecision` models all exist in the schema. Wire them into the full workflow.

* **Task A-1**: `POST /api/v1/classification/cases`: create a classification case for a product or line item. Input: `{ productId?, lineItemId?, description, attributes: Record<string, string> }`. Case starts in `OPEN` status. One case per `productId` per account (update if exists, don't duplicate).
* **Task A-2**: `POST /api/v1/classification/cases/[caseId]/runs`: trigger a new AI classification run. Creates `ClassificationRun`, calls `packages/ai/hts/htsAgent.ts`. Run asynchronously via Inngest. Returns `{ runId, status: "QUEUED" }`.
* **Task A-3**: `htsAgent.ts` output must be structured: `{ proposals: [{ htsCode, description, confidence, griSteps: [{rule, applied, reasoning}], rulingCitations: [{rulingNumber, relevance}] }] }`. Write `ClassificationProposal` rows and `GriAnalysisStep` rows.
* **Task A-4**: `GET /api/v1/classification/cases/[caseId]`: return case with proposals, GRI steps, ruling citations, and current decision. Include `ClassificationDecision` if approved.
* **Task A-5**: `POST /api/v1/classification/cases/[caseId]/decisions`: human selects a proposal (or overrides with custom HTS). Writes `ClassificationDecision`, updates `ProductClassification` with new effective date, supersedes previous classification. Requires `classification.approve` permission.
* **Task A-6**: Vitest: case creation is idempotent per productId; run creates proposal + GRI step rows; decision updates ProductClassification and sets supersededById on previous.

## Capability B — GRI Reasoning Workspace (UI)

`GriAnalysisStep` has the data. No UI surface today.

* **Task B-1**: Classification case detail page: `src/app/app/products/[id]/classification/[caseId]/page.tsx`. Two-column layout: left pane = product facts (attributes, compositions, intended use, country facts); right pane = classification proposals.
* **Task B-2**: Each proposal shows: HTS code, description, duty rate, confidence score, and a "GRI Analysis" accordion. GRI accordion lists steps 1–6; each step shows: rule text, applied (yes/no), reasoning. Steps are from `GriAnalysisStep` rows — not parsed from prose.
* **Task B-3**: "View competing proposals" — compare up to 3 proposals side by side. Show GRI divergence: which step did each proposal diverge from the others.
* **Task B-4**: "Select this code" button → opens confirmation modal showing: selected code, duty rate, effective date, approver. Confirmation writes the decision.
* **Task B-5**: Override workflow: if selected code differs from AI top proposal, flag as `isOverride: true` in `ClassificationDecision`. Overrides require an override reason. Appear separately in audit trail.

## Capability C — CROSS Ruling Retrieval

`Ruling`, `RulingFragment`, `RulingHtsReference` models exist. Ruling search API exists.

* **Task C-1**: Ruling ingest pipeline: `POST /api/v1/admin/rulings/ingest` (already exists). Verify it correctly writes `Ruling`, `RulingFragment`, and `RulingHtsReference` rows. Add ruling effective date and supercession tracking.
* **Task C-2**: Ruling search via embedding similarity: `GET /api/v1/rulings/search?q={product description}&htsCode={code}`. Use Gemini text embedding to generate a query vector; compare against stored ruling fragment embeddings (add `RulingFragment.embedding Float[]` column using `pgvector` extension). Return top-5 with `similarityScore`.
  - **Data gap**: If `pgvector` is not available on current Postgres instance, fall back to full-text search (Postgres `tsvector`) until pgvector is confirmed available.
* **Task C-3**: Add `ProposalEvidence.rulingId` linkage: when the classification agent retrieves relevant rulings, write `ProposalEvidence` rows linking the ruling to the proposal.
* **Task C-4**: UI: ruling citations appear in the GRI workspace (B-2) under each proposal. Each citation shows: ruling number, importer, product description, result code, similarity score, direct link to CBP CROSS (external URL). Clicking opens ruling detail slide-over with `RulingFragment` text excerpts.
* **Task C-5**: `GET /api/v1/rulings/[rulingNumber]`: full ruling detail with fragments and HTS references.
* **Task C-6**: Vitest: embedding search returns results sorted by similarity; ruling without fragments returns empty array not error.

## Capability D — Bulk Catalog Classification

* **Task D-1**: `POST /api/v1/batch/classification` (already exists): accept `{ productIds: string[] }`. For each product, create a `ClassificationCase` if none exists and trigger a run. Cap at 100 products per request. Return `{ queued: string[], skipped: string[], errors: string[] }` where skipped = already has an approved decision.
* **Task D-2**: Routing: products with low-confidence results (`maxConfidence < 0.7`) are routed to human review (their cases get `NEEDS_REVIEW` status). Products with high-confidence results and part-master match get `AUTO_VERIFIED`. All routing via `autoApprovalPolicy.ts`.
* **Task D-3**: Bulk classification UI: `src/app/app/products/page.tsx` — add "Classify selected" action to bulk toolbar (`ProductsBulkActions.tsx`). Shows product count and estimated processing time. Polls for completion via `GET /api/v1/classification/cases?productIds[]=...&status=OPEN`.
* **Task D-4**: Batch progress page: `src/app/app/products/batch-classification/[batchId]/page.tsx`. Shows: total products, classified/pending/needs-review counts, progress bar. Links to individual cases needing review.
* **Task D-5**: Vitest: batch of 100 creates 100 cases; over 100 returns 422; already-approved products are skipped.

## Capability E — Classification Version History

* **Task E-1**: `GET /api/products/[id]/classifications`: returns `ProductClassification[]` ordered by `effectiveDate DESC`. Include: `htsCode`, `confidence`, `approvedByUserId`, `approvedAt`, `supersededById`, `reason`.
* **Task E-2**: Classification history UI in product detail tabs (`ProductTabs.tsx`): "Classification History" tab shows a timeline — each entry: HTS code, duty rate, effective date, approver name, change reason. Entries that were overrides show an override indicator.
* **Task E-3**: Classification change reason: when a human approves a classification that differs from the current one, require `{ changeReason: string }` in the decision body. Stored in `ClassificationDecision.changeReason`.
* **Task E-4**: Rollback: admin can select an older classification and set it as current. Creates a new `ClassificationDecision` pointing back to the older `ClassificationProposal`, with `isRollback: true` and a required rollback reason.

## Capability F — Classification Change Impact

* **Task F-1**: When a `ClassificationDecision` is written for a product, compute change impact: find all `ShipmentLineItem` rows in the account that reference this product (by `productId` or `partNumber`), find their parent `Shipment` rows, find their associated `CustomsFiling` rows.
* **Task F-2**: Write `ClassificationChangeImpact` rows (new model, or use `RegulatoryUpdateImpact`): `{ classificationDecisionId, shipmentId, lineItemId, filingId, previousHtsCode, newHtsCode, dutyImpact }`. `dutyImpact` is estimated using the duty engine with Decimal arithmetic.
* **Task F-3**: `GET /api/v1/classification/cases/[caseId]/impact`: return the impact list. Show count of affected shipments, entries, and estimated duty delta.
* **Task F-4**: Impact UI in classification case detail: after approving, show "This classification change affects 12 shipments and 4 pending entries. Estimated duty delta: +$14,200." with links to affected shipments.
* **Task F-5**: Affected entries that are already filed (status SUBMITTED or later) create `ComplianceFinding` rows for review — the broker may need to file a PSC.

## Data gaps
- HTSUS data must be current: `prisma/import-hts.ts` imports from local file. Need a reliable USITC data feed URL. The cron at `POST /api/cron/hts-refresh` must be wired to a real source.
- CROSS rulings database: the `v1/admin/rulings/ingest` route needs a data source. CBP CROSS API or bulk download. Without ruling data, the retrieval feature will return empty results (honest, but limited).
- pgvector extension: confirm availability on Postgres provider (Neon/Supabase both support it).
