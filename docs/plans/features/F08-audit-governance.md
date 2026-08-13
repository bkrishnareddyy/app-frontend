# F08 · Audit, Compliance & Governance
> Depends on: F01 (audit trail hardening, token fix), F07 (filing provenance)
> Branch: `feat/audit-governance`
> Features covered: #39 Reasonable-care record, #40 Immutable audit trail, #41 Audit population analytics, #42 Focused Assessment defense file, #55 Portable compliance record

---

## Capability A — Immutable Audit Trail

`AuditLog` model and `audit.ts` exist. Several routes are missing audit calls; raw token is leaked (fix in F01).

* **Task A-1**: Audit coverage audit: grep all POST/PATCH/DELETE route handlers in `src/app/api/`. For each one that modifies data, confirm an `AuditLog` row is written. List routes missing audit calls and add them. Required audit fields: `accountId`, `userId`, `action`, `entity`, `entityId`, `metadata` (diff of changed fields), `ipAddress`, `userAgent`, `requestId`, `success`.
* **Task A-2**: Structured audit actions: create `src/lib/audit/auditActions.ts` — a typed enum of all audit action strings: `DOCUMENT_UPLOADED`, `DOCUMENT_CLASSIFIED`, `FIELD_CORRECTED`, `DECISION_AUTO_APPROVED`, `DECISION_APPROVED`, `DECISION_REJECTED`, `DECISION_OVERRIDDEN`, `EXCEPTION_RESOLVED`, `EXCEPTION_WAIVED`, `FILING_SUBMITTED`, `CLASSIFICATION_CHANGED`, etc. Replace all freehand action strings with this enum.
* **Task A-3**: Diff capture: for PATCH operations, the `metadata` field must include `{ previousValue, newValue }` for each changed field. Add a `diff(before, after)` helper that produces a redacted diff (excludes `password`, `token`, `secret` keys).
* **Task A-4**: Audit log query API: `GET /api/audit?entityId=...&entity=ShipmentDocument&action=...&from=...&to=...`. Paginated. Scoped to `accountId`. Used by the audit timeline UI.
* **Task A-5**: `AuditLog` is append-only. No UPDATE or DELETE on this table, ever. Add a Postgres row-level security policy if possible: `DENY DELETE ON audit_logs TO app_user`. Document this constraint.
* **Task A-6**: Vitest: auto-approval writes audit log with `action: "DECISION_AUTO_APPROVED"` and policy id; file submission writes audit log; missing entity in diff produces no crash.

## Capability B — Reasonable-Care Record

`audit/package` route exists. Returns a basic package.

* **Task B-1**: Define `ReasonableCarePackage` structure in `src/lib/audit/reasonableCarePackage.ts`:
  ```typescript
  interface ReasonableCarePackage {
    shipmentId: string
    entryNumber: string
    importerOfRecord: { name, cbpNumber }
    generatedAt: string
    sections: {
      classification: ClassificationSection[]   // HTS code, GRI steps, ruling citations, approver
      valuation: ValuationSection               // customs value components, related-party flag
      origin: OriginSection                     // origin determination, basis, trade agreement
      documents: DocumentSection[]             // each document, extraction confidence, classification
      decisions: DecisionSection[]             // each decision, auto/human, policy, confidence
      exceptions: ExceptionSection[]           // each exception, resolution, reason code
    }
    certifications: { role, name, date, signature? }[]
  }
  ```
* **Task B-2**: Refactor `POST /api/audit/package`: populate `ReasonableCarePackage` from real data — `FilingSnapshot`, `ClassificationDecision` with `GriAnalysisStep`, `OriginDetermination`, `ValuationAssistsRecord`, `ExtractionField`, `AgentDecision`, `ExceptionItem`. No synthetic data.
* **Task B-3**: Package export: generate a structured JSON file and a human-readable PDF. The PDF is a multi-section report: cover page (entry details), one section per category. Use a server-side PDF generator (e.g. `@react-pdf/renderer` or a simple HTML-to-PDF via headless Chromium — pick based on Vercel function constraints).
* **Task B-4**: `GET /api/audit/package/[shipmentId]`: return the current package state. Include a `completeness` score: what fraction of sections have real data vs. missing.
* **Task B-5**: Package generation is triggered by: broker clicking "Generate Reasonable Care Record" in the filing detail UI, or via chat tool call `generate_reasonable_care_record({ shipmentId })`.

## Capability C — Audit Population Analytics

