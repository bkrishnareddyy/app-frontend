# Requirements: Validated 7501 Draft + ABI Filer Export Payload

**Goal.** From a shipment that has passed intake, classification, origin, and valuation, produce (a) a **validated CBP Form 7501 Entry Summary draft** with per-field provenance, and (b) an **export payload** — CSV, EDI/CATAIR, or JSON API — that lands in the **customer's existing ABI filer**. Qubere does not transmit to CBP. The filer does. Qubere's job is to hand the filer a packet that is complete, validated, and provable.

**Non-goal.** No direct ABI/ACE connection, no CBP transmission, no entry number assignment by Qubere. `CustomsFilingAgent` already simulates ACE; this feature must not extend or depend on that simulation.

---

## 0. Architectural constraints (apply to every unit)

| # | Constraint |
|---|---|
| C1 | **One draft, many serializers.** CSV, EDI, and JSON exports are *pure functions of the same validated `EntrySummaryDraft`*. No serializer may read the database or recompute a value. If two exports disagree, that is a bug in the serializer, not the data. |
| C2 | **No invented values.** Any 7501 block whose value is unknown is `null` with a `MISSING` provenance record. Never default a port code, importer number, bond number, or country. (The existing `/api/filing/[id]/entry-summary` route hardcodes `"CBP-998877"`, `"BND-500123"`, `"Port of Los Angeles (2704)"`, `"Germany"` — this feature **replaces** that route and those defaults are prohibited.) |
| C3 | **Every field carries provenance.** Each populated block records where the value came from: document + page, user edit, agent decision, master data record, or computation. This is the product promise ("prove every line item") and is a hard acceptance criterion, not a nice-to-have. |
| C4 | **Deterministic.** Same inputs ⇒ byte-identical draft and byte-identical payload, except for explicitly stamped timestamps/sequence numbers which must be injectable for tests. No `new Date()` or `Math.random()` inside assemblers or serializers — take a `clock` / `sequence` port. |
| C5 | **Money is `Decimal`, never `number`.** Use Prisma `Decimal` / a decimal library end-to-end. Rounding happens once, at serialization, per the target format's stated precision rule. |
| C6 | **Account-scoped.** Every query filters on `accountId` from `ctx`. Reuse `withAuthenticatedRoute` and existing permission checks. |
| C7 | **Filer-agnostic via profiles.** Format details (field order, record layout, delimiters, filer code, port, transport) live in a **Filer Profile** data record, not in code. Adding a second filer must not require editing a serializer. |
| C8 | **Existing vocabularies are authoritative.** Reuse `FILING_STATUSES` / `filingStateMachine.ts`, `requireEntryTypeCode` from `modules/filing/entryType.ts`, `FilingBlockerCode` from `modules/filing/filingReadiness.ts`, and `computeFilingTariff` / `calculateMPF` / `calculateHMF` from `lib/tariff/dutyEngine.ts`. Do not introduce a parallel status or blocker vocabulary. |
| C9 | **Migrations.** New tables ship as a Prisma migration under `prisma/migrations/`. Code must not `select` new columns until the migration is deployed — gate behind a deploy step and note it in the PR. |
| C10 | **Tests use Vitest** (`tests/*.test.ts`, `npm test`). Golden/fixture files live in `tests/fixtures/7501/`. |

---

## Unit map

```
U1  7501 field model + provenance types        (pure, no deps)
U2  Filer Profile model + registry             (schema + CRUD)
U3  Draft assembler                            (U1)
U4  Duty & fee computation binding             (U1, existing dutyEngine)
U5  Validation rule engine                     (U1)
U6  7501 rule pack                             (U5)
U7  EntrySummaryDraft persistence + versioning (U1, U3, U6)
U8  CSV serializer                             (U1, U2)
U9  EDI / CATAIR serializer                    (U1, U2)
U10 JSON API serializer                        (U1, U2)
U11 Export dispatch + idempotency              (U2, U8-U10)
U12 HTTP API surface                           (U3, U6, U7, U11)
U13 UI: draft review + export                  (U12)
U14 Audit, state machine, snapshot integration (U7, U11)
U15 Golden-file & round-trip conformance suite (U8-U10)
```

Units U1–U7 are the critical path. U8/U9/U10 are parallelizable once U1 and U2 land.

---

## U1 — 7501 field model and provenance types

**Files:** `src/modules/entrySummary/model.ts`, `src/modules/entrySummary/provenance.ts`

**Goal.** A typed, block-numbered representation of CBP Form 7501 that every other unit reads and writes.

### Interface

```ts
export type ProvenanceSource =
  | "DOCUMENT"        // extracted from an uploaded doc
  | "USER"            // typed or confirmed by a human
  | "AGENT"           // proposed by an agent and approved
  | "MASTER_DATA"     // ImporterOfRecord / Bond / LegalEntity / CustomsProfile
  | "COMPUTED"        // derived (duty, MPF, totals)
  | "FILER_PROFILE"   // filer code, port default from profile
  | "MISSING";        // no value available

export interface FieldProvenance {
  source: ProvenanceSource;
  documentId?: string;
  documentPage?: number;
  factId?: string;              // Fact row
  agentDecisionId?: string;     // AgentDecision row
  fieldApprovalId?: string;     // FieldApproval row
  masterRecord?: { model: string; id: string };
  computedFrom?: string[];      // block ids this was derived from
  confidence?: number;          // 0-100, only when source is DOCUMENT or AGENT
  asOf: string;                 // ISO, when the value was established
}

export interface EntrySummaryField<T> {
  blockId: Block;               // e.g. "B01_FILER_ENTRY_NUMBER"
  value: T | null;
  provenance: FieldProvenance;
}
```

