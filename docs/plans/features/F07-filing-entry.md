# F07 · Filing & Entry
> Depends on: F01 (server-side gate), F03 (readiness score), F05 (HTS decisions), F06 (duty stack)
> Branch: `feat/filing-entry`
> Features covered: #32 Automated 7501 preparation, #33 Pre-filing validation, #34 Entry-line provenance, #35 Filing readiness gate, #36 ACE/ABI filing integration, #37 Filing-status tracking, #38 Continuous compliance monitoring

---

## Capability A — Automated 7501 Preparation

`CustomsFiling` model exists. `filing/[id]/entry-summary` route is a prototype with float math.

* **Task A-1**: Define 7501 field mapping in `src/lib/filing/form7501.ts`: for each CBP Form 7501 field, specify: source model, source field, transformation required, validation rule. Example: Block 29 (Entered Value) ← `ShipmentLineItem.customsValue` (sum with Decimal); Block 33 (HTS) ← `ProductClassification.htsCode` (from approved decision); Block 34 (Duty Rate) ← `HtsDutyRate.adValoremRate` (from htsReleaseId); Block 35 (Duty) = Block 29 × Block 34 (Decimal multiply).
* **Task A-2**: Refactor `POST /api/filing/[id]/entry-summary`: use `form7501.ts` mapping + Decimal arithmetic. Write `FilingSnapshot` row capturing all source values and the `htsReleaseId` used. Return typed 7501 data structure, not a prose summary.
* **Task A-3**: Entry line provenance: every 7501 field stores `{ value, sourceModel, sourceId, sourceField, approvedByUserId?, approvedAt? }`. This populates `FilingSnapshot`. UI shows "Block 29 value of $412,500 sourced from: Commercial Invoice (Doc #CI-2026-8811), field `total_value`, approved by Sarah Chen on Aug 10, 2026".
* **Task A-4**: 7501 preview UI: `src/app/app/filing/page.tsx` — structured form-like view of each CBP block. Color-coded: green = sourced and approved; amber = sourced but unapproved; red = missing. Click any block to open its provenance detail.
* **Task A-5**: 7501 export: generate a structured JSON export (for ABI submission) and a human-readable PDF summary. PDF uses a server-side template renderer (no client-side PDF).
* **Task A-6**: Vitest: all required 7501 blocks are covered by the mapping; Decimal arithmetic produces correct results; missing HTS code is flagged, not defaulted.

## Capability B — Pre-Filing Validation

`POST /api/filing/[id]/validate` exists but checks only some fields.

