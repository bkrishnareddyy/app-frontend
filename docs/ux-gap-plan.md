# Broker Workflow UX Gap Plan

Plan of record for closing the eight UX gaps. Each section states what the code
does **today** (verified, with file references), what the gap actually is, and
the work items. Phases are ordered by dependency, not by ambition.

---

## Phase 0 — Fix the foundation before building on it

Two defects make several of the gaps unfixable-as-stated, and one of them means
the Actions page is currently hiding the work it exists to show.

### 0.1 — P0: status vocabulary drift hides every actionable decision

Agents write `AgentDecision.status = "Needs Review"`:

- `src/modules/agents/htsClassificationAgent.ts:180,383`
- `src/modules/agents/originRulesAgent.ts:88`
- `src/modules/agents/complianceAuditAgent.ts:180`
- `src/modules/agents/valuationAssistsAgent.ts:76`
- `src/modules/agents/customsFilingAgent.ts:93`
- `src/modules/agents/productIntelligenceAgent.ts:149`
- `src/modules/agents/filingReadinessAgent.ts:173`

The queue filters on a different vocabulary:

```ts
// src/modules/work/workQueue.ts:81
const DECISION_ACTIONABLE = { "Review Required": "high", Attention: "critical", Pending: "normal" };
```

`src/app/app/actions/page.tsx:51` queries
`status: { in: [...DECISION_ACTIONABLE_STATUSES, "Approved"] }` — so **every
decision an agent flagged for a human is excluded from /actions**. What renders
today is the auto-approved ones plus the rare `"Review Required"` writer.

Four independent readers each guess at the vocabulary differently:
`ActionsClient.categorize` (:509), `DocumentReviewPanel.classifyDecision` (:55),
the inline block in `src/app/app/dashboard/page.tsx:143-160`, and
`reviewCategory` in `editableFields.ts`.

**Work items**

1. Add `src/modules/decisions/decisionState.ts`: a closed `DecisionState` union
   (`AUTO_VERIFIED | NEEDS_REVIEW | BLOCKED | APPROVED | REJECTED | IN_PROGRESS`),
   a `normalizeDecisionStatus(raw): DecisionState | null` that maps every legacy
   string, and `ACTIONABLE_STATES`. Model it on the existing
   `src/modules/exceptions/exceptionState.ts`, which already does this correctly
   for exceptions.
2. Point `workQueue.ts` and `actions/page.tsx` at the normalizer instead of
   string literals.
3. Backfill migration: normalize existing `AgentDecision.status` values.
4. Test: assert every literal written by an agent normalizes to a non-null state.
   This is the test that stops the drift recurring.

### 0.2 — P0: silent auto-approve

`htsClassificationAgent.ts:383` writes `status: confidence < 70 ? "Needs Review" : "Approved"`.
Same pattern in `originRulesAgent.ts:174`, `valuationAssistsAgent.ts:168`,
`normalizationAgent.ts:596`, `filingReadinessAgent.ts:173`,
`responseManagementAgent.ts:83`.

So confidence *already* routes work — but the threshold is a hardcoded magic
number per agent, the row is indistinguishable from a human approval
(`reviewedByUserId` is null, no `AuditLog`, no reviewer identity), and nothing in
the UI says a machine did it. This is the exact inverse of Gap 2's ask, and it is
the single worst thing on the "second reader" test (Gap 8): an auditor cannot
tell an approved entry from an unreviewed one.

**Work items**

1. `AgentDecision`: add `autoApproved Boolean @default(false)` and
   `autoApprovalPolicy String?` (policy id + version that made the call).
2. Replace per-agent literals with one `src/modules/decisions/autoApprovalPolicy.ts`:
   pure function `(confidence, partMasterMatch, agentName) -> "AUTO" | "CONFIRM" | "REVIEW"`.
   Thresholds live in one place, are account-configurable later, and are testable.
3. Write an `AuditLog` row for every auto-approval with the policy id — this is
   the CF28 answer.
4. Never let auto-approve set `status: "Approved"`. It sets `AUTO_VERIFIED`.
   "Approved" means a human approved it.

---

## Phase 1 — Server-computed domain state (Gap 6) and confidence routing (Gap 2)

