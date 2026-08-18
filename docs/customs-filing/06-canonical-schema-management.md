# Canonical Schema Management

This document covers how the customs-filing module defines, versions, and enforces the shape of the messages it exchanges with third-party filing systems: the "canonical" envelope header, the outbound declaration data, and the inbound response data.

## 1. What a "canonical schema" is here

There are exactly three schema types, defined as a union in `src/lib/canonicalMessaging/types.ts:127-130`:

```ts
export type CanonicalSchemaType =
  | "ENVELOPE_HEADER"
  | "FILING_REQUEST_DECLARATION"
  | "FILING_RESPONSE_DATA";
```

Each corresponds to one JSON Schema file family under `schemas/customs-filing/`:

- `ENVELOPE_HEADER` -> `schemas/customs-filing/envelope-header/1.0.0.json`, mirrors `CanonicalMessageHeader` (`types.ts:25-47`)
- `FILING_REQUEST_DECLARATION` -> `schemas/customs-filing/filing-request-declaration/{1.0.0,1.0.1}.json`, mirrors `CanonicalCustomsDeclaration` (`types.ts:69-108`), wrapped for outbound use as `CanonicalFilingRequestData` (`types.ts:110-112`)
- `FILING_RESPONSE_DATA` -> `schemas/customs-filing/filing-response-data/1.0.0.json`, mirrors `CanonicalFilingResponseData` (`types.ts:114-120`)

Both request and response bodies travel inside `CanonicalMessage<T>` (`types.ts:122-125`), i.e. `{ header: CanonicalMessageHeader; data: T }`.

The relationship between the two artifacts is stated directly in the doc comment at the top of `types.ts:1-8`:

> "These mirror schemas/customs-filing/*/1.0.0.json exactly. The JSON Schema files are the source of truth for validation (see schemaValidator.ts); these types exist so application code gets compile-time checking against the same shape, not because the type is authoritative on its own."

In other words: `types.ts` gives you IDE/compiler safety while writing code, but it is never consulted at runtime. Every message that actually crosses the publisher/consumer boundary is checked against the JSON Schema file, not the TypeScript interface. All three JSON Schema files declare `"$schema": "https://json-schema.org/draft/2020-12/schema"` (e.g. `schemas/customs-filing/envelope-header/1.0.0.json:2`) — draft 2020-12 throughout.

## 2. How versioning works

The `FilingSchemaVersion` model (`prisma/schema.prisma:3922-3934`) has these columns:

```
id                   String    @id @default(cuid())
schemaType           String    // ENVELOPE_HEADER | FILING_REQUEST_DECLARATION | FILING_RESPONSE_DATA
version              String    // semver, e.g. "1.0.0"
schemaJson           Json
status               String    @default("DRAFT") // DRAFT, ACTIVE, DEPRECATED, RETIRED
effectiveFrom        DateTime  @default(now())
supersedesVersionId  String?
createdAt            DateTime  @default(now())

@@unique([schemaType, version])
@@index([schemaType, status])
```

Note: the status column's own comment lists `DRAFT, ACTIVE, DEPRECATED, RETIRED`, but the code that actually writes rows (`scripts/seed-canonical-messaging.ts:39,44,50`) only ever uses `ACTIVE` and `SUPERSEDED` — `DEPRECATED`/`RETIRED` appear in the model comment but not in any code path read for this document.

"ACTIVE" resolution happens in `getActiveValidator()` in `src/lib/canonicalMessaging/schemaValidator.ts:21-42`: it queries `db.filingSchemaVersion.findFirst({ where: { schemaType, status: "ACTIVE" }, orderBy: { effectiveFrom: "desc" } })` (`schemaValidator.ts:22-25`). If no row is found it throws (`schemaValidator.ts:26-28`). The matched row's `schemaJson` is compiled into an Ajv validator and cached by `"{schemaType}@{version}"` (`schemaValidator.ts:30-41`). `getActiveSchemaVersion(type)` (`schemaValidator.ts:45-48`) just returns the resolved version string, documented as being "for stamping on an outbound header, not for validation."

Schema JSON files are named by version: `schemas/customs-filing/<type-dir>/<version>.json`, e.g. `filing-request-declaration/1.0.0.json` and `filing-request-declaration/1.0.1.json`.

### The 1.0.0 -> 1.0.1 diff for `filing-request-declaration`

The seed script's own comment (`scripts/seed-canonical-messaging.ts:26-28`) summarizes the change:

> "1.0.1: entryType's description no longer names CBP specifically, and compliance.uflpaCleared (a single US statute hardcoded into the 'canonical' contract) was replaced by a generic complianceFlags map."

Comparing the two files directly:

- `entryType` description text changed from referencing "CBP entry-type code" to a country-neutral description that routes through `FilingProcedureMapping` (compare `filing-request-declaration/1.0.0.json:8-11` to `1.0.1.json:8-11`).
- `compliance` object: 1.0.0 has a hardcoded boolean property `uflpaCleared` alongside `screeningCleared` and `licensesRequired` (`1.0.0.json:64-72`). 1.0.1 removes `uflpaCleared` entirely and adds `complianceFlags: { type: "object", additionalProperties: { type: "boolean" } }` (`1.0.1.json:64-79`), a generic per-destination flag bag (matches `CanonicalCustomsDeclaration.compliance.complianceFlags` in `types.ts:96-101`).
- Everything else — `$defs.party`, `$defs.lineItem`, `totals`, `valuation`, `transport`, required-field list (`["declarationId", "entryType", "lineItems", "totals"]`) — is byte-for-byte identical between the two versions.

This is the concrete precedent for what a schema evolution "should" look like: a narrowly-scoped, additive-or-renaming change to one nested object, with the rationale captured in the seed script comment.

**On "only one ACTIVE row" enforcement**: there is no database constraint for this. `@@unique([schemaType, version])` only prevents duplicate version rows for a type; `@@index([schemaType, status])` is a plain lookup index, not a partial unique index. The only place that ever demotes an old ACTIVE row is application code: `scripts/seed-canonical-messaging.ts:48-51` runs `updateMany({ where: { schemaType, version: { not: entry.version }, status: "ACTIVE" }, data: { status: "SUPERSEDED" } })` immediately after upserting the new version to `ACTIVE`. If two ACTIVE rows for the same `schemaType` were ever inserted outside this script (e.g. a manual `prisma.filingSchemaVersion.create`), `getActiveValidator()`'s `orderBy: { effectiveFrom: "desc" }` (`schemaValidator.ts:24`) would silently pick whichever has the latest `effectiveFrom` — nothing detects or rejects the duplicate. This is convention enforced by the seed script, not a schema-level guarantee.

## 3. Where validation actually runs

**Outbound** — `PgCanonicalMessagePublisher.publish()` in `src/lib/canonicalMessaging/publisher.ts:18-21`:

```ts
async publish(queueName: string, message: CanonicalMessage<CanonicalFilingRequestData>): Promise<void> {
  await validateAgainstActiveSchema("ENVELOPE_HEADER", message.header);
  await validateAgainstActiveSchema("FILING_REQUEST_DECLARATION", message.data.declaration);

  await db.filingMessage.create({ ... });
```

Both header and declaration are validated against whatever is currently ACTIVE *before* the row is persisted with `queueStatus: "PENDING"` (`publisher.ts:22-35`). A validation failure throws `SchemaValidationError` and the row is never written.

**Inbound** — `PgCanonicalMessageConsumer.processOne()` in `src/lib/canonicalMessaging/consumer.ts:25-71`. It first claims one row with `FOR UPDATE SKIP LOCKED` (`consumer.ts:28-41`), then:

```ts
try {
  await validateAgainstActiveSchema("ENVELOPE_HEADER", message.header);
  await validateAgainstActiveSchema("FILING_RESPONSE_DATA", message.data);

  await handler(message);

  await db.filingMessage.update({
    where: { id: row.id },
    data: { queueStatus: "PROCESSED", processedAt: new Date(), status: message.data.status },
  });
} catch (err) {
  const errorMessage = err instanceof SchemaValidationError ? err.message : err instanceof Error ? err.message : String(err);
  await db.filingMessage.update({
    where: { id: row.id },
    data: { queueStatus: "FAILED", errorMessage, attempts: { increment: 1 } },
  });
  throw err;
}
```
(`consumer.ts:47-68`)

A message that fails validation — or fails inside the handler for any other reason — is marked `FAILED` with the error text captured in `errorMessage`, then the original error is rethrown. The class doc comment (`consumer.ts:14-22`) makes the intent explicit: "A message that fails validation is marked FAILED, not silently dropped or coerced."

## 4. How to add or evolve a schema, step by step