**Block coverage (header).** Model at minimum these 7501 blocks as discriminated, named fields:

`B01` Filer Code/Entry Number · `B02` Entry Type · `B03` Summary Date · `B04` Surety Number · `B05` Bond Type · `B06` Port Code · `B07` Entry Date · `B08` Importing Carrier · `B09` Mode of Transport · `B10` Country of Origin · `B11` Import Date · `B12` B/L or AWB Number · `B13` Manufacturer ID · `B14` Exporting Country · `B15` Export Date · `B16` I.T. Number · `B17` I.T. Date · `B18` Missing Docs · `B19` Foreign Port of Lading · `B20` U.S. Port of Unlading · `B21` Location of Goods · `B22` Consignee Number · `B23` Importer Number · `B24` Reference Number · `B25` Ultimate Consignee Name/Address · `B26` Importer of Record Name/Address · `B39` Total Other Fees · declaration block (`B40`–`B42`: declarant name, title, signature date).

**Block coverage (line, repeating `B27`–`B38`).**

`B27` Line Number · `B28` Description of Merchandise · `B29` A/HTSUS No., B/ADA-CVD No. · `B30` A/Gross Weight, B/Manifest Qty · `B31` Net Quantity in HTSUS Units · `B32` A/Entered Value, B/CHGS, C/Relationship · `B33` A/HTSUS Rate, B/ADA-CVD Rate, C/IRC Rate, D/Visa No. · `B34` Duty and I.R. Tax (Dollars/Cents).

Chapter 99 additional-duty lines (301/232/201) are **separate line entries** on the draft with their own `B29`/`B33`/`B34`, linked to the parent line via `parentLineNumber` — not folded into the parent's rate.

**Totals block:** `B35` Total Entered Value · `B37` Duty · `B38` Tax · `B39` Other (MPF/HMF itemized) · `B40` Total.

### Acceptance criteria
- `EntrySummaryDraft` type compiles with `strict` TS; no `any`.
- A helper `missing(blockId, reason)` produces a `MISSING` field; a helper `fromFact(fact, blockId)` produces a `DOCUMENT`-sourced field.
- Type-level guarantee: a field with `source: "MISSING"` must have `value === null` (enforce with a discriminated union or a runtime invariant + test).
- Zod schema `entrySummaryDraftSchema` parses/serializes the whole structure losslessly (`parse(serialize(x))` deep-equals `x`).

### Test cases — `tests/entry-summary-model.test.ts`
1. `missing()` yields `value: null` and `source: "MISSING"`.
2. A field constructed with `source: "MISSING"` and a non-null value throws / fails zod parse.
3. `fromFact` copies `documentId`, `documentPage`, and `confidence` from a `Fact` row.
4. Round-trip: `entrySummaryDraftSchema.parse(JSON.parse(JSON.stringify(draft)))` deep-equals the original, including `Decimal` values (assert as strings, not floats).
5. Every block id in the enum is unique and matches `/^B\d{2}[A-Z_]*$/`.
6. Chapter 99 line with `parentLineNumber` set validates; one pointing at a nonexistent parent line fails schema refinement.

---

## U2 — Filer Profile model and registry

**Files:** `prisma/schema.prisma` (new model), `src/modules/entrySummary/filerProfile.ts`

**Goal.** Per-account configuration describing *which* ABI filer the customer uses and *what shape* it wants.

### Schema

```prisma
model FilerProfile {
  id             String   @id @default(cuid())
  accountId      String
  account        Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  name           String              // "Descartes OneView – Prod"
  filerCode      String              // 3-char CBP-assigned ABI filer code
  defaultPortCode String?            // 4-digit; null means "must come from shipment"
  format         String              // CSV | CATAIR_AE | JSON_API
  formatVersion  String              // profile-scoped, e.g. "catair-ae-2024.1"
  fieldMap       Json                // format-specific layout (see below)
  transport      String              // DOWNLOAD | SFTP | HTTPS_WEBHOOK
  transportConfig Json?              // host/path/url; secrets referenced by key, never stored inline
  active         Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  exports FilerExport[]

  @@unique([accountId, name])
  @@index([accountId, active])
}
```

### Acceptance criteria
- `filerCode` validated: exactly 3 chars, `[A-Z0-9]`.
- `defaultPortCode` validated: exactly 4 digits when present.
- `format` restricted to the enum via zod at the service boundary (string column, same pattern as `filingStatus`).
- `transportConfig` **never** contains a password/key/token value. It holds a `secretRef` string only. A service-layer guard rejects writes whose `transportConfig` JSON contains any key matching `/pass|secret|token|key|credential/i` with a non-`secretRef` string value.
- `getActiveProfile(accountId, format?)` returns exactly one profile or a typed `NoFilerProfileConfigured` error. Never falls back to a built-in default.

### Test cases — `tests/filer-profile.test.ts`
1. Filer code `"ABC"` accepted; `"AB"`, `"ABCD"`, `"ab c"` rejected.
2. Port code `"2704"` accepted; `"270"`, `"27040"`, `"LA"` rejected.
3. `transportConfig: { password: "hunter2" }` rejected by the secret guard.
4. `transportConfig: { host: "sftp.x.com", secretRef: "vault://filer/x" }` accepted.
5. `getActiveProfile` on an account with zero active profiles returns `NoFilerProfileConfigured`, does not throw a raw error, and does not return a default.
6. `getActiveProfile` with two active CSV profiles returns a deterministic `AmbiguousFilerProfile` error naming both.
7. Cross-account isolation: account A cannot read account B's profile by id.

---

## U3 — Draft assembler

