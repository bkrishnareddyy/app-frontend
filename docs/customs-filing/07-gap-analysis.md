# Customs Filing — Gap Analysis & Field Review

This section synthesizes every gap surfaced while writing the rest of this package (docs
01–06), plus a direct review of the Filing Configuration screen's fields against the "unnecessary /
unclear / overlapping" criteria requested for this package. Every item below is grounded in a real
file/behavior found while writing this documentation — nothing here is speculative. Severity is
rated **Blocker** (prevents real production use), **Real gap** (works today, meaningfully
incomplete), or **Hygiene** (confusing but not functionally broken).

## 1. Missing documentation areas (now filled, and what's still missing)

This package fills the six areas requested: functional inventory (01), architecture/integration
(02), database schema (03), country onboarding (04), UI configuration (05), and canonical schema
management (06). Areas the request explicitly called out that remain thin **in the code itself**,
not just undocumented:

| Area | State | Source |
|---|---|---|
| Error handling | `filing.service.ts` throws plain `Error`/`FilingTransitionError`; API routes catch and map to HTTP status, but there is no structured error taxonomy or user-facing error code catalog beyond `MissingActionFieldError` and a few named errors. | `02-architecture.md` §5, `03-database-schema.md` (FilingMessage.errorMessage) |
| Audit logging | `createAuditLog(...)` exists and is called at some action sites (e.g. cancellation), but not systematically at every state transition — e.g. `buildSnapshotAndPublish` (transmit/resubmit) does not appear to write an audit-log entry, only `FilingMessage`/`filingStatus`. | `01-functional-overview.md` §4 |
| Retry mechanisms | **None exist.** A `FilingMessage` row that fails validation is marked `FAILED` and never retried, backed off, or dead-lettered. | `02-architecture.md` §3 |

## 2. Gaps in workflow coverage

| Gap | Severity | Detail |
|---|---|---|
| `STATUS_INQUIRY` is cataloged but never implemented | Real gap | It's a valid `FilingMessageAction` value and appears in `FilingMessageCatalog` seed rows, but `FilingService` has no method that sends one, and no UI surfaces it. (`01-functional-overview.md`, agent finding) |
| Only one customs regime is modeled | Blocker for multi-regime use | The entire action catalog (`SUBMIT`/`AMENDMENT`/`CANCELLATION`/`RESUBMIT`/`STATUS_INQUIRY`) and every reference table are scoped to a generic consumption-style entry. There is no transit, bonded-warehouse, or excise-movement workflow, and `entryType.ts`'s 18 CBP entry-type codes are labels on one declaration shape, not distinct workflows. (`01-functional-overview.md` §3, and the earlier KCM comparison in this session) |
| No real customs-authority integration | Blocker | Transmission is a synchronous dev-stub (`devStub.ts`) that self-answers `ACCEPTED`/`CANCELLED`. Nothing in the codebase transforms canonical JSON into any real authority's wire format or calls a real external endpoint. The Response tab's "Customs File" preview is explicitly labeled a placeholder. (`02-architecture.md` §4) |
| No retry/backoff/dead-letter policy | Real gap | Covered above — repeated here because it's a workflow-coverage gap, not just an error-handling one: a transient failure silently stops the workflow rather than retrying it. |
| `duty/MPF` calculation is hardcoded to US | Real gap | `computeFilingTariff()` runs unconditionally as a US CBP calculation regardless of `destinationCountry` — flagged in the code itself (`src/app/api/filing/route.ts:395-400`). Germany can complete a filing, but its duty totals are computed as if it were a US entry. |
| `FilingActionDataRequirement` seed data breaks the wildcard convention for DE | Real gap | The seed script keys rows as `country: "US"` rather than the `"*"` wildcard used by every other reference table, so Germany silently resolves to zero extra fields for CANCELLATION/AMENDMENT instead of inheriting a sensible default. This is a data bug, not a design flaw — the mechanism works, the seed row doesn't follow its own convention. (`04-new-country-onboarding.md`) |
| Adding a new action type or status requires a code change | Real gap, by design | `FilingMessageAction`, `FilingStatus`, and `FilingTransition` are closed TypeScript unions. Config can resolve *which* existing action/status applies to a country, but cannot introduce a genuinely new one. This is an honest architectural boundary, not a bug, but it should be understood before promising "any workflow, zero code" to stakeholders. (`04-new-country-onboarding.md` §5-6) |
| `CustomsFiling.releasedAt` has no confirmed writer | Real gap | Read in the filing timeline, compliance-deadline anchoring, and PSC/protest eligibility windows — but no code path in the filing/inbound-consumer modules was found that sets it, including on an `ACCEPTED`/released response. Anything anchored to release date may be silently working off a null. (`03-database-schema.md`) |
| `CustomsResponse.code`/`title` don't match their own schema comment | Hygiene | The Prisma comment documents an `ACK/RFRA/AOC/RELE` vocabulary; the actual write path (`inboundConsumer.ts`) stores the canonical status string (`ACCEPTED`/`REJECTED`/etc.) instead. Anyone filtering on the documented vocabulary will get nothing. (`03-database-schema.md`) |
| `FilingMessageActionCatalog.requiresPriorMessage` is decorative | Hygiene | Reads as a real business rule (e.g. "amendments must reference a prior submission"), but `cancelFiling()`/`resubmitFiling()` enforce the "must have a prior outbound message" check with hardcoded logic, not by reading this flag. It currently does nothing. (`03-database-schema.md`) |
| No business-process/SLA monitoring | Real gap | Nothing alerts on "this filing has sat in `CancellationRequested` for three days." No code path for this was found anywhere in the module. |
| No country-scoped access control | Real gap | RBAC is role-based (`PLATFORM_ADMIN`, account-level roles); nothing scopes a user to specific countries the way a multi-country rollout with regional teams would need. |
| i18n covers UI chrome only | Real gap, by design | Static labels are translated (`en.ts`/`es.ts`); admin-typed field labels/help text in the Filing Configuration screen and canonical-schema field labels are explicitly out of scope, per the comment in `FilingConfigClient.tsx:12-19`. Documented as a deferred decision, not an oversight. |