* **Task B-1**: Create `src/lib/filing/filingValidator.ts`. Returns `ValidationResult[]` where each item: `{ field, rule, passed, message, blocking }`. Validation rules:
  - All required 7501 blocks populated (BLOCKING)
  - All `ShipmentLineItem` have approved `ClassificationDecision` (BLOCKING)
  - All `ReconciliationIssue` with `blocksFiling: true` are resolved (BLOCKING)
  - All blocking `ExceptionItem` are resolved (BLOCKING)
  - Bond sufficient to cover entry value (WARNING if can't verify; BLOCKING if bond expired)
  - Importer of Record has valid CBP number (BLOCKING)
  - Port of Entry is a valid ACE port code (BLOCKING)
  - Entry type is valid for the shipment mode (WARNING)
  - HTS release used is current (WARNING if > 30 days old)
* **Task B-2**: `POST /api/filing/[id]/validate` calls `filingValidator`. Returns `{ valid: boolean, blockers: ValidationResult[], warnings: ValidationResult[] }`.
* **Task B-3**: `POST /api/filing/[id]/transmit` calls `filingValidator` server-side before transmitting. If any BLOCKING validation fails, returns 422 with blocker list. The transmit endpoint cannot be bypassed by a client-side check passing — the server is the gate.
* **Task B-4**: Vitest: transmit with missing HTS → 422 with blocker list; transmit with all blockers resolved → proceeds to transmission step.

## Capability C — Filing Readiness Gate (Server-Enforced)

* **Task C-1**: `Shipment.readinessScore` must be ≥ 80 for transmission to proceed (configurable threshold in `AgentPolicyConfig`). Add this check to `filingValidator`.
* **Task C-2**: `PreFilingReadiness.tsx` component: reflect the server-side validation results (fetch from `POST /api/filing/[id]/validate`). Do not compute blockers client-side — trust the server.
* **Task C-3**: "File this entry" button is disabled (not hidden) when blockers exist. Tooltip explains each blocker inline.

## Capability D — ACE/ABI Filing Integration

Currently `MockCustomsTransmissionProvider` only. This requires real CBP credentials — implement the provider interface so real credentials can be plugged in without code changes.

* **Task D-1**: Define `CustomsTransmissionProvider` interface in `src/lib/filing/transmissionProvider.ts`:
  ```typescript
  interface CustomsTransmissionProvider {
    transmit(payload: AbiPayload): Promise<TransmissionResult>
    getStatus(referenceNumber: string): Promise<FilingStatusUpdate>
    parseAcknowledgment(raw: string): AcknowledgmentResult
  }
  ```
* **Task D-2**: `MockCustomsTransmissionProvider` continues to implement this interface. It is the only active implementation until CBP credentials are available. Health check (`GET /api/health`) confirms which provider is active and rejects if production env has mock provider.
* **Task D-3**: Define `AbiPayload` structure from CATAIR (CBP ABI transaction set). The 7501 field mapping from A-1 maps to CATAIR fields. This is a data mapping task.
* **Task D-4**: `RealAceProvider` stub: class that implements the interface, reads credentials from `process.env.CBP_ABI_*`. Not active until credentials are available. Structure it so adding real HTTP calls is the only step needed.
* **Task D-5**: Acknowledgment parsing: `CustomsResponse` model already exists. `parseAcknowledgment` writes `CustomsResponse` rows. Status polling: Inngest cron every 15 minutes polls status for filings in `SUBMITTED` state.
* **Task D-6**: Filing status transitions (already in schema): `DRAFT → REVIEW_REQUIRED → SUBMITTED → ACCEPTED → REJECTED → RELEASED → LIQUIDATED`. On rejection: parse rejection code, create `ExceptionItem` with `category: "FILING"` and parsed rejection message.

## Capability E — Filing Status Tracking

* **Task E-1**: Filing status timeline: `CustomsFiling` detail page shows a status timeline component: each status with timestamp, actor (user or system), and notes. Status transitions are logged to `AuditLog`.
* **Task E-2**: `GET /api/filing` filter: `?status=SUBMITTED,ACCEPTED` for broker dashboard. Paginated. Include days since submission, ACE reference number.
* **Task E-3**: Filing list in shipment workspace: current status badge, submission date, ABI reference number. Link to filing detail.
* **Task E-4**: Rejection handling UI: when a filing is rejected, the `ExceptionItem` created in D-6 appears in the actions queue with the rejection code and a "Re-file" action. Re-file creates a new `CustomsFiling` from the corrected shipment data.

## Capability F — Continuous Compliance Monitoring

`ComplianceAuditRecord` exists. `compliance/audits/run` uses a fixed 5-item checklist.

* **Task F-1**: Define compliance audit checklist in `src/lib/compliance/auditChecklist.ts`: a typed array of `AuditCheck` items. Each check: `{ id, name, description, severity, evaluate: (filing: FilingSnapshot) => CheckResult }`. Initial checks:
  - HTS code changed after filing (compare `FilingSnapshot.htsCode` vs current `ProductClassification.htsCode`)
  - Declared value differs from final invoice by > 5%
  - New AD/CVD order covers the HTS code used
  - Bond expired before liquidation date
  - Classification not approved by a licensed broker (for entries > $2,500)
* **Task F-2**: Refactor `POST /api/compliance/audits/run`: runs every check in the checklist against the specified filing or all filings in the account (paginated). Creates `ComplianceFinding` rows for failures. No hardcoded checklist strings, no hardcoded risk scores.
* **Task F-3**: Compliance monitoring cron: Inngest function runs daily (within Vercel Hobby cron limit), re-runs all checks on all `SUBMITTED` and `ACCEPTED` filings. Creates findings for newly detected issues.
* **Task F-4**: Findings UI: `src/app/app/compliance/page.tsx` — grouped by severity (CRITICAL, HIGH, MEDIUM, LOW). Each finding links to the filing and the specific issue. Assignment + resolution workflow (same as exceptions).
* **Task F-5**: Vitest: HTS change after filing creates a finding; no change creates no finding; finding is idempotent (re-run doesn't duplicate).

## Data gaps
- **ACE/ABI credentials**: Real CBP transmission requires ABI filer credentials from a licensed broker. Until available, mock provider is the only active implementation. Document this clearly in the filing UI.
- **Valid ACE port codes**: Need the current list of CBP ports from ACE. Seed in `prisma/seed-data/ace-ports.json`.
- **Bond sufficiency check**: Requires bond amount from `Bond` model and estimated duty from `DutyStack`. Both are available; implement the comparison.
- **CBP number validation format**: EIN format is 9 digits; CBP assigns unique importer IDs. Format validation can be implemented; real CBP lookup requires an ACE API.