**Files:** `src/modules/entrySummary/assembler.ts`

**Goal.** Pure function: shipment facts in, `EntrySummaryDraft` out. **No database access inside** — the caller loads and passes a plain `AssemblerInput`.

### Interface

```ts
export interface AssemblerInput {
  shipment: {...};                 // Shipment columns
  lineItems: ShipmentLineItemLike[];
  importerOfRecord: ImporterOfRecordLike | null;
  bond: BondLike | null;
  parties: ShipmentPartyLike[];    // with LegalEntity + CustomsProfile
  facts: FactLike[];               // Fact rows, for provenance
  documents: ShipmentDocumentLike[];
  approvedDecisions: AgentDecisionLike[];
  fieldApprovals: FieldApprovalLike[];
  filerProfile: FilerProfileLike;
  clock: () => Date;
}

export function assembleEntrySummaryDraft(input: AssemblerInput): EntrySummaryDraft;
```

### Field precedence (must be implemented exactly, and is the single most test-worthy rule)

For any block, the value is chosen by the **first** rule that yields a non-null value:

1. `FieldApproval` for that field (human confirmed) → `source: USER`
2. Direct `Shipment` / `ShipmentLineItem` column edited by a user (`Fact.sourceType === "USER_ENTERED"`) → `source: USER`
3. Approved `AgentDecision` targeting the field / `lineNumber` → `source: AGENT`
4. Master data (`ImporterOfRecord`, `Bond`, `LegalEntity.customsProfile`) → `source: MASTER_DATA`
5. Highest-confidence `Fact` with `sourceType === "EXTRACTED"`; ties broken by most recent `createdAt`, then by `id` ascending (determinism) → `source: DOCUMENT`
6. `FilerProfile.defaultPortCode` — **only** for `B06` → `source: FILER_PROFILE`
7. otherwise → `missing()`

### Acceptance criteria
- Pure: no `db` import; `assembler.ts` importing `@/lib/db` fails a lint rule or an explicit test.
- Line ordering by `lineNumber` ascending; chapter 99 child lines immediately follow their parent.
- `B27` line numbers are contiguous starting at 1 on the draft even if source `lineNumber`s have gaps; the original is preserved as `sourceLineNumber` in provenance.
- Every block in the U1 enum appears in the output — populated or `MISSING`. No block silently omitted.
- Assembling twice with the same input and a fixed clock produces deep-equal output.

### Test cases — `tests/entry-summary-assembler.test.ts`
1. **Precedence ladder** (7 cases): for the same block, supply a competing value at each of levels 1–6 and assert the winner and its `source` each time.
2. Two extracted `Fact`s, confidences 92 and 97 → 97 wins, provenance carries its `documentId`/`documentPage`.
3. Two extracted `Fact`s with equal confidence → most recent `createdAt` wins; equal `createdAt` → lower `id` wins (run 50× to prove no flakiness).
4. No importer of record → `B23`/`B26` are `MISSING` with `value: null`; **assert the string `"CBP-998877"` appears nowhere in the output**.
5. No port on shipment and no `defaultPortCode` → `B06` is `MISSING`; assert `"2704"` and `"Port of Los Angeles"` absent.
6. Line items with `lineNumber` 3, 7, 11 → draft lines 1, 2, 3 with `sourceLineNumber` 3, 7, 11.
7. A 301 duty on line 2 produces a child line with `parentLineNumber: 2` positioned directly after line 2, and the parent's `B33` is unchanged.
8. Determinism: same input, fixed clock, 10 runs → identical `JSON.stringify`.
9. Purity: importing the module does not open a DB connection (spy on `db`).
10. Completeness: `Object.keys(draft.header)` covers every header block in the enum.

---

## U4 — Duty and fee computation binding

**Files:** `src/modules/entrySummary/duty.ts`

**Goal.** Populate `B33`, `B34`, `B35`, `B37`, `B38`, `B39`, `B40` from the existing duty engine — do not re-implement rate math.

### Acceptance criteria
- Calls `computeFilingTariff` / `calculateLineItemDuty` from `src/lib/tariff/dutyEngine.ts`. Adding rate logic to this module is out of scope; if the engine lacks something, extend the engine.
- MPF: `calculateMPF` with the engine's `MPF_RATE` / `MPF_MINIMUM` / `MPF_MAXIMUM`; itemized in `B39` as a named fee, not merged into duty.
- HMF: `calculateHMF`, applied **only when mode of transport is ocean** (`B09`). Non-ocean ⇒ HMF absent from `B39`, not zero.
- `B40` total = `B37` + `B38` + sum(`B39` fees). Assert the identity in code (invariant + thrown error, not a comment).
- Rounding: half-up to 2 decimals, applied **once** at the total and once per line — intermediate values keep full precision.
- Every computed field's provenance is `COMPUTED` with `computedFrom` listing contributing block ids.

### Test cases — `tests/entry-summary-duty.test.ts`
1. Single line, entered value 10,000, 2.5% ad valorem → duty 250.00.
2. MPF floor: entered value 1,000 → MPF = `MPF_MINIMUM` (31.67), not 3.46.
3. MPF ceiling: entered value 100,000,000 → MPF = `MPF_MAXIMUM` (614.35).
4. Ocean mode → HMF present; air mode → `B39` contains no HMF entry (assert key absent, not `0`).
5. Duty-free line (rate 0) → `B34` is `0.00`, provenance `COMPUTED`, not `MISSING`.
6. Chapter 99 child line adds its own `B34`; parent `B34` unchanged; `B37` = sum of both.
7. `B40 === B37 + B38 + Σ B39` holds across a 25-line fixture; deliberately corrupting one value throws the invariant error.
8. Rounding: three lines at 33.333 duty each → total 100.00, not 99.99 (proves rounding is not applied per-intermediate).
9. Decimal fidelity: a value of `0.1 + 0.2` path yields exactly `0.30`, asserted as a string.

