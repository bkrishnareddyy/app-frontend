# F04 · Actions & Exception Workflow
> Depends on: F01 (decision state normalizer, auto-approval policy — these are prerequisites)
> Branch: `feat/actions-workflow`
> Features covered: #13 Exception workbench, #14 Exception assignment/resolution, #15 Autonomous workflow orchestration, #16 Human approval controls

---

## Capability A — The Work Queue as the Homepage

* **Task A-1**: Create `src/app/app/page.tsx` — the work queue page. This is the primary post-login destination. Query `buildWorkQueue` server-side with pagination. Display as a grouped list: BLOCKED | NEEDS_REVIEW | CONFIRM buckets.
* **Task A-2**: Change the post-auth redirect in `src/app/page.tsx` from `/app/dashboard` to `/app`. Update `src/lib/navigation.ts` so "Dashboard" is a secondary nav item, not the primary.
* **Task A-3**: `/app/decisions` and `/app/exceptions` → permanent 308 redirect to `/app/actions` with query params preserved (`decisionId`, `exceptionId`, `shipmentId`). Update all deep links in `workQueue.ts`.

## Capability B — Queue Ranking (Deadline × Dollars × Severity)

* **Task B-1**: Rewrite queue ranking in `src/lib/decisions/workQueue.ts`. Scoring function: `score = (1 / (hoursToDeadline + 1)) * log10(valueAtRisk + 1) * blockingMultiplier`. Where: `hoursToDeadline` comes from `Shipment.filingDeadline` (from F03-E-4), `valueAtRisk` is sum of `ShipmentLineItem.totalValue`, `blockingMultiplier` is 3 if any blocking exception, 1 otherwise.
* **Task B-2**: Row in the queue shows: shipment number, importer name, count of actionable items, "Files in Xh" (from deadline), "$XXXk declared value", blocking badge if applicable. Score is not shown to the user; the sort is its expression.
* **Task B-3**: Filter controls: assignedToMe toggle, shipment status filter, exception category filter. These are filters, not rank adjustments.
* **Task B-4**: Server-side pagination: `GET /api/actions?limit=50&cursor=...`. Never fetch-all-and-filter in React.

## Capability C — Exception Workbench

* **Task C-1**: Consolidate all decision + exception items into `ActionsClient.tsx`. Sections:
  - **BLOCKED** (red): decisions with `triageState: BLOCKED` — show `blockedReason`, show what's unblocking it
  - **NEEDS_REVIEW** (amber): decisions awaiting human action — show confidence, evidence summary, proposed value
  - **CONFIRM** (blue): high-confidence decisions — show as compact rows, one-click approve, bulk-select
  - **EXCEPTIONS** (grouped by category): missing data, conflicts, validation failures
* **Task C-2**: Exception priority indicators: show `ExceptionItem.blocking` as a filing-blocker badge. Show age (time since created). Show `ExceptionItem.expiryDate` as countdown if near deadline.
* **Task C-3**: Exception detail slide-over: click an exception row → slide-over showing full exception details, history, notes, resolution options. Does not navigate away from the queue.
* **Task C-4**: Bulk exception operations — see Capability E.

## Capability D — Exception Assignment & Structured Resolution

* **Task D-1**: Create `src/lib/exceptions/resolutionReasons.ts`: versioned picklist keyed by `ExceptionItem.category`. Example for `MISSING_DATA`: `["SUPPLIER_DELAY", "AWAITING_CUSTOM_CLEARANCE", "DOCUMENT_IN_TRANSIT", "NOT_REQUIRED_FOR_THIS_ENTRY"]`. For `CONFLICT`: `["DATA_ENTRY_ERROR", "MULTIPLE_SHIPMENTS_CONSOLIDATED", "AMENDED_BY_SUPPLIER", "VALID_DISCREPANCY_EXPLAINED"]`.
* **Task D-2**: Add Prisma migration: `ExceptionItem.resolutionReasonCode String?`. Keep `resolutionNote` (free text) alongside it.
* **Task D-3**: Update `PATCH /api/exceptions/[id]`: validate that `resolutionReasonCode` is a valid code for the exception's `category`. Waive action requires both `reasonCode` and non-empty `resolutionNote` (currently enforced only by some paths — enforce server-side for all).
* **Task D-4**: Assignment UI: "Assign to" button on each exception. Shows account members list. Sends notification to assigned user (via `Notification` model — already implemented).
* **Task D-5**: Exception history: `PATCH /api/exceptions/[id]` must append to a history log (store in `ExceptionItem.history Json[]` or a new `ExceptionHistory` model). Each history entry: `{ timestamp, userId, action, note }`. Display in exception slide-over.
* **Task D-6**: Vitest: waive without reason code → 422; waive with valid code+note → 200; resolution code must match category.

