# F03 · Shipment Workspace
> Depends on: F01 (readiness gate server enforcement), F02 (extraction fields for reconciliation)
> Branch: `feat/shipment-workspace`
> Features covered: #5 Shipment document workspace, #8 Cross-document reconciliation, #9 Conflict detection, #10 Missing-document detection, #11 Shipment readiness score, #12 Dependency-aware reprocessing

---

## Capability A — Shipment Document Workspace (UI Polish)

The shell exists. Gaps are in document status display, workspace completeness, and the "what's missing" indicator.

* **Task A-1**: Standardize document status vocabulary in `ShipmentDocumentsSection.tsx` and `DocumentWorkspacePanel.tsx`. Use `DocumentType` enum (from F02-B-1) and `ShipmentDocument.status` enum: `UPLOADING | PROCESSING | PROCESSING_FAILED | READY | NEEDS_REVIEW | ARCHIVED`. Replace any free-text status comparisons.
* **Task A-2**: Document workspace header: show a "required documents" checklist driven by `src/lib/requiredDocumentTypes.ts`. Each entry: type name, status (present ✓ / missing ✗ / needs review ⚠). Count badge: "4 of 6 required documents present".
* **Task A-3**: Document reorder: allow user to set a display order within the workspace (drag-and-drop or numbered inputs). Store in `ShipmentDocument.displayOrder Int @default(0)`. Does not affect processing order.
* **Task A-4**: Document workspace tabs: Documents | Extracted Facts | Exceptions | Timeline. Currently the tab structure exists but "Extracted Facts" tab shows `extractedJson` blob — replace with structured `ExtractionField` list (from F02-C-3).
* **Task A-5**: Shipment header: show `healthStatus` badge (Healthy / At Risk / Critical) with tooltip explaining derivation. Show `readinessScore` as a progress bar with percentage.

## Capability B — Cross-Document Reconciliation Engine

Currently uses synthetic rules. Replace with a real field-comparison engine.

* **Task B-1**: Create `src/lib/reconciliation/reconciliationEngine.ts`. Input: array of `ExtractionField[]` grouped by document type. Output: `ReconciliationResult[]` where each result has `{ fieldName, docTypeA, valueA, docTypeB, valueB, match: boolean, discrepancyType: "QUANTITY" | "VALUE" | "WEIGHT" | "PARTY" | "ORIGIN" | "CONTAINER" | "DATE", severity: "BLOCKING" | "WARNING" | "INFO" }`.
* **Task B-2**: Define reconciliation rule table in `src/lib/reconciliation/reconciliationRules.ts` (data, not code): `{ fieldKey, docTypeA, docTypeB, normalizationFn, tolerancePct, blocksFiling }`. Example rules: invoice total value vs. declared value on entry; invoice quantity vs. packing list quantity (tolerance 0%); BL container numbers vs. packing list container numbers; invoice seller vs. BL shipper; certificate of origin country vs. shipment country of origin.
* **Task B-3**: Update `POST /api/shipments/[id]/reconcile`: call `reconciliationEngine` with real extracted fields (from `ExtractionField` table). Write `ReconciliationIssue` rows for each discrepancy. Mark issues that `blocksFiling: true`.
* **Task B-4**: Trigger reconciliation via Inngest whenever: a new document is attached to a shipment AND has status `READY`, or a human corrects an extraction field (from F02-C-4). Event: `shipment.reconciliation.triggered`.
* **Task B-5**: Vitest: quantity discrepancy creates BLOCKING issue; party name mismatch (with normalization) creates WARNING; within-tolerance value difference creates no issue.

## Capability C — Conflict Detection UI

* **Task C-1**: In the shipment workspace "Exceptions" tab: reconciliation conflicts appear as exception items with `category: "CONFLICT"`. Each conflict shows: field name, the two conflicting values, source document for each, severity badge.
* **Task C-2**: "Resolve conflict" action: user selects which value is correct, adds a note. Updates `ReconciliationIssue.resolution = "ACCEPTED_A" | "ACCEPTED_B" | "BOTH_WRONG"` with `resolvedByUserId` and `resolvedAt`. Triggers re-reconciliation (the resolved field is now canonical).
* **Task C-3**: Blocking conflicts show in `PreFilingReadiness` component as filing blockers.