---

## U5 — Validation rule engine

**Files:** `src/modules/entrySummary/validation/engine.ts`

**Goal.** A small, data-driven rule runner. Rules are declarative; the engine is generic.

### Interface

```ts
export type Severity = "BLOCKING" | "WARNING" | "INFO";

export interface Rule {
  code: string;                 // "E7501.B23.MISSING" — stable, never renumbered
  severity: Severity;
  blocks: Block[];              // 7501 blocks implicated
  title: string;                // what the requirement is
  cite?: string;                // "19 CFR 142.3(a)(1)" / CATAIR chapter
  evaluate(draft, ctx): RuleFinding[] | null;
}

export interface RuleFinding {
  code: string;
  severity: Severity;
  blocks: Block[];
  lineNumber?: number;
  message: string;              // states the actual value/count, not an adjective
  remediation: { label: string; anchor: string };  // deep link into shipment workspace
}

export function validateDraft(draft, rules, ctx): ValidationResult;
// ValidationResult = { findings, blockingCount, warningCount, isExportable }
```

### Acceptance criteria
- `isExportable === (blockingCount === 0)`. No other definition of "valid".
- Findings sorted deterministically: severity (BLOCKING > WARNING > INFO), then `lineNumber` ascending (`undefined` last), then `code` ascending.
- Rule codes are unique; a duplicate code registration throws at module load.
- One rule throwing does not abort the run — it is caught and converted to an `INFO` finding `E7501.ENGINE.RULE_ERROR` naming the failed rule code, and the remaining rules still run.
- Engine has zero 7501-specific knowledge (rules live in U6).

### Test cases — `tests/entry-summary-validation-engine.test.ts`
1. Zero rules → `isExportable: true`, empty findings.
2. One BLOCKING finding → `isExportable: false`, `blockingCount: 1`.
3. Only WARNINGs → `isExportable: true`, `warningCount > 0`.
4. Sort order across a mixed set of 8 findings matches the stated order exactly.
5. Duplicate rule code registration throws with a message naming the code.
6. A rule that throws produces `E7501.ENGINE.RULE_ERROR`, and a later rule's finding is still present.
7. Same draft + same rules → identical `ValidationResult` JSON across 10 runs.

---

## U6 — 7501 rule pack

**Files:** `src/modules/entrySummary/validation/rules7501.ts`

**Goal.** The actual validation content. Each rule is independently testable.

### Required rules (minimum set — each is one atomic sub-task)

**Structural / presence (BLOCKING)**
- `E7501.B01.FILER_CODE_MISSING` — no filer code from profile.
- `E7501.B02.ENTRY_TYPE_INVALID` — entry type not resolvable via `requireEntryTypeCode`.
- `E7501.B06.PORT_MISSING` / `E7501.B06.PORT_FORMAT` — missing, or not 4 digits.
- `E7501.B23.IMPORTER_NUMBER_MISSING` / `E7501.B23.IMPORTER_NUMBER_FORMAT` — must match IRS EIN (`NN-NNNNNNNNXX`), SSN, or CBP-assigned format.
- `E7501.B04.BOND_MISSING` — entry type requires a bond and none is linked.
- `E7501.BOND.EXPIRED` — linked bond `expirationDate` before entry date, or `status !== "Active"`.
- `E7501.POA.NOT_ACTIVE` — no active `PowerOfAttorney` for the IOR at entry date.
- `E7501.B27.NO_LINES` — zero line items.
- `E7501.B29.HTS_MISSING` (per line) — no HTS.
- `E7501.B29.HTS_FORMAT` (per line) — not 10 digits (formatted `NNNN.NN.NNNN`).
- `E7501.B10.ORIGIN_MISSING` (per line) — no country of origin.
- `E7501.B10.ORIGIN_NOT_ISO` (per line) — not a valid ISO 3166-1 alpha-2 code.
- `E7501.B32.VALUE_NONPOSITIVE` (per line) — entered value ≤ 0.
- `E7501.B31.QTY_MISSING` (per line) — HTS requires a quantity unit and none supplied.

**Arithmetic (BLOCKING)**
- `E7501.TOTALS.LINE_SUM_MISMATCH` — `B35` ≠ Σ line `B32.A`.
- `E7501.TOTALS.GRAND_TOTAL_MISMATCH` — `B40` ≠ `B37` + `B38` + Σ `B39`.

**Cross-field consistency (BLOCKING)**
- `E7501.B09.MODE_TRANSPORT_INVALID` — mode not in CBP's mode-of-transport code set.
- `E7501.HMF.MODE_MISMATCH` — HMF assessed on a non-ocean mode, or ocean mode with no HMF.
- `E7501.B14.EXPORT_COUNTRY_MISSING`.
- `E7501.B11.IMPORT_DATE_AFTER_SUMMARY_DATE`.

**Advisory (WARNING)**
- `W7501.B29.LOW_CONFIDENCE` (per line) — HTS provenance is `DOCUMENT`/`AGENT` with confidence < 85 and no `FieldApproval`.
- `W7501.PROVENANCE.UNVERIFIED` — any BLOCKING-adjacent block whose only source is `DOCUMENT` with no human confirmation.
- `W7501.B13.MID_MISSING` — manufacturer ID absent.
- `W7501.PGA.FLAG_UNRESOLVED` — an open `PgaRequirement` for a line's HTS.
- `W7501.EXCEPTIONS.OPEN_BLOCKING` — an open blocking `ExceptionItem` on the shipment (mirrors `FilingBlockerCode.BLOCKING_EXCEPTIONS`).