### 1.1 — Store the triage state (Gap 6)

Blocked / Needs Review / Verified is currently a client-side regex over agent
prose (`ActionsClient.tsx:509-549` matches on `summary.includes("BLOCKED")`,
`"Gating:"`, `"Skipped"`, `"Paused"`). It drifts the moment an agent's wording
changes, and it is computed four times with three different answers.

**Work items**

1. `AgentDecision.triageState` column (the `DecisionState` from 0.1), written by
   the agent at creation time from structured facts it already has — not parsed
   back out of its own summary string.
2. The blocked sentinels (`BLOCKED_DEPENDENCY`, `WAITING_FOR_EXTRACTION`,
   `BLOCKED_MISSING_DESCRIPTION`) are already written to `proposedDescription`
   and are grounded — promote them to a real `blockedReason` column rather than
   a string in a description field.
3. Delete all four client-side categorizers; every reader reads the column.
4. Index `(accountId, triageState)` — this becomes the queue's hot path.

### 1.2 — Confidence routes work (Gap 2)

`src/modules/decisions/decisionQuery.ts:43-52` already defines the bands
(high ≥85, medium 60-84, low <60, unscored) with the right instinct — unscored is
its own band. It is used by **nothing but its test**.

Part-master matching has a home already: `CanonicalProduct.partNumber` /
`ProductAlias` (`prisma/schema.prisma:1353`) and
`src/modules/product/productMasterService.ts`. `ShipmentLineItem.partNumber` is
the join key.

**Work items**