## Capability E — Bulk Approve/Reject/Resolve

* **Task E-1**: `POST /api/decisions/bulk`: body `{ decisionIds: string[], action: "APPROVE" | "REJECT", humanNotes?: string, reasonCode?: string }`. Per-decision permission check (`isClassificationOverride` check runs per row). Per-decision `AuditLog` row. Returns `{ succeeded: string[], failed: { id: string, reason: string }[] }`. Partial success is a valid outcome.
* **Task E-2**: `POST /api/exceptions/bulk`: same pattern. Preserves per-row `expectedVersion` optimistic concurrency check. Waive action requires `reasonCode` per exception.
* **Task E-3**: `ActionsClient.tsx` selection state: checkbox on each row, "select all in this bucket" affordance, "select all matching part master" (driven by F01-B-2 part-master match result). Selection toolbar shows: `{n} items selected | Approve | Reject | Assign`.
* **Task E-4**: Confirmation dialog before bulk action: states count, action name, and any override implications in plain English. "Approve 14 decisions (3 are classification overrides)" — user must type "CONFIRM" for bulk overrides.
* **Task E-5**: Vitest: bulk approve with mixed valid/invalid IDs → partial success response; bulk override without confirmation code → 422.

## Capability F — Human Approval Controls with Provenance

* **Task F-1**: Render provenance on every decision card: reviewer name, timestamp, confidence band. For auto-verified: "Auto-verified by policy `hts-v3` at 94% confidence, part-master match". For human: "Approved by Sarah Chen (License #12345) on Aug 11, 2026 at 2:32 PM".
* **Task F-2**: `AgentDecision.reviewAuthority` field (already written by `reviewAuthority.ts`) — render it. Never hide it behind an expand.
* **Task F-3**: Auto-verified decisions render distinctly: lighter background, robot icon, policy label. They are not "approved" — they are "auto-verified pending next audit".
* **Task F-4**: `GET /api/decisions?triageState=NEEDS_REVIEW` — the primary queue query. Always filtered by the stored column, never by string matching on prose.

## Capability G — Autonomous Workflow Orchestration

* **Task G-1**: Define shipment lifecycle stages in `src/lib/workflow/stages.ts`: `DOCUMENT_INTAKE → CLASSIFICATION → VALUATION → ORIGIN → COMPLIANCE → FILING_PREP → READY_TO_FILE`. Each stage has: entry condition, required decisions, required exceptions resolved, completion check.
* **Task G-2**: `Shipment.currentStage` column (new migration). Updated by Inngest `shipment.stage.advance` function after each stage completion check.
* **Task G-3**: Stage gate configuration: account can configure which stages require a human specialist to approve advancement (vs. auto-advance when all checks pass). Stored in `AgentPolicyConfig` (from F01-B-3).
* **Task G-4**: Inngest `shipment.stage.advance` function: checks stage completion; if complete and no human gate, advances to next stage and triggers next-stage agents. If human gate, creates an `AgentDecision` with `triageState: NEEDS_REVIEW` for the specialist to approve advancement.
* **Task G-5**: Shipment workspace: stage progress indicator at the top (horizontal stepper). Click a stage to see its status details and which decisions/exceptions are pending.
* **Task G-6**: Circuit breaker: if a pipeline stage fails 3 times, it transitions to `BLOCKED` and creates an exception with `category: "SYSTEM"`. Does not keep retrying indefinitely.

## Data gaps
- Workflow stage definitions need domain expert review (licensed broker input on which stages require human approval for which entry types).
- Exception category → valid resolution reason codes need licensed customs broker review before production.