### Acceptance criteria
- Each rule's `message` states the observed value or a count ("HTS is 8 digits: `8481.80.50`"), never an adjective ("HTS looks wrong").
- Each rule's `remediation.anchor` is a real route in the shipment workspace.
- Rule codes are frozen. A test asserts the exported code list against a checked-in snapshot so renames are caught in review.
- `FilingBlockerCode` values from `modules/filing/filingReadiness.ts` map 1:1 onto a `E7501.*` code — a test asserts total coverage.

### Test cases — `tests/entry-summary-rules-7501.test.ts`
One `describe` block per rule, each with: a fixture that **fires** it, a fixture that **does not**, and an assertion on `message` content and `severity`. Plus:
1. Snapshot test of the full rule-code list.
2. `FilingBlockerCode` → `E7501` mapping coverage test.
3. A fully valid golden draft produces **zero** BLOCKING findings.
4. HTS format table test: `8481.80.5090` passes; `8481.80.50`, `84818050900`, `8481-80-5090`, `""` each fail with distinct messages.
5. Bond expiring the day *after* entry date passes; the day *before* fires `BOND.EXPIRED`.
6. Low-confidence HTS with a `FieldApproval` present → `W7501.B29.LOW_CONFIDENCE` does **not** fire.

---

## U7 — Draft persistence and versioning

**Files:** `prisma/schema.prisma`, `src/modules/entrySummary/draft.service.ts`

### Schema

```prisma
model EntrySummaryDraft {
  id             String   @id @default(cuid())
  accountId      String
  shipmentId     String
  filingId       String?              // links to CustomsFiling once one exists
  version        Int                  // 1-based, monotonic per shipment
  draftData      Json                 // the EntrySummaryDraft from U1/U3
  validationData Json                 // the ValidationResult from U5
  isExportable   Boolean
  blockingCount  Int
  warningCount   Int
  generatedBy    String               // userId or "SYSTEM"
  supersededAt   DateTime?
  approvedAt     DateTime?
  approvedBy     String?
  inputHash      String               // hash of AssemblerInput, for change detection
  createdAt      DateTime @default(now())

  exports FilerExport[]

  @@unique([shipmentId, version])
  @@index([accountId, shipmentId])
  @@index([filingId])
}
```

### Acceptance criteria
- Regenerating creates a **new version**; prior versions are never mutated. `supersededAt` is stamped on the previous version in the same transaction.
- `inputHash` is a stable hash of the normalized `AssemblerInput`. If it matches the latest version's hash, `generateDraft` returns the existing version and does **not** create a new row (idempotent regeneration).
- `approvedAt`/`approvedBy` can only be set on a version with `isExportable: true`. Attempting otherwise throws `DraftNotExportable`.
- An approved version is immutable: any write attempt other than linking a `FilerExport` throws `DraftLocked`.
- Version numbering is safe under concurrency — use a transaction with a unique-constraint retry, not a read-then-write.

### Test cases — `tests/entry-summary-draft-service.test.ts`
1. First generation → version 1, `supersededAt: null`.
2. Regenerate with changed input → version 2; version 1 gets `supersededAt` set.
3. Regenerate with **unchanged** input → returns version 1, no version 2 created, row count unchanged.
4. Approve an exportable draft → `approvedAt`/`approvedBy` set.
5. Approve a draft with `blockingCount: 3` → throws `DraftNotExportable`; nothing written.
6. Mutating an approved draft's `draftData` → throws `DraftLocked`.
7. Two concurrent `generateDraft` calls → versions 1 and 2, never two rows at version 1 (`@@unique` holds; assert no unhandled rejection).
8. Cross-account read of another account's draft returns not-found.

---

## U8 — CSV serializer

**Files:** `src/modules/entrySummary/serializers/csv.ts`

**Goal.** Emit a two-section CSV (header record + line records) shaped by `FilerProfile.fieldMap`.

### Acceptance criteria
- Signature: `serializeCsv(draft: EntrySummaryDraft, profile: FilerProfile): { filename: string; contentType: string; body: string }`. No DB, no I/O.
- Column order, headers, and inclusion come from `profile.fieldMap`. A block not in the map is not emitted.
- RFC 4180 quoting: fields containing `,`, `"`, `\r`, or `\n` are quoted and internal `"` doubled. Line terminator `\r\n`.
- **CSV injection defense:** a value starting with `=`, `+`, `-`, `@`, tab, or CR is prefixed with `'`. This is mandatory — these files open in Excel on a broker's desktop.
- `null` renders as the empty string, never `"null"`, `"undefined"`, `"N/A"`, or `0`.
- Money rendered with exactly 2 decimals, no thousands separators, no currency symbol.
- Dates rendered per `profile.fieldMap.dateFormat` (default `MMDDYYYY`).
- Filename pattern from the profile, default `{filerCode}_{shipmentNumber}_v{version}.csv`.

### Test cases — `tests/entry-summary-csv.test.ts`
1. Header row matches `fieldMap` order exactly.
2. Description `Valve, 1/2" NPT` → `"Valve, 1/2"" NPT"`.
3. Multiline description stays one CSV record (quoted) and parses back to one row via a CSV parser.
4. Injection: description `=cmd|'/c calc'!A1` → output starts `'=cmd`.
5. Injection cases for `+`, `-`, `@`, leading tab.
6. `null` → empty field; assert the literal strings `null`/`undefined`/`N/A` appear nowhere in the body.
7. Money `1234.5` → `1234.50`; `1234567.891` → `1234567.89`.
8. 3 lines + 1 chapter-99 child → 4 line records, child immediately after its parent.
9. Zero lines → header row only, no trailing blank record.
10. Filename for filer `ABC`, shipment `SHP-2026-004872`, version 3 → `ABC_SHP-2026-004872_v3.csv`.
11. Determinism: same draft/profile → byte-identical body across 10 runs.