## 3. Filing Configuration field review

A direct review of the 8 registered tables' fields (`src/modules/filingConfig/registry.ts`)
against the requested criteria: unnecessary fields, unclear/overlapping business meaning, and
simplification opportunities.

### Unclear or overlapping meaning

- **`FilingMessageActionCatalog.requiresPriorMessage` vs. the actual prior-message check.** As
  noted above, this field looks load-bearing but isn't read anywhere. Either wire it into
  `cancelFiling()`/`resubmitFiling()`'s existing hardcoded check, or relabel it clearly as
  documentation-only metadata so an editor doesn't believe changing it changes behavior.
- **`FilingActionRule.allowUpdates` vs. `filingStateMachine.ts`'s own transition guards.** Both
  gate "can this filing still be edited," from two different mechanisms (a config row and a
  hardcoded state-machine transition list). An editor changing `allowUpdates` to `true` on a
  status the state machine still treats as terminal produces a UI that offers an edit button that
  then fails the transition. Worth documenting explicitly in the admin screen's help text which
  one wins, or collapsing to one source of truth.
- **`entryType` (on `CustomsFiling`, `FilingProcedureMapping`) vs. `entryType.ts`'s code/label
  pair.** The stored value is meant to always normalize to a 2-digit code via
  `requireEntryTypeCode()`, but nothing in the schema prevents a raw label string
  (`"Consumption Entry"`) from being stored directly, relying entirely on call-site discipline.
  A CHECK constraint or a Prisma enum would remove the ambiguity.
- **`FilingMessage.status` vs. `FilingMessage.envelope.data.status`.** The top-level `status`
  column is a denormalized copy of the value inside the JSON envelope, kept for indexing/query
  convenience. An editor reading raw data (e.g. via the Response tab's JSON view) may reasonably
  wonder which one is authoritative — worth a one-line comment noting the column is derived, not
  independently meaningful.

### Fields with no current effect (candidates to simplify or remove)

- **`FilingMessageActionCatalog.requiresPriorMessage`** — as above; either wire it in or remove
  it from the editable form so admins aren't tempted to "fix" something by editing a value that
  does nothing.
- **`FilingActionDataRequirement` rows keyed to a specific country instead of `"*"`** — not a
  field problem, a data-hygiene one: the UI doesn't warn an admin that a non-wildcard `country`
  value silently excludes every other country from that row. A simple inline warning ("this row
  only applies to {country} — did you mean `*`?") in `RowFormModal` would have caught the DE
  seed-data bug directly in the tool meant to prevent this class of mistake.

### Opportunities to standardize

- **Adopt one convention for "applies everywhere"** across all seven wildcard-eligible tables and
  document it once in the admin screen itself (a persistent help banner), rather than relying on
  each table's own `help` string in `registry.ts` to repeat "`*` matches any value." The current
  approach is consistent in code but not visibly consistent to someone editing the UI.
- **Give `FilingActionDataRequirement`'s recursive field editor the same date/number input types
  its schema already supports.** `FieldArrayEditor`'s type switch only special-cases
  `boolean`/`select`/`fieldArray`; `"date"` and `"number"` currently render as plain text inputs,
  so an admin can type `"tomorrow"` into a date field with no validation at the UI layer even
  though the underlying type system already models it correctly. (`05-ui-configuration.md`)

## 4. What to prioritize

In order of what actually blocks real use, not what's easiest to fix:

1. **Real customs-authority integration** for at least one country/procedure — nothing else in
   this list matters if the module can't file a real declaration.
2. **Fix the `FilingActionDataRequirement` DE seed row** to use the wildcard convention — a
   one-line data fix that closes a silent country-onboarding gap right now.
3. **Retry/backoff/dead-letter policy** on `FilingMessage` before real volume makes a silently
   stuck `FAILED` row expensive.
4. **Wire or remove `requiresPriorMessage`** and reconcile `allowUpdates` against the state
   machine, so the admin screen doesn't contain fields that look load-bearing but aren't.
5. **Extend beyond one customs regime** using the existing action-catalog mechanism, as the real
   test of whether the country-agnostic design holds up outside the case it was built against.