1. **Add a new version file.** Create `schemas/customs-filing/<type-dir>/<new-version>.json` (e.g. `filing-request-declaration/1.1.0.json`). Never edit an existing version file in place — the seed script's comment is explicit that "a real shape change is a new version file, never an in-place edit of an old one" (`scripts/seed-canonical-messaging.ts:20-23`). Keep the `$schema` draft (`2020-12`) and the `$id` naming convention consistent with the existing files.
2. **Insert/flip the `FilingSchemaVersion` row.** Add an entry to the `entries` array in `seedSchemas()` (`scripts/seed-canonical-messaging.ts:24-31`) pointing at the new version, and rerun the script. It upserts the new row as `ACTIVE` and demotes every other row of that `schemaType` to `SUPERSEDED` (`scripts/seed-canonical-messaging.ts:37-51`). As noted in section 2, this demotion is a manual application-level step performed by this script — there's no DB constraint backing it, so any other code path that inserts a `FilingSchemaVersion` row must replicate this "flip the old one" logic itself.
3. **Update the matching TypeScript type in `types.ts`.** Even though the type isn't authoritative at runtime, the doc comment at `types.ts:1-8` frames it as existing so "application code gets compile-time checking against the same shape." Letting it drift from the real JSON Schema defeats that purpose — a developer relying on the compiler would get false confidence. Update `CanonicalCustomsDeclaration`/`CanonicalMessageHeader`/`CanonicalFilingResponseData` (whichever corresponds) to match the new JSON Schema's properties and `required` list.
4. **Keep the old version's JSON file around.** `FilingMessage.envelope.header.schemaVersion` (see `CanonicalMessageHeader.schemaVersion`, `types.ts:42`) is stamped onto every persisted message at the version that was ACTIVE when it was validated. `getActiveValidator()` only ever compiles the *currently* ACTIVE schema (`schemaValidator.ts:22-25,39`) — there is no code path in `schemaValidator.ts` that loads an arbitrary historical version by number. If a historical row needs to be re-validated or replayed after its version has been superseded, the only schema available to validate against is whatever is now ACTIVE, which may reject a payload that was perfectly valid under its own `schemaVersion`. Deleting an old version's JSON file doesn't break `getActiveValidator()` directly (it never reads old files after they've been superseded), but it does destroy the only record of what the historical shape actually was, which matters for audits, migrations, or any future tool that wants to validate a message against the schema it was actually built for.

## 5. Impact analysis when a new procedure or message type is introduced

- **New (country, procedure, messageName) combination** — e.g. onboarding Germany, as `seedGermanyConfig()` does (`scripts/seed-canonical-messaging.ts:94-115`). This needs **no schema change**. `FilingProcedureMapping`, `FilingMessageCatalog`, `FilingAuthorityConfig` rows carry the country-specific facts; the envelope header and declaration shapes (`ENVELOPE_HEADER`, `FILING_REQUEST_DECLARATION`) are identical regardless of destination — `country` and `procedure` are just string fields on the existing schema (`envelope-header/1.0.0.json:28-29`). This is pure reference data, not schema versioning.
- **A genuinely new field on the declaration** — e.g. a new compliance flag. This is exactly what the 1.0.0 -> 1.0.1 `filing-request-declaration` change did (section 2): it requires a new schema version file, a new `FilingSchemaVersion` row (via the seed script's `entries` array), and — per the honest caveat in step 4 above — keeping the old version's JSON file around so old-typed rows stamped with `schemaVersion: "1.0.0"` remain interpretable if anything ever needs to validate them against the schema they were actually built under. Both `additionalProperties: false` on `compliance` (`1.0.1.json:78`) and on the declaration root (`1.0.1.json:96`) mean an old-shaped payload with `uflpaCleared` would now fail against the new ACTIVE schema, and a new-shaped payload with `complianceFlags` would have failed against the old one — this is a real forward/backward incompatibility, not just an additive change.
- **A new `FilingMessageAction` value** — e.g. adding a sixth action beyond `SUBMIT | AMENDMENT | CANCELLATION | RESUBMIT | STATUS_INQUIRY` (`types.ts:10-15`). This is a TypeScript union change plus a new `FilingMessageActionCatalog`/`FilingMessageCatalog` row (see `seedMessageActions()`, `scripts/seed-canonical-messaging.ts:56-68`, and `seedMessageCatalog()`, `scripts/seed-canonical-messaging.ts:117-153`). It does **not** by itself require a new `FILING_REQUEST_DECLARATION` or `FILING_RESPONSE_DATA` schema version: `envelope-header/1.0.0.json:17-18` types `messageName` as a plain unconstrained string and `direction` as an enum of only `["OUTBOUND","INBOUND"]` — neither field is tied to the specific action vocabulary, so any new action's messages fit the existing envelope shape, and the request/response DATA schemas don't reference `FilingMessageAction` at all.

**Summary of responsibility split**: reference-table rows (`FilingProcedureMapping`, `FilingMessageCatalog`, `FilingAuthorityConfig`, `FilingResponseStatusMapping`) handle country/procedure/action *data* variability with zero schema impact; the `types.ts` action/status unions handle *which named actions or statuses the code base itself is aware of* and are a compile-time-only concern; the JSON Schema + `FilingSchemaVersion` machinery is reserved strictly for changes to the *shape* of the header, declaration, or response payload — i.e., new/removed/renamed fields, changed types, or changed `required`/`additionalProperties` constraints.