---

## U9 — EDI / CATAIR serializer

**Files:** `src/modules/entrySummary/serializers/catair.ts`

**Goal.** Emit fixed-length CBP CATAIR-style Entry Summary (AE) application records, driven by a record layout in `profile.fieldMap`.

> **Note for the implementing agent:** most brokers' ABI filers accept a proprietary flat file rather than raw CATAIR. Implement the layout as *data* (`fieldMap.records[].fields[] = { blockId, start, length, justify, pad, type }`) so a second filer's layout is a config change. Ship one reference layout (`catair-ae-2024.1`) as a fixture. Do **not** hardcode offsets in TypeScript.

### Acceptance criteria
- Signature mirrors U8: `serializeCatair(draft, profile) → { filename, contentType, body }`.
- Every output record is **exactly** the layout's declared length — pad or fail, never silently truncate a shorter record.
- Numeric fields: right-justified, zero-padded, **implied decimal** (no `.`), sign per layout. Alpha fields: left-justified, space-padded, uppercased.
- Over-length value ⇒ throws `FieldOverflow` naming block, value, and max length. **Never truncate silently.**
- Record sequence numbers are assigned by an injected `sequence` port (C4), monotonic from 1.
- Control/trailer record carries an accurate record count and a total-value control sum matching `B35`.
- Non-ASCII characters are transliterated to ASCII per an explicit table; anything untransliterable throws `UnsupportedCharacter` rather than emitting `?`.

### Test cases — `tests/entry-summary-catair.test.ts`
1. Every emitted record's `.length` equals the layout length (assert per record, not just the first).
2. Alpha field `"Acme"` in a 10-wide field → `"ACME      "`.
3. Numeric `1234.56` in a 9-wide implied-2-decimal field → `"000123456"`.
4. Numeric `0` → all zeros, not spaces.
5. Value too long for its field → throws `FieldOverflow` with block id and lengths in the message; assert no partial output was returned.
6. `null` value → field is spaces (alpha) or zeros (numeric) per layout, per an explicit `nullPolicy`.
7. Trailer record count equals actual emitted record count on a 40-line fixture.
8. Trailer control sum equals `B35` to the cent.
9. Sequence numbers 1..N with no gaps, using an injected counter.
10. `"Müller GmbH"` → `"MULLER GMBH"`; an emoji in a description → throws `UnsupportedCharacter`.
11. Golden file: fixture draft serializes byte-identically to `tests/fixtures/7501/catair-ae-golden.txt`.
12. Determinism across 10 runs with a fixed sequence port.

---

## U10 — JSON API serializer

**Files:** `src/modules/entrySummary/serializers/json.ts`

**Goal.** A stable, versioned JSON envelope for filers with a REST API.

### Acceptance criteria
- Envelope: `{ schemaVersion, generatedAt, filerCode, source: { shipmentId, draftId, draftVersion }, entrySummary: {...}, provenance: {...}, validation: { warnings } }`.
- `schemaVersion` is a literal constant; changing it is a breaking change requiring a new constant, not an edit.
- Money as **strings** (`"1234.50"`), never JSON numbers — floats corrupt cents.
- `provenance` is included by default (product promise, C3) but suppressible via `profile.fieldMap.includeProvenance: false` for filers that reject unknown keys.
- BLOCKING findings are never present — an unexportable draft cannot reach this serializer (guard + throw).
- Key order is stable (build the object literally, or sort keys) so the body hashes consistently.

### Test cases — `tests/entry-summary-json.test.ts`
1. `schemaVersion` matches the exported constant.
2. Money fields are strings; assert `typeof === "string"` and `/^\d+\.\d{2}$/` across all monetary keys.
3. `includeProvenance: false` → no `provenance` key anywhere (deep scan).
4. `includeProvenance: true` → every populated block has a provenance entry with a non-`MISSING` source.
5. Serializing a draft with `isExportable: false` throws `DraftNotExportable`.
6. Warnings are carried through; blocking findings are absent even if present on the draft record.
7. `JSON.stringify` output is byte-identical across 10 runs (stable key order).
8. Output validates against the checked-in JSON Schema in `tests/fixtures/7501/filer-api.schema.json`.

---

## U11 — Export dispatch and idempotency

**Files:** `prisma/schema.prisma`, `src/modules/entrySummary/export.service.ts`

### Schema

```prisma
model FilerExport {
  id              String   @id @default(cuid())
  accountId       String
  draftId         String
  draft           EntrySummaryDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  filerProfileId  String
  filerProfile    FilerProfile @relation(fields: [filerProfileId], references: [id], onDelete: Restrict)
  format          String
  transport       String
  status          String   // Pending | Delivered | Failed | Superseded
  idempotencyKey  String
  payloadHash     String   // sha256 of the emitted body
  payloadSize     Int
  storageUrl      String?  // blob URL of the exact bytes sent
  attemptCount    Int      @default(0)
  lastError       String?
  requestedBy     String
  deliveredAt     DateTime?
  createdAt       DateTime @default(now())

  @@unique([accountId, idempotencyKey])
  @@index([draftId])
  @@index([accountId, status])
}
```