1. `src/modules/product/partMasterMatch.ts` (pure): given a line item and the
   account's canonical products, return `{ matched, canonicalProductId, htsCode,
   basis: "PART_NUMBER" | "ALIAS" | "NONE" }`. Exact part number only at first —
   fuzzy matching here is how you silently misclassify.
2. Wire into `autoApprovalPolicy` from 0.2:
   - high confidence **and** part-master HTS agrees → `AUTO`
   - medium, or high without a part-master match → `CONFIRM` (single click)
   - low / unscored / part-master disagrees → `REVIEW` (full two-pane)
   A part-master *disagreement* is a stronger signal than low confidence and must
   never auto-approve.
3. UI: the `AUTO` bucket renders as one row — "42 verified by part master" —
   with a disclosure that expands to the per-line audit trail. Never as 42 cards.
4. Never hide the confidence number or the policy that fired. The disclosure is
   the product.

### 1.3 — Structured reasons (Gap 7)

`resolutionReason` is free text today (`src/app/api/exceptions/[id]/route.ts:21`,
stored to `ExceptionItem.resolutionNote` via
`src/modules/exceptions/exception.service.ts:153`). Required only for waive,
which is right (`requiresResolutionReason`).

**Work items**

1. `src/modules/exceptions/resolutionReasons.ts`: a versioned picklist keyed by
   exception `category` (`MISSING_DATA | CONFLICT | VALIDATION | COMPLIANCE |
   DOCUMENT | CLASSIFICATION | VALUATION | FILING` — the column already exists).
2. `ExceptionItem.resolutionReasonCode String?` alongside the free-text note.
   Both, not either: the code is analytics, the text is the story.
3. Server-side validation that the code is legal for that category, and that a
   waive carries both a code and non-empty text.
4. Same treatment for decision `REJECT` — `humanNotes` is already mandatory
   (`src/app/api/decisions/route.ts:265`), it just needs a code beside it.

---

## Phase 2 — The queue is the homepage (Gap 1) and one inbox (Gap 5)

### 2.1 — Ranking

`buildWorkQueue` is 336 lines, covered by `tests/work-queue.test.ts`, and only its
*constants* are imported anywhere. `buildShipmentActionGroups`
(`src/modules/actions/shipmentActions.ts:280`) does the real ranking today and
sorts by `severity → age`. Neither deadline nor dollars appears anywhere.

Available inputs: `Shipment.estimatedArrival`, `ShipmentLineItem.totalValue`,
`ExceptionItem.blocking` (a real column, currently unread by the queue).
There is no filing-deadline column and no duty-amount column.

**Work items**

1. `Shipment.filingDeadline DateTime?` — derived at ingest from
   `estimatedArrival` + entry-type rules, stored, overridable. Do not compute a
   deadline in the render path.
2. Value at risk: sum of `ShipmentLineItem.totalValue` for the shipment.
   Estimated duty needs a rate join and can wait; declared value is a defensible
   v1 proxy and should be labelled as declared value, not duty.
3. Rewrite the sort in `workQueue.ts` as an explicit, tested scoring function:
   `hoursToDeadline` (dominant, non-linear as it approaches zero) × `valueAtRisk`
   (log-scaled) × `blocking` (a multiplier, not a tiebreak). Severity becomes an
   input, not the sort key. Keep `assignedToMe` as a filter, not a rank boost —
   ranking someone else's critical below your normal is how work gets missed.
4. The score must be explainable in the row: "Files in 6h · $412k · blocks entry".
   A rank a broker cannot explain to their manager is a rank they will not trust.

### 2.2 — `/app` is the queue

There is no `src/app/app/page.tsx`; `src/app/page.tsx:14` redirects
authenticated users to `/app/dashboard`.

**Work items**

1. Create `src/app/app/page.tsx` rendering the queue, backed by `buildWorkQueue`.
2. Change the post-auth redirect to `/app`; nav item `dashboard` in
   `src/lib/navigation.ts:51` points at `/app`, keeping Command Center as a
   secondary entry.
3. Query-level filtering and pagination — `parseWorkFilter` / `paginateWorkQueue`
   already exist and `truncatedSources` already handles the honest-count problem.
   Use them; do not fetch-all-and-filter-in-React the way `ActionsClient` does.

### 2.3 — Consolidate to `/actions`

`src/lib/navigation.ts` already lists only `/app/actions`. `/app/decisions` and
`/app/exceptions` are unlinked orphans still reachable by URL, and `workQueue.ts`
itself deep-links to both (`:140`, `:210`).

**Work items**

1. `/app/decisions` and `/app/exceptions` → permanent redirect to
   `/app/actions?...`, preserving `decisionId` / `exceptionId` / `shipmentId`.
2. Update the two `workQueue.ts` hrefs and any component deep links.
3. Keep the verbs distinct on the item, not the route: Approve/Reject for
   decisions, Resolve/Waive for exceptions, waive still gated on
   `RISK_ACCEPTANCE_PERMISSION` with a mandatory reason (already correct in
   `exception.service.ts:107` — preserve it).
4. Delete `DecisionReviewClient.tsx` and `exceptions/page.tsx` once the redirect
   is in and nothing links to them. Three inboxes is a maintenance tax as much as
   a UX one — note that `DecisionReviewClient` is currently the *only* surface
   that reads the `"Needs Review"` status correctly (`:82`).

---

## Phase 3 — Two-pane provenance (Gap 3) and bulk (Gap 4)

### 3.1 — Click-to-provenance

The data model is further along than the UI. `ExtractionField` carries
`pageNumber` and `bbox` (`prisma/schema.prisma:1325`); the docling parse layer
carries page + bbox provenance through `contracts.ts` and `chunking.ts`;
`src/modules/documents/extractionReview.ts` already implements
`buildReviewFields`, `pagesWithFields`, and `nextReviewIndex`, with tests.

Two things block the interaction:

- **The viewer.** `DocumentReviewPanel.tsx:1144` renders the PDF in an
  `<iframe src={proxyUrl}#view=FitH>`. A browser-native PDF viewer cannot host an
  overlay, so no highlight is possible without replacing it.
- **Persistence — this is the actual blocker.** The only writer of
  `ExtractionField` in the codebase is the *manual human correction* route
  (`src/app/api/documents/[id]/extractions/fields/route.ts:81`). The AI pipeline
  writes its results to `ShipmentDocument.extractedJson`, an unstructured `Text`
  blob (`documentProcessingWorker.ts:644`). So the page/bbox provenance that
  docling produces is carried through the parse layer and then discarded. Today
  there is nothing to highlight against except fields a human already typed.

**Work items**

1. **Persist located fields.** Have the extraction pipeline write
   `ExtractionField` rows (fieldName, value, confidence, pageNumber, bbox,
   `source`) alongside `extractedJson`. `extractionReview.ts` already models the
   machine-read vs. human-correction precedence correctly and is tested — it just
   has no machine reads to work with. This is the whole feature; everything below
   is downstream of it.