## Capability D — Missing-Document Detection

* **Task D-1**: Expand `src/lib/requiredDocumentTypes.ts`: define required document sets per `entryType` (Consumption, TIB, Informal, Section 321). Also define conditionally-required documents (e.g. Certificate of Origin required if USMCA claimed; Phytosanitary required for live plants).
* **Task D-2**: `GET /api/shipments/[id]` response: include `missingDocuments: { type: DocumentType, reason: string, blocking: boolean }[]`.
* **Task D-3**: Missing-document exceptions: automatically create `ExceptionItem` rows with `category: "MISSING_DATA"`, `blocking: true` for each required missing document. Auto-resolve when the document is uploaded and classified.
* **Task D-4**: "Request document" action on a missing-document exception: sends an email to a specified party (supplier/broker/forwarder) with a direct upload link (time-limited signed URL). Creates `InboundSenderRoute` for the response.

## Capability E — Shipment Readiness Score (Real Formula)

* **Task E-1**: Refactor `src/lib/shipmentReadiness.ts`: readiness score is computed from five factors:
  1. Document completeness (0–25 pts): `presentDocs / requiredDocs * 25`
  2. Extraction quality (0–20 pts): average confidence of `ExtractionField` rows, scaled
  3. Exception status (0–25 pts): 25 if no blocking exceptions; deduct per blocking exception
  4. Classification coverage (0–20 pts): fraction of line items with an `APPROVED` HTS decision
  5. Reconciliation pass (0–10 pts): 10 if no unresolved `BLOCKING` reconciliation issues; 0 otherwise
* **Task E-2**: Store computed score in `Shipment.readinessScore` and `Shipment.healthStatus`. Recompute on: document attach/detach, exception create/resolve, decision approve/reject, reconciliation run. Via Inngest event `shipment.readiness.compute`.
* **Task E-3**: `PreFilingReadiness` component: show score breakdown by factor, not just total. Each factor shows contributing items (e.g. "3 blocking exceptions holding 25pts").
* **Task E-4**: `Shipment.filingDeadline DateTime?`: derive from `estimatedArrival` + entry-type rules (entry summary: 10 working days after release; entry filing: 15 calendar days after arrival). Store and display. Do not compute in render path.
* **Task E-5**: Vitest: score is 0 when no documents; 100 when all docs present, extracted, reconciled, exceptions resolved, all line items classified.

## Capability F — Dependency-Aware Reprocessing

* **Task F-1**: Add `PipelineStepExecution.dependsOn String[]` (array of step IDs this step must wait for). The orchestrator reads this to determine which steps to re-trigger when upstream data changes.
* **Task F-2**: `POST /api/documents/[id]/reprocess`: currently re-runs the entire pipeline. Refactor: accept optional `{ fromStep: PipelineStep }`. If `fromStep` is specified, only re-run steps from that point forward (in dependency order).
* **Task F-3**: When a human corrects an extraction field (F02-C-4), trigger only the downstream steps: reconciliation → readiness score. Do not re-run OCR or classification.
* **Task F-4**: When a new document is attached to a shipment that already has other documents, trigger reconciliation only (not full pipeline on existing docs).
* **Task F-5**: Pipeline status visible in shipment workspace: `PipelineProgressTracker.tsx` already exists — connect to `GET /api/shipments/[id]/pipeline-status` with real `PipelineJob` data.

## Data gaps
- Reconciliation rule table must be seeded with real trade compliance rules (values, quantities, parties, origins) — not left empty. Seed data task: populate `reconciliationRules.ts` with ~20 production-applicable rules.
- Entry-type-specific required document sets must be reviewed by a licensed customs broker before going to production.