### Acceptance criteria
- `idempotencyKey = sha256(draftId + filerProfileId + format)`. A repeat request returns the existing `FilerExport` and **does not re-deliver**. Reuse the existing `IdempotencyRecord` pattern if it fits; otherwise this unique constraint is the mechanism.
- Export is refused unless the draft is `isExportable: true` **and** `approvedAt != null`. Two separate guards, two separate errors.
- The exact bytes sent are persisted to blob storage (`@vercel/blob`, per `src/lib/storage.ts`) and hashed. The stored bytes are what a later audit reproduces.
- Transports:
  - `DOWNLOAD` — no external call; status goes `Pending → Delivered` on first authenticated fetch of the bytes.
  - `SFTP` / `HTTPS_WEBHOOK` — behind a `FilerTransport` interface with a real implementation and an in-memory fake for tests. **Never** put payload content in a URL or query string.
- Retries: exponential backoff, max 3 attempts, `attemptCount` incremented per attempt, `lastError` recording the last failure. After 3, status `Failed` and a `Notification` is raised to the assigned broker.
- Delivery failure never mutates the draft. The draft remains approved and re-exportable under a new key only after an explicit operator "retry export" action.
- Regenerating the draft marks existing exports for prior versions as `Superseded`.

### Test cases — `tests/entry-summary-export-service.test.ts`
1. Export an approved, exportable draft → `FilerExport` with `status: Delivered`, non-null `payloadHash`, `storageUrl`.
2. Same request twice → one row, transport fake invoked **once**.
3. Export a draft with `approvedAt: null` → throws `DraftNotApproved`; no row created.
4. Export a draft with `blockingCount > 0` → throws `DraftNotExportable`; distinct error from #3.
5. Transport fails 3× → `attemptCount: 3`, `status: Failed`, `lastError` set, one `Notification` created.
6. Transport fails twice then succeeds → `status: Delivered`, `attemptCount: 3`.
7. `payloadHash` equals sha256 of the bytes fetched back from `storageUrl`.
8. Regenerating the draft to v2 → v1's exports become `Superseded`.
9. Same draft exported as CSV and as CATAIR → two rows, different idempotency keys, both `Delivered`.
10. Cross-account: account B cannot fetch account A's export bytes (404, not 403 leak).
11. A transport failure leaves the draft `approvedAt` intact.

---

## U12 — HTTP API surface