2. Replace the iframe with `pdf.js` canvas rendering + an absolutely-positioned
   highlight layer. Scale bbox by the render viewport; do not assume 1:1 points.
3. Two-pane layout in `DocumentReviewPanel`: document left, proposals right.
   Clicking a proposal scrolls to its page and flashes the bbox; clicking a
   highlight selects the proposal. `nextReviewIndex` already gives you
   keyboard `n`/`p` traversal for free.
4. Degrade honestly: a field with no bbox shows "location not recorded" rather
   than a highlight over nothing. A confident-looking box in the wrong place is
   worse than no box.

### 3.2 — Bulk is a verb

Every mutation is single-id today: `POST /api/decisions` takes one `decisionId`
(`route.ts:216`), `PATCH /api/exceptions/[id]` takes one id. The client loops or
the user clicks.

**Work items**

1. `POST /api/decisions/bulk`: `{ decisionIds[], action, humanNotes,
   reasonCode }`. Per-decision permission check (an override inside a bulk is
   still an override — `isClassificationOverride` must run per row), per-decision
   `AuditLog` row, per-decision `Fact`. Partial success is a real outcome:
   return `{ succeeded[], failed[{id, reason}] }` and render both.
2. Same for exceptions, preserving the per-row `expectedVersion` optimistic
   concurrency check that `exception.service.ts` already enforces — a bulk that
   silently overwrites a colleague's edit is worse than no bulk.
3. UI: selection state in `ActionsClient`, a "select all matching part master"
   affordance driven by the Phase 1.2 match result, and a confirmation that
   states the count and the action in words before it fires.
4. The audit trail stays per-line. The gesture is bulk; the record is not.

---

## Phase 4 — Second reader (Gap 8) and metrics

### 4.1 — Screenshot test

Every action surface should answer, on its face: who decided, when, on what
evidence, under what authority. `decisionProvenance` in `reviewAuthority.ts`
already captures reviewer identity and broker license — it is computed and
returned by the API but not rendered on the cards in `ActionsClient`.

**Work items**

1. Render provenance on every card: reviewer name, license number, timestamp,
   and for auto-verified rows the policy id and confidence.
2. Distinguish "approved by Sarah Chen (License 12345), 2026-08-11 14:32" from
   "auto-verified by policy hts-v3, 94% confidence, part master match" — visually
   and unmistakably.

### 4.2 — Instrument the metrics

None of the five metrics are computed today.

**Work items**

1. `src/modules/work/metrics.ts` (pure, tested) + a `WorkMetricSnapshot` table.
2. **Touch rate** — the north star. Needs a denominator of line items presented
   and a numerator of line items a human modified. `FieldApproval` and
   `ShipmentChangeEvent` give you the numerator; the denominator has to be
   recorded when the queue presents the work, not reconstructed later.
3. Doc received → filing-ready median: `ShipmentDocument.createdAt` →
   the `CustomsFiling` status transition. Both timestamps exist.
4. First-pass acceptance on export, deadline margin (needs 2.1's
   `filingDeadline`), and duty saved per entry — the last one needs the duty
   calculation deferred in 2.1, so it lands with that work, not before.

---

## Sequencing

| Phase | Depends on | Ships |
|---|---|---|
| 0 | — | Actions page actually shows actionable work; auto-approve is visible and audited |
| 1 | 0 | Stored triage state, confidence routing, structured reasons |
| 2 | 1 | `/app` is the queue, one inbox, deadline × dollars ranking |
| 3 | 1 (2 for the surface) | Click-to-provenance, bulk approve |
| 4 | 2, 3 | Provenance on every card, touch rate |

Phase 0 is not optional groundwork — until 0.1 lands, `/actions` is showing the
wrong set of rows, and any measurement taken before it is measuring a bug.

## Anti-patterns to hold to

- Chat is not the primary surface. Lists and forms.
- Confidence and the policy that acted on it are always visible.
- Integrate with CargoWise; do not rebuild it.
- Every heuristic that survives Phase 1 must be a stored column with a test, not
  a regex over prose in a React component.
