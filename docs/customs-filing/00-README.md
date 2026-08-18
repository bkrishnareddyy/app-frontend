# Customs Filing Module — Documentation Package

A complete reference for the customs-filing module: what it does, how it's built, what's in the
database, how to onboard a new country, how the admin configuration UI works, how the canonical
message schemas are versioned, and an honest gap analysis against production-readiness.

Every claim in every section is grounded in the actual source code, cited as `file:line`. Where
something doesn't exist yet (a real customs-authority integration, retry/backoff, a second
regime), that's stated plainly rather than glossed over — this package documents current behavior,
not aspiration.

## Contents

1. **[Functional overview](01-functional-overview.md)** — what the module does today: the full
   functional inventory, supported entry types, the end-to-end declaration lifecycle (create →
   validate → transmit → respond → resubmit/cancel → close), and the validation rules
   `filingValidator.ts` actually enforces.
2. **[Architecture](02-architecture.md)** — the component map (with a diagram), message routing
   logic, the Postgres-backed queue's real mechanics, the full API surface, and an honest account
   of what "integration with customs authorities" means today (a dev-only stub, not a real
   connection).
3. **[Database schema](03-database-schema.md)** — every column of every filing-related table
   (`CustomsFiling`, `FilingMessage`, `FilingSnapshot`, `CustomsResponse`,
   `FilingActionDataRequirement`, and the seven reference/config tables, plus `Shipment` and its
   line items/documents), each with data type, constraints, business meaning, and exactly which
   code reads or writes it.
4. **[New country onboarding](04-new-country-onboarding.md)** — a practical runbook, grounded in
   the real Germany rollout, for adding a country: which reference-table rows to populate, in what
   order, worked examples from the actual seed data, and the honest limits (new action types and
   new statuses still require a code change; only their country-specific mapping is data-driven).
5. **[UI configuration](05-ui-configuration.md)** — how the single generic Filing Configuration
   admin screen renders a form for any registered table from a `TableDef`/`FieldDef` schema, how
   the recursive field-array editor handles arbitrarily nested grids, and what genuinely still
   requires a UI code change (e.g. new field input types).
6. **[Canonical schema management](06-canonical-schema-management.md)** — how the JSON Schema
   contracts for the message envelope/declaration/response are versioned, where validation
   actually runs, and what does/doesn't require a schema bump when a new procedure or message type
   is introduced.
7. **[Gap analysis & field review](07-gap-analysis.md)** — every real gap surfaced while writing
   this package (missing retry logic, single-regime coverage, no real authority integration, a
   data bug in the Germany seed rows, decorative config fields, stale documentation elsewhere in
   the repo), plus a direct review of the Filing Configuration screen's fields for redundancy and
   unclear meaning, and a prioritized list of what to fix first.

## How this relates to existing docs

This package builds on, and doesn't duplicate, two existing documents:

- `docs/shipment-filing-workflow-analysis.md` — broader shipment/filing architecture context.
  Section 01 notes two places where it's drifted from the current code (a `PartiallyReleased`
  status that no longer exists, a `Preparing` state no route actually drives).
- `docs/customs-filing-canonical-messaging-changelog.md` — the phase-by-phase implementation
  history of the canonical-messaging layer, including the real Germany onboarding this package's
  country-onboarding guide is grounded in.