**Files:** `src/app/api/shipments/[id]/entry-summary/route.ts`, `.../entry-summary/validate/route.ts`, `.../entry-summary/export/route.ts`, `src/app/api/filer-profiles/route.ts`

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/api/shipments/[id]/entry-summary` | Load inputs, assemble (U3), compute duty (U4), validate (U6), persist a version (U7). Returns draft + validation. Idempotent on unchanged input. |
| `GET` | `/api/shipments/[id]/entry-summary` | Latest non-superseded draft + validation. `?version=N` for a specific version. |
| `POST` | `/api/shipments/[id]/entry-summary/approve` | Sets `approvedAt`/`approvedBy`. Requires a filing-approval permission. |
| `POST` | `/api/shipments/[id]/entry-summary/export` | Body `{ filerProfileId, format }`. Dispatches (U11). Returns `FilerExport`. |
| `GET` | `/api/filer-exports/[id]/payload` | Streams the stored bytes. Marks `DOWNLOAD` exports delivered. |
| `GET/POST` | `/api/filer-profiles` | List/create profiles (U2). |

### Acceptance criteria
- All routes use `withAuthenticatedRoute` and `validatePathParams` / zod body validation, matching existing route conventions.
- **Deprecate and remove** `src/app/api/filing/[id]/entry-summary/route.ts`. Return `308` to the new route for one release (the codebase already uses 308s for legacy routes), then delete. Its hardcoded fallbacks must not survive.
- Approve and export require distinct permissions; a user with read-only access gets `403`.
- Errors return the codebase's standard error envelope with a stable `code`, not raw messages.
- `POST /entry-summary` on a shipment with zero line items still returns `200` with a draft whose validation carries `E7501.B27.NO_LINES` — validation failure is data, not an HTTP error.

### Test cases — `tests/entry-summary-api.test.ts`
1. `POST` → `200`, body contains `draftId`, `version: 1`, `validation.isExportable`.
2. `POST` twice unchanged → same `draftId`, `version: 1`.
3. `GET` with no draft → `404` with code `NO_DRAFT`.
4. `GET ?version=1` after regeneration returns v1 with `supersededAt` set.
5. Unauthenticated → `401`; wrong account → `404` (not `403`, to avoid existence leak).
6. Read-only user calling `approve` → `403`.
7. `export` with an unknown `filerProfileId` → `400`, code `FILER_PROFILE_NOT_FOUND`.
8. Legacy `/api/filing/[id]/entry-summary` → `308` with the new `Location`.
9. Shipment with zero lines → `200`, not `422`, with `E7501.B27.NO_LINES` present.
10. `export` before `approve` → `409`, code `DRAFT_NOT_APPROVED`.

---

## U13 — UI: draft review and export

**Files:** `src/app/app/shipments/[id]/EntrySummaryDraft*.tsx`

**Goal.** A broker reviews the 7501 side-by-side with its evidence, then exports.

### Acceptance criteria
- Renders as a 7501-shaped form: header blocks in CBP block order with block numbers visible, then a line table (`B27`–`B34`).
- Each populated field shows a provenance affordance — hover/click reveals source, document name + page, confidence, and who confirmed it. This is the differentiator; it ships in v1, not later.
- `MISSING` fields render visibly empty with the block number and a "no source" marker — never a placeholder value.
- Validation panel: BLOCKING findings first, each with its `code`, message, and a remediation link that scrolls to / deep-links the offending block or line.
- Export button is **disabled** while `blockingCount > 0`, with the count as the reason. Warnings do not disable it but require an explicit acknowledgement checkbox.
- Approve is a distinct, deliberate action separate from export, and shows the declarant name/title going onto `B40`–`B42`.
- Stale-draft banner when the shipment changed after the draft was generated (compare `inputHash`), with a Regenerate action.
- Export produces a visible `FilerExport` record with status, timestamp, filer name, format, and a download link to the exact bytes sent.

### Test cases — `tests/entry-summary-ui.test.tsx` + `e2e/entry-summary.spec.ts`
1. Draft with 3 blocking findings → export button disabled, count shown.
2. Zero blocking, 2 warnings → export enabled only after the acknowledgement checkbox.
3. Clicking a finding's remediation link focuses the corresponding block/line.
4. Provenance popover for an extracted field shows document name, page, and confidence.
5. A `MISSING` block renders empty — assert no `"N/A"`, `"—"`-as-value, or fabricated default in the DOM.
6. Stale banner appears when `inputHash` differs; hidden when it matches.
7. E2E: upload docs → generate draft → resolve a blocking finding → regenerate → approve → export CSV → download and assert the file's line count.

---

## U14 — Audit, state machine, and snapshot integration

**Files:** `src/modules/entrySummary/*.ts`, `src/modules/filings/filingStateMachine.ts`

### Acceptance criteria
- `createAuditLog` entries for: draft generated (with version + blocking count), draft approved (with approver), export dispatched (with filer, format, `payloadHash`), export failed (with error).
- Filing status transitions use the **existing** `filingStateMachine.ts` transitions — no new statuses:
  - draft generated with blocking findings → `validate.fail` → `ValidationFailed`
  - draft generated clean → `validate.pass` → `ReadyForBrokerReview`
  - draft approved → `broker.approve` → `BrokerApproved`
  - export delivered → `transmit.queue` → `TransmissionPending`
- Qubere **never** drives `Transmitted`, `Accepted`, or `Released` from this feature. Those are CBP-controlled and arrive via the filer's response, not from an export succeeding.
- On approval, write a `FilingSnapshot` (existing model) containing the immutable `draftData` + `validationData`, so the entry is reconstructable years later.
- A `ShipmentEventLog` entry per user-visible step.

### Test cases — `tests/entry-summary-integration.test.ts`
1. Generating a draft with blockers moves the filing to `ValidationFailed`.
2. Generating a clean draft moves it to `ReadyForBrokerReview`.
3. Approval moves it to `BrokerApproved` and writes a `FilingSnapshot`.
4. Export delivery moves it to `TransmissionPending` and **not** to `Transmitted`.
5. An illegal transition (export from `Draft`) is rejected by the state machine, and no `FilerExport` row is created.
6. `FilingSnapshot.snapshotData` deep-equals the approved draft's `draftData`.
7. Audit log contains exactly one entry per step with the correct actor.
8. Export failure produces an audit entry and does not transition the filing.

---

## U15 — Golden-file and round-trip conformance suite

**Files:** `tests/entry-summary-conformance.test.ts`, `tests/fixtures/7501/`

**Goal.** Prove the three serializers describe the same entry.

### Fixtures (checked in)
- `simple-single-line.json` — one line, ad valorem, ocean.
- `multi-line-25.json` — 25 lines, mixed rates, MPF ceiling.
- `chapter99-301.json` — 301 additional duties.
- `air-no-hmf.json` — air mode.
- `blocking-invalid.json` — missing HTS + bad importer number.
- Golden outputs: `*.csv`, `*.catair.txt`, `*.json` per fixture.

### Acceptance criteria
- Cross-format equivalence: for each valid fixture, `B35`, `B37`, `B38`, `B39`, `B40`, and the line count parsed back out of CSV, CATAIR, and JSON are **equal to the cent**.
- Golden files are byte-compared. A diff fails the test; regeneration is an explicit, reviewed act (`UPDATE_GOLDEN=1`).
- Every golden file has a companion assertion that no fabricated default (`CBP-998877`, `BND-500123`, `2704` unless genuinely sourced, `Germany` unless genuinely sourced) appears in it.

### Test cases
1. Byte-compare each fixture × each format against its golden file.
2. Cross-format total equivalence for all valid fixtures.
3. Line-count equivalence across formats, including chapter 99 children.
4. `blocking-invalid.json` cannot be serialized in any format — all three throw `DraftNotExportable`.
5. Fabricated-default scan across every golden file.
6. Each fixture serialized 10× produces identical bytes.

---

## Definition of done

- [ ] `npm test` green; new tests cover every unit above.
- [ ] `npm run lint` and `npm run typecheck:workspaces` clean.
- [ ] Prisma migration written **and** the PR states it must be applied via `prisma migrate deploy` before the code is enabled (see C9 — prior migrations in this repo have shipped unapplied).
- [ ] Legacy `/api/filing/[id]/entry-summary` returns `308`; its hardcoded fallbacks are gone from the codebase (grep for `CBP-998877`, `BND-500123` returns nothing outside test fixtures).
- [ ] A broker can go from a document-complete shipment to a downloaded, filer-ready payload without leaving the shipment workspace.
- [ ] No code path in this feature writes a CBP entry number, `Transmitted`, `Accepted`, or `Released`.

## Suggested build order

1. **U1 → U3 → U5 → U6** — the draft and its validation. This is the product. Everything else is plumbing.
2. **U4** in parallel with U5 (independent).
3. **U2 → U8** — get one format end-to-end and demoable.
4. **U7 → U12 → U13** — persist and surface it.
5. **U9, U10** — remaining formats against the now-stable draft.
6. **U11 → U14 → U15** — dispatch, audit, conformance.