No meaningful implementation today.

* **Task C-1**: Create `WorkMetricSnapshot` Prisma model:
  ```
  model WorkMetricSnapshot {
    id              String   @id @default(cuid())
    accountId       String
    date            DateTime // daily grain
    period          String   // "DAILY" | "WEEKLY" | "MONTHLY"
    cyclTimeMedianHours  Float?
    firstPassRate        Float?  // % entries accepted without rejection
    exceptionAgeAvgHours Float?
    touchRate            Float?  // % line items a human modified vs. total
    dutyPerEntry         Decimal?
    openExceptions       Int
    filedEntries         Int
    pscCount             Int
    createdAt       DateTime @default(now())
    @@index([accountId, date])
  }
  ```
* **Task C-2**: Create `src/lib/analytics/metricComputer.ts`: pure functions computing each metric from real data:
  - `cyclTimeMedian`: median of `(CustomsFiling.updatedAt - Shipment.createdAt)` for filings that moved to SUBMITTED in the period
  - `firstPassRate`: accepted filings / total submitted in period
  - `touchRate`: `FieldApproval` rows where a human changed the value / total `ExtractionField` rows presented
  - `openExceptions`: count of `ExceptionItem` with status not RESOLVED
* **Task C-3**: Inngest daily function: compute metrics for yesterday, write `WorkMetricSnapshot`. Run after the cron window.
* **Task C-4**: `GET /api/dashboard/metrics?period=MONTHLY&months=6` — return metric snapshots. Used by the operations dashboard.
* **Task C-5**: Operations dashboard UI (`CommandCenterClient.tsx`): replace fake metric cards with real data from the metric snapshot API. Show: cycle time trend, first-pass acceptance rate, exception age distribution, touch rate. All with actual numbers, not hardcoded values.
* **Task C-6**: Vitest: metric computation for cycle time with known dates; touch rate with known field approval/total counts.

## Capability D — Focused Assessment Defense File

`audit/room/[filingId]` route exists. Returns basic data.

* **Task D-1**: Define `FocusedAssessmentFile` structure:
  ```typescript
  interface FocusedAssessmentFile {
    auditId: string        // CBP audit reference
    importer: { name, cbpNumber, address }
    periodCovered: { from, to }
    entryPopulation: {
      total: number
      byEntryType: Record<string, number>
      byHtsChapter: Record<string, number>
      totalDutyPaid: Decimal
    }
    controlsInventory: ControlEvidence[]   // import controls the importer has in place
    sampleEntries: SampleEntry[]           // selected entries with full reasonable-care records
    exceptions: ExceptionSummary          // summary of exceptions and resolutions
    remediation: RemediationItem[]        // corrective actions taken
  }
  ```
* **Task D-2**: `POST /api/audit/room` (new): create a Focused Assessment file for a given period. Input: `{ importerOfRecordId, periodFrom, periodTo, entryIds?: string[] }`. Assembles the defense file structure. Writes `AuditTimeline` row.
* **Task D-3**: `GET /api/audit/room/[filingId]`: return the defense file for a specific filing as part of a larger FA. Include the filing's `ReasonableCarePackage`.
* **Task D-4**: Controls inventory: `ControlEvidence` is a new model (or stored as JSON). Allows the importer to document their import controls (training records, written classification procedures, vendor certification program, etc.). These are manually entered and versioned.
* **Task D-5**: Defense file export: ZIP containing JSON data + individual PDF reasonable-care records + a cover narrative. The narrative is AI-generated using Claude API: summarizes the importer's compliance posture, exception patterns, and remediation actions.
* **Task D-6**: Vitest: defense file assembly with known entries produces correct population statistics; missing entries are surfaced as gaps.

## Capability E — Portable Compliance Record Export

* **Task E-1**: `POST /api/audit/export`: generates a self-contained compliance record export for the importer. Contents: product master (with all classification history), all reasonable-care records, audit log (scoped to importer), decisions, exceptions. Returns a signed Vercel Blob URL to a ZIP file valid for 24 hours.
* **Task E-2**: Access control: only the `OWNER` role on an account can trigger this export. The export is scoped to the account — it cannot include broker-internal data.
* **Task E-3**: Export manifest: a `MANIFEST.json` inside the ZIP lists all included files and their content types. An importer can hand this to a new broker and they have everything needed to continue compliance operations.
* **Task E-4**: Chat tool: `export_compliance_record({ format: "ZIP" })` triggers the export and returns the download URL.
