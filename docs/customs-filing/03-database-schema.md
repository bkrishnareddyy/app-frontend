# Customs Filing — Database Schema Reference

This is a field-by-field reference for every Prisma model that the customs-filing
module reads or writes. It covers `prisma/schema.prisma` as of this writing.
Every "Used by" cell is grounded in a specific file/function that was actually
read — see the source list at the end of this document.

Sources read for this reference:
- `prisma/schema.prisma`
- `src/modules/filings/filing.service.ts`
- `src/lib/canonicalMessaging/inboundConsumer.ts`
- `src/lib/canonicalMessaging/resolveMessageContext.ts`
- `src/lib/canonicalMessaging/wildcardLookup.ts`
- `src/lib/canonicalMessaging/filingActionRules.ts`
- `src/lib/canonicalMessaging/childActionRules.ts`
- `src/lib/canonicalMessaging/actionDataRequirements.ts`
- `src/app/app/filing/[id]/FilingDetailClient.tsx`
- `src/app/app/filing/[id]/page.tsx`

---

## CustomsFiling

One row per customs entry filed for a shipment. `shipmentId` + `entryNumber` is
the tenant-unique key; `filingStatus` is the state-machine value that gates
every action button in the UI.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key of the filing row. | Referenced everywhere as `filingId` FK target; e.g. `filing.service.ts` `buildSnapshotAndPublish`. |
| `shipmentId` | String | FK → `Shipment.id`, `onDelete: Cascade`, indexed | Which shipment this customs entry declares. A shipment can have more than one `CustomsFiling` (e.g. house/master, or re-filed entries). | `filing.service.ts` loads `filing.shipment` via this relation for snapshot/declaration building; `page.tsx` includes `shipment` for the detail page. |
| `shipment` | relation | → `Shipment` | Object form of the FK above. | Same as above. |
| `accountId` | String | FK → `Account.id`, `onDelete: Cascade`, indexed | Tenant that owns this filing (multi-tenant scoping). | Every `db.customsFiling.findFirst({ where: { id, accountId } })` call in `filing.service.ts` and `page.tsx`. |
| `account` | relation | → `Account` | Object form of the FK above. | Tenant scoping joins. |
| `importerOfRecordId` | String? | FK → `ImporterOfRecord.id`, `onDelete: SetNull` | Which Importer of Record entity is declared for this entry, if one has been assigned. | Not read in the files reviewed here; surfaced via `importerOfRecord` relation elsewhere in the app. |
| `importerOfRecord` | relation | → `ImporterOfRecord`, nullable | Object form of the FK above. | — |
| `bondId` | String? | FK → `Bond.id`, `onDelete: SetNull` | Which customs bond secures this entry, if assigned. | Not read in the files reviewed here. |
| `bond` | relation | → `Bond`, nullable | Object form of the FK above. | — |
| `entryNumber` | String | unique with `accountId` (`@@unique([accountId, entryNumber])`) | Internal entry reference used until the customs authority assigns its own number (see `authorityReference` on the inbound response data, stored inside `FilingMessage.envelope`/`CustomsResponse`). | Displayed as "Entry {entryNumber}" in `FilingDetailClient.tsx`; used in `inboundConsumer.ts`'s default rejection description `Customs filing ${filing.entryNumber} was rejected`. |
| `authority` | String | required, no default | Name/code of the customs authority this entry is filed with (e.g. `CBP`). Deliberately has **no schema default** — resolved per `destinationCountry` from `FilingAuthorityConfig` at creation time in `POST /api/filing`, since hardcoding one country's authority is exactly what this table structure exists to avoid. | `filing.service.ts` `buildMessage()` stamps it into the outbound envelope header; `FilingDetailClient.tsx` displays "Filing Authority: {authority}". |
| `entryType` | String | required | A code from `entryType.ts` describing the type of customs entry (e.g. consumption entry code `"01"`). | `resolveMessageContext.ts` calls `requireEntryTypeCode(filing.entryType)` to normalize it, then looks it up in `FilingProcedureMapping`. |
| `filingType` | String | required | The filing method/channel label (e.g. how the entry is being filed). | Displayed as "Filing Method" in `FilingDetailClient.tsx`. |
| `filingStatus` | String | `@default("Draft")`, indexed | Workflow status of the entry. Documented values: `Draft, Preparing, ValidationFailed, ReadyForBrokerReview, BrokerApproved, TransmissionPending, Transmitted, Accepted, Rejected, DocumentsRequested, CustomsHold, Released, Cancelled, Closed, Simulation`. Never written directly — always through `applyTransition()` in `filingStateMachine.ts`. | Written by `filing.service.ts` (`buildSnapshotAndPublish`, `cancelFiling`) and `inboundConsumer.ts` (`processInboundMessage`, via `FilingResponseStatusMapping` → `applyTransition`). Read by `page.tsx` to compute `canValidate/canApprove/canTransmit/canResubmit` via `canTransition()`, and by the UI badge/timeline in `FilingDetailClient.tsx`. |
| `paymentStatus` | String | `@default("Pending")` | Duty/tax payment state: `Pending, Paid, Deferred`. | Displayed in `FilingDetailClient.tsx` Entry Summary ("Payment Status"). |
| `totalValue` | Decimal? | nullable | Total customs (entered) value of the entry. Null until computed from line items by the duty engine. | `filing.service.ts` copies it into `FilingSnapshotData.filingHeader.totalValue` at transmit time; `FilingDetailClient.tsx` shows it as "Entered Value" / "Customs Value". |
| `totalDuties` | Decimal? | nullable | Total duty owed, computed by `computeFilingTariff()` (`dutyEngine.ts`). Null until calculated. | Read by `FilingDetailClient.tsx` ("Total Duties"), `metricComputer.ts` for analytics, PSC/Protest new-request clients, `dailyComplianceAudit.ts`. |
| `totalTaxes` | Decimal? | nullable | Total taxes/fees owed on the entry, separate from duty. Null until calculated. | Same consumers as `totalDuties`. |
| `totalAmount` | Decimal? | nullable | Grand total due (duties + taxes + fees). Null until calculated. | `FilingDetailClient.tsx` "Total Due"; `filing.service.ts` snapshot header. |
| `dutyBreakdown` | Json? | nullable | Array of itemized fee objects, each `{ feeName, amount, rate }` — the line-by-line duty/fee breakdown shown to the operator. | `FilingDetailClient.tsx` renders this directly as the "Duty & Tax Breakdown" table; `page.tsx` casts it to `{feeName, amount, rate}[]`. |
| `version` | Int | `@default(1)` | Optimistic-concurrency / revision counter for the filing. Incremented each time a fresh declaration is transmitted. | `filing.service.ts` `buildSnapshotAndPublish` does `data: { ..., version: { increment: 1 } }`; also copied into `FilingSnapshotData.metadata.version`. |
| `submittedAt` | DateTime? | nullable | When the entry was actually transmitted to the authority. Null until the first successful transmission. | Set by `filing.service.ts` `buildSnapshotAndPublish` (`submittedAt: new Date()`); displayed as the "transmit" stage date in `FilingDetailClient.tsx`'s timeline. |
| `releasedAt` | DateTime? | nullable | When customs released the entry. | Read in many places (`FilingDetailClient.tsx` "clearance" stage date, `deadline.service.ts` as the CBP release date anchor, `dailyComplianceAudit.ts`/`compliance/audits/run` as `liquidationDate`, `protests/eligible-entries` PSC/protest window filtering). **Note:** no write path to this column was found in any file reviewed (including `inboundConsumer.ts`, which never sets it even on an `ACCEPTED`/released response) — it appears to be read everywhere but currently has no confirmed writer in the code examined here. |
| `createdAt` | DateTime | `@default(now())` | Row creation timestamp. | Timeline "prepare" stage date in `FilingDetailClient.tsx`. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-managed last-modified timestamp. | Standard Prisma bookkeeping. |
| `responses` | relation | → `CustomsResponse[]` | Every inbound customs response recorded against this filing. | `page.tsx` includes `responses: { orderBy: { receivedAt: "desc" } }`; `inboundConsumer.ts` creates rows here. |
| `exceptionItems` | relation | → `ExceptionItem[]` | Exceptions (e.g. rejection flags) linked to this filing. | `inboundConsumer.ts` creates one on `REJECTED` (see Relationships below). |
| `refundOpportunities` | relation | → `RefundOpportunity[]` | Refund opportunities identified against this filing (e.g. Section 301 exclusions). | Read in `api/refunds/section301/route.ts` alongside the snapshot. |
| `postSummaryCorrections` | relation | → `PostSummaryCorrection[]` | PSC filings made against this entry. | Surfaced in the "Post-Summary Correction" tab context. |
| `protestEntries` | relation | → `ProtestEntry[]` | Protest filings made against this entry. | `protests/eligible-entries` route. |
| `complianceAuditRecords` | relation | → `ComplianceAuditRecord[]` | Audit records generated for this filing. | `dailyComplianceAudit.ts` / `compliance/audits/run`. |
| `complianceFindings` | relation | → `ComplianceFinding[]` | Compliance findings tied to this filing. | Not read in files reviewed here. |
| `classificationChangeImpacts` | relation | → `ClassificationChangeImpact[]` | Classification-change impact records tied to this filing. | Not read in files reviewed here. |
| `valuationAssistsRecord` | relation | → `ValuationAssistsRecord?` | Valuation-assist data for this filing (single row). | Not read in files reviewed here. |
| `auditTimelines` | relation | → `AuditTimeline[]` | Audit timeline entries for this filing. | Not read in files reviewed here. |
| `snapshot` | relation | → `FilingSnapshot?` | The single "current effective" snapshot for this filing (1:1). | `page.tsx` includes `snapshot: true`; `filing.service.ts` upserts it. |
| `filingMessages` | relation | → `FilingMessage[]` | Every canonical message (outbound request / inbound response) exchanged for this filing. | `FilingService.resubmitFiling`/`cancelFiling` query the latest `OUTBOUND` row; `page.tsx` includes them ordered by `createdAt asc` for the Response tab. |

---

## FilingMessage

Durable, queryable record of every canonical message sent or received for a
filing — combines the outbound send-queue and the audit log in one table so
they cannot drift apart.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `accountId` | String | FK → `Account.id`, `onDelete: Cascade`, indexed | Tenant scoping. | All queries in `filing.service.ts`/`inboundConsumer.ts` filter by it. |
| `account` | relation | → `Account` | Object form of FK. | — |
| `filingId` | String | FK → `CustomsFiling.id`, `onDelete: Cascade`, indexed | Which filing this message belongs to. | `filing.service.ts` `findFirst({ where: { filingId, accountId, direction: "OUTBOUND" }, orderBy: { createdAt: "desc" } })` to find the "prior message" for resubmit/cancel. |
| `filing` | relation | → `CustomsFiling` | Object form of FK. | — |
| `messageId` | String | `@unique` | Globally unique ID for this specific message (a `randomUUID()` set in `buildMessage()`). | Stamped into the envelope header; used as `priorMessageId` on subsequent related messages. |
| `correlationId` | String? | nullable | Set only on INBOUND response messages — equals the `messageId` of the OUTBOUND request it answers. | Indexed (`@@index([correlationId])`); `FilingDetailClient.tsx` shows it as "Linked To" in the messages table. |
| `priorMessageId` | String? | nullable | Set only on AMENDMENT / CANCELLATION / RESUBMIT / STATUS_INQUIRY messages — the `messageId` of the message this one supersedes/acts on. Deliberately distinct from `correlationId` ("replying to" vs "superseding"). | `filing.service.ts` `cancelFiling`/`resubmitFiling` pass the prior outbound `messageId` here via `buildMessage(..., priorMessage.messageId)`; `FilingDetailClient.tsx` falls back to it for "Linked To" when `correlationId` is absent, and shows a "(child)" tag for outbound messages that have it. |
| `messageName` | String | required | The canonical message type name (e.g. a `CUSTOMS_DECLARATION_*` value), resolved per (action, country, procedure) by `FilingMessageCatalog`. | `resolveMessageContext.ts` returns it from the catalog match; `FilingDetailClient.tsx` `messageActionLabel()` humanizes it for display. |
| `direction` | String | `OUTBOUND \| INBOUND` | Whether the app sent this message or received it. | Drives the badge color and "Response" vs action label in `FilingDetailClient.tsx`; `inboundConsumer.ts`/`filing.service.ts` filter queries on it. |
| `procedure` | String | required | The procedure code (from `FilingProcedureMapping`) this message was filed under. | Displayed in the message detail modal ("Procedure"). |
| `country` | String | required | ISO country this message concerns (the filing's destination country at send time). | `inboundConsumer.ts` uses `header.country` to look up `FilingResponseStatusMapping`. |
| `status` | String? | nullable, INBOUND only | The canonical response status (`ACCEPTED`, `REJECTED`, `NEEDS_INFO`, etc.) carried by an inbound response. | `inboundConsumer.ts` reads `data.status` (from the envelope, not this column directly) to drive the transition lookup and writes it here as `status`; `FilingDetailClient.tsx` shows it as a badge per row. |
| `envelope` | Json | required | The full header+data payload exactly as published/received — the audit source of truth for what was actually sent or got back. | `filing.service.ts` builds this via `buildMessage()`; `FilingDetailClient.tsx`'s JSON/structured/"Customs File" views all render straight from this column; `inboundConsumer.ts` reads `message.data`/`message.header` from the deserialized envelope passed to `processInboundMessage`. |
| `queueStatus` | String | `@default("PENDING")`, OUTBOUND only | Queue-claiming state for outbound delivery: `PENDING, CLAIMED, PROCESSED, FAILED`. | Indexed with `createdAt` (`@@index([queueStatus, createdAt])`) — used by the outbound publisher/worker (not in the files reviewed here, but implied by `PgCanonicalMessagePublisher`). |
| `lockedAt` | DateTime? | nullable | When a worker claimed this row for processing. | Queue worker bookkeeping (publisher/consumer, not read in files reviewed here). |
| `attempts` | Int | `@default(0)` | How many delivery attempts have been made. | Queue worker retry logic. |
| `errorMessage` | String? | nullable | Last delivery/processing error, if any. | Queue worker error reporting. |
| `createdAt` | DateTime | `@default(now())` | When the row was written. | `FilingDetailClient.tsx` displays it per message row; used for `orderBy` in `page.tsx`. |
| `processedAt` | DateTime? | nullable | When queue processing of this row completed. | Queue worker bookkeeping. |

---

## FilingSnapshot

One row per filing (1:1), holding the "current effective" frozen view of the
shipment/parties/line-item facts at the moment of the last transmission. A
resubmit **updates** this row rather than creating a new one — history of what
was actually sent lives in `FilingMessage.envelope` instead.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `filingId` | String | `@unique`, FK → `CustomsFiling.id`, `onDelete: Cascade`, indexed | The filing this is the current snapshot for (unique — one snapshot per filing). | `filing.service.ts` `db.filingSnapshot.upsert({ where: { filingId }, ... })`. |
| `filing` | relation | → `CustomsFiling` | Object form of FK. | — |
| `snapshotData` | Json | required | Immutable JSON blob of shape `FilingSnapshotData` (shipment header, line items, documents, filing header totals, generator metadata) — everything needed to reconstruct the declaration that was sent. | Written by `filing.service.ts` `buildSnapshotAndPublish`; read by `declarationBuilder.ts` to build the canonical declaration; read by `dailyComplianceAudit.ts`/`api/compliance/audits/run` for `snapshotLineItems`; read by `api/filing/[id]/route.ts` to serve totals when present; read by `api/filing/[id]/entry-summary/route.ts` for `htsReleaseId`. |
| `hasSection301` | Boolean | `@default(false)` | Whether any line item on this filing was subject to a Section 301 duty at transmit time. | Computed in `filing.service.ts` as `tariff.lineResults.some(r => r.section301Amount > 0)`; read by `api/refunds/section301/route.ts` to decide whether to surface a refund opportunity. |
| `section301List` | String? | nullable | Which Section 301 exclusion list applies (e.g. `"List3"`), if `hasSection301` is true. | Computed in `filing.service.ts` from the matched HTS code's `section301Tranche` (falls back to `"List3"`); read by `api/refunds/section301/route.ts`. |
| `createdAt` | DateTime | `@default(now())` | When the snapshot row was first created (not updated on subsequent upserts' `update` branch, since `createdAt` isn't in the `update` payload). | Bookkeeping. |

---

## CustomsResponse

One row per inbound customs response event, kept as the pre-existing UI-facing
response feed (separate from `FilingMessage`, which is the full canonical
audit trail).

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `filingId` | String | FK → `CustomsFiling.id`, `onDelete: Cascade`, indexed | Which filing this response is about. | `inboundConsumer.ts` `db.customsResponse.create({ data: { filingId: filing.id, ... } })`. |
| `filing` | relation | → `CustomsFiling` | Object form of FK. | — |
| `accountId` | String | FK → `Account.id`, `onDelete: Cascade`, indexed | Tenant scoping. | `inboundConsumer.ts` sets it from `filing.accountId`. |
| `account` | relation | → `Account` | Object form of FK. | — |
| `code` | String | required, e.g. `ACK, RFRA, AOC, RELE` | Short response-type code. | Written by `inboundConsumer.ts` as `data.status` (the canonical status string, e.g. `ACCEPTED`/`REJECTED`), i.e. this column is populated with the canonical status rather than a distinct ACK/RFRA/AOC/RELE vocabulary in the current inbound path. Displayed as a badge in `FilingDetailClient.tsx`'s "Latest Status" card. |
| `title` | String | required, e.g. `"ACK - Acceptance"` | Human-readable summary title. | `inboundConsumer.ts` sets it to `` `${data.status} — ${newFilingStatus}` `` when a status transition was applied, else just `data.status`. Rendered as the bold title in "Latest Status". |
| `description` | String | required, e.g. `"Customs has accepted your entry"` | Human-readable description of the response. | `inboundConsumer.ts` sets it to `data.humanMessage` if present, else a generic `` `Canonical response received: ${data.status}` ``. Rendered under the title. |
| `status` | String | required | Status value used for badge coloring (`Accepted, Responded, In Process, Released`, or in practice the canonical status). | `inboundConsumer.ts` sets it to `data.status`; `FilingDetailClient.tsx` `statusBadgeVariant(responses[0].status)`. |
| `receivedAt` | DateTime | `@default(now())`, indexed via `page.tsx` `orderBy` | When the response was received. | `page.tsx` orders `responses` by this field descending, so `responses[0]` is always the latest; displayed as "Received {date}". |
| `createdAt` | DateTime | `@default(now())` | Row creation timestamp. | Bookkeeping. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-managed last-modified timestamp. | Bookkeeping. |

---

## FilingActionDataRequirement

Configures which extra data a given (country, procedure, messageName, action)
needs beyond the base declaration — e.g. a German NCTS transit cancellation
needing a guarantee reference. One row per context; the whole field list is
stored as JSON so resolution is a single lookup rather than gathering rows.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `country` | String | ISO code or `"*"` wildcard | Which destination country this requirement applies to. | `actionDataRequirements.ts` `resolveActionDataFields()` matches on it via `findMostSpecificMatch`. |
| `procedureCode` | String | value or `"*"` | Which procedure code this requirement applies to. | Same resolution call. |
| `messageName` | String | value or `"*"` | Which message name this requirement applies to. | Same resolution call. |
| `action` | String | a `FilingMessageActionCatalog` code, e.g. `CANCELLATION`, `AMENDMENT` — always an **exact** filter, never wildcarded in the query | Which outbound action this requirement is for. | `db.filingActionDataRequirement.findMany({ where: { action } })` in `resolveActionDataFields()`. |
| `fields` | Json | required, `Array<{ key, label, type, required, source, helpText? }>` | The promptable/derivable field tree. `source` is `"prompt"` (operator supplies it) or `"shipment.<dotted.path>"` (auto-resolved). `type: "grid"` makes a field a list of nested rows (recursive). | `actionDataRequirements.ts` `resolveField()`/`buildActionExtensions()` walk this tree to build the outbound extensions object; `FilingDetailClient.tsx`'s `ActionFieldPrompts`/`ActionFieldGridEditor` render only the `"prompt"`-sourced fields for the operator, fetched via `GET /api/filing/[id]/action-fields`. |
| *(unique)* | — | `@@unique([country, procedureCode, messageName, action])` | No two rows can define the same context/action pair. | Enforced at the DB level for seed data integrity. |

---

## FilingProcedureMapping

Wraps `entryType.ts`'s stable CBP entry-type vocabulary and translates it per
destination country into the procedure code the third-party message catalog
expects. `entryType.ts` remains the internal source of truth; this table only
adds the per-country translation.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `entryType` | String | a code from `entryType.ts`, e.g. `"01"` | The internal entry-type code being translated. | `resolveMessageContext.ts` queries `{ entryType: entryTypeCode, country: { in: [country, "*"] } }`. |
| `country` | String | ISO code or `"*"` wildcard | Which destination country this mapping applies to. | Same query; resolved with `findMostSpecificMatch(candidates, ["country"], { country })`. |
| `procedureCode` | String | required | The procedure code the third-party filing system expects for this (entryType, country) pair. | Returned as `procedure` from `resolveMessageContext()`; consumed by `FilingMessageCatalog` lookup and by `filing.service.ts` when building the outbound message. |
| *(unique)* | — | `@@unique([entryType, country])` | One mapping per (entryType, country). | — |

---

## FilingMessageCatalog

Maps (action, country, procedureCode) to the concrete `messageName` and
`queueName` the message catalog expects, so queue routing per country is
configuration, not a hardcoded string.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `action` | String | a `FilingMessageActionCatalog` code, or `"*"` | Which outbound action this catalog entry is for (e.g. `SUBMIT`, `CANCELLATION`). | `resolveMessageContext.ts` queries `{ action: { in: [action, "*"] }, ... }`. |
| `country` | String | ISO code or `"*"` | Which destination country. | Same query. |
| `procedureCode` | String | value or `"*"` | Which procedure code (resolved earlier from `FilingProcedureMapping`). | Same query. |
| `messageName` | String | required | The canonical message type name to stamp on the outbound envelope and store on `FilingMessage.messageName`. | Returned from `resolveMessageContext()` as `messageName`; used by `filing.service.ts buildMessage()`. |
| `queueName` | String | required | Which outbound queue this message should be published to. | Returned from `resolveMessageContext()` as `queueName`; `filing.service.ts` calls `publisher.publish(context.queueName, message)`. |
| *(unique)* | — | `@@unique([action, country, procedureCode])` | One catalog row per (action, country, procedure). | — |

---

## FilingResponseStatusMapping

Maps an inbound response's canonical status onto which `FilingTransition` to
apply. Deliberately does **not** redefine `CustomsFiling.filingStatus`'s
vocabulary — that lives in `filingStateMachine.ts` — this table only says
which canonical status maps to which transition, since that mapping can
legitimately vary per country/authority as new ones are onboarded.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `country` | String | ISO code or `"*"` wildcard | Which destination country this status mapping applies to. | `inboundConsumer.ts` queries `{ country: { in: [header.country, "*"] }, ... }`. |
| `messageName` | String | the response `messageName`, or `"*"` | Which inbound response message type this applies to. | Same query. |
| `canonicalStatus` | String | e.g. `"ACCEPTED"`, `"REJECTED"`, `"NEEDS_INFO"` — always an **exact** filter | The canonical status value carried by the inbound message's `data.status`. | `inboundConsumer.ts` filters `canonicalStatus: data.status` (never wildcarded). |
| `filingTransition` | String | a `FilingTransition` value, e.g. `"cbp.accept"` | Which state-machine transition to apply when this status is seen. | `inboundConsumer.ts` passes it to `applyTransition(filing.filingStatus, mapping.filingTransition)`. |
| *(unique)* | — | `@@unique([country, messageName, canonicalStatus])` | One mapping per (country, messageName, canonicalStatus). | — |

---

## FilingActionRule

Whether a filing's declaration is editable (and Save/Submit/Resubmit buttons
shown) for a given (country, procedure, messageName, status) combination.
Resolution is most-specific-match-wins; **no match defaults to `false`** —
fail closed, never fail open.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `country` | String | ISO code or `"*"` | Destination country context. | `filingActionRules.ts` `resolveAllowUpdates()` query. |
| `procedureCode` | String | value or `"*"` | Procedure code context. | Same. |
| `messageName` | String | the messageName of the message that produced the current status, or `"*"` | Which message produced the filing's current status. | Same. |
| `status` | String | a `CustomsFiling.filingStatus` value, or `"*"` | The filing's current status. | Same. |
| `allowUpdates` | Boolean | `@default(false)` | Whether the declaration can be edited (Save / Save & Resubmit shown) in this context. | Returned by `resolveAllowUpdates()`; `page.tsx` passes it to `FilingDetailClient` as `allowUpdates`, which gates the editable HTS/Country-of-Origin inputs and the Save/Resubmit buttons. |
| *(unique)* | — | `@@unique([country, procedureCode, messageName, status])` | One rule per exact context tuple. | — |

---

## FilingChildActionRule

Which child actions (`CANCEL`, `AMEND`, `INVALIDATE`, ...) are offered for a
given (country, procedure, messageName, status) — one row per action rather
than a boolean column per action, so adding a new action is a seed-data row,
never a migration. Resolution is most-specific-match-wins **per action
independently**; no matching row for an action means it simply isn't offered
(fail closed).

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `country` | String | ISO code or `"*"` | Destination country context. | `childActionRules.ts` `resolveChildActions()` query. |
| `procedureCode` | String | value or `"*"` | Procedure code context. | Same. |
| `messageName` | String | value or `"*"` | Message-name context. | Same. |
| `status` | String | a `CustomsFiling.filingStatus` value, or `"*"` | The filing's current status. | Same. |
| `action` | String | e.g. `"CANCEL"`, `"AMEND"`, `"INVALIDATE"` | Which child action this row enables. | Grouped by this column in `resolveChildActions()`, then most-specific-match resolved per group; the resulting action codes are returned as a `string[]` and rendered generically by `CHILD_ACTION_REGISTRY` in `FilingDetailClient.tsx` (today only `CANCEL` has a registry entry, so other action codes returned here would silently not render a button). |
| *(unique)* | — | `@@unique([country, procedureCode, messageName, status, action])` | One rule per exact context+action tuple. | — |

---

## FilingMessageActionCatalog

Replaces a hardcoded `FilingMessageType` union so a new outbound action never
requires a code deploy.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `code` | String | `@id`, e.g. `SUBMIT, AMENDMENT, CANCELLATION, RESUBMIT, STATUS_INQUIRY` | The stable action code. | Used as the `action` value passed into `resolveMessageContext()`/`FilingMessageCatalog`/`FilingActionDataRequirement` lookups; `FilingDetailClient.tsx`'s `ChildActionDefinition.messageAction` (e.g. `"CANCELLATION"`) references this vocabulary to fetch action-fields via `GET /api/filing/[id]/action-fields?action=...`. |
| `label` | String | required | Human-readable label for the action. | `src/modules/filingConfig/registry.ts` CRUD surface for admin configuration. |
| `requiresPriorMessage` | Boolean | `@default(false)` | Whether this action must reference a prior outbound message (true for AMENDMENT/CANCELLATION/RESUBMIT/STATUS_INQUIRY, false for SUBMIT). | Not directly read as a guard in the files reviewed (the actual "must have a prior message" checks in `filing.service.ts` `cancelFiling`/`resubmitFiling` are hardcoded `if (!priorMessage) throw ...` rather than driven by this flag) — appears intended as descriptive/admin-surface metadata today. |

---

## FilingAuthorityConfig

Maps a destination country to the authority name and filing-system label
stamped on a new `CustomsFiling`. Deliberately has **no wildcard fallback** —
"which authority is this filing with" has no sensible generic default; an
unmapped country simply cannot have a filing created for it yet.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `country` | String | `@unique`, ISO 3166-1 alpha-2 | The destination country this authority config is for. | `api/filing/route.ts`: `db.filingAuthorityConfig.findUnique({ where: { country: destinationCountry } })` when creating a new filing — fails closed (no fallback) if absent. |
| `authorityName` | String | required, e.g. `"U.S. Customs and Border Protection (CBP)"` | Full display name of the customs authority. | Stamped onto `CustomsFiling.authority` at creation. |
| `filingSystemLabel` | String | required, e.g. `"ABI - Automated"` | Label for the filing system/channel used with that authority. | Admin config surface (`filingConfig/registry.ts`). |

---

## FilingSchemaVersion

A versioned JSON Schema document for one part of the canonical message
contract. Authored as reviewed, version-controlled files and loaded via
migration/seed — never edited live through a runtime admin surface. Mirrors
`HtsRelease`'s `DRAFT/ACTIVE/DEPRECATED/RETIRED` promotion pattern.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `schemaType` | String | `ENVELOPE_HEADER \| FILING_REQUEST_DECLARATION \| FILING_RESPONSE_DATA` | Which part of the canonical contract this schema version validates. | `schemaValidator.ts` `getActiveSchemaVersion(schemaType)` query, called from `filing.service.ts buildMessage()` as `getActiveSchemaVersion("FILING_REQUEST_DECLARATION")`. |
| `version` | String | semver, e.g. `"1.0.0"` | The schema's own version number. | Stamped into every outbound `CanonicalMessage.header.schemaVersion` so it reflects whichever version is ACTIVE right now, not one frozen at code-authoring time. |
| `schemaJson` | Json | required | The actual JSON Schema document. | Used by `schemaValidator.ts` for payload validation (not directly read in the files reviewed here beyond version lookup). |
| `status` | String | `@default("DRAFT")`, `DRAFT, ACTIVE, DEPRECATED, RETIRED` | Promotion lifecycle state of this schema version. | `getActiveSchemaVersion()` filters on `status: "ACTIVE"` (per `@@index([schemaType, status])`). |
| `effectiveFrom` | DateTime | `@default(now())` | When this version became/becomes effective. | Schema promotion bookkeeping. |
| `supersedesVersionId` | String? | nullable | Which prior `FilingSchemaVersion.id` this version replaces. | Schema promotion audit trail. |
| `createdAt` | DateTime | `@default(now())` | Row creation timestamp. | Bookkeeping. |
| *(unique)* | — | `@@unique([schemaType, version])` | One row per (schemaType, version). | — |

---

## Shipment

The parent record a `CustomsFiling` is filed against. Only the fields most
relevant to filing/customs are exercised by the module; the model also carries
many fields used by other modules (documents, agents, landed cost, etc.),
which are included below for completeness since the model was read in full.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | FK target for `CustomsFiling.shipmentId`, etc. |
| `accountId` | String | FK → `Account.id`, `onDelete: Cascade`, indexed | Tenant scoping. | Universal tenant filter. |
| `account` | relation | → `Account` | Object form of FK. | — |
| `shipmentNumber` | String | required, e.g. `"SHP-2026-004872"`, unique with `accountId` | Human-facing shipment identifier. | Displayed throughout the shipment/filing UI. |
| `importerName` | String | required, e.g. `"ABC Manufacturing India Pvt Ltd"` | Name of the importer for this shipment. | `filing.service.ts` copies into `FilingSnapshotData.shipment.importerName`; `FilingDetailClient.tsx` displays it as "Importer" and in the header subtitle. |
| `importerOfRecordId` | String? | FK → `ImporterOfRecord.id`, `onDelete: SetNull` | Which structured Importer of Record entity applies, if assigned. | Not read in files reviewed here. |
| `importerOfRecord` | relation | → `ImporterOfRecord?` | Object form of FK. | — |
| `clientId` | String? | FK → `Client.id`, `onDelete: SetNull` | Which client/customer this shipment is for, if tracked as a distinct client. | Not read in files reviewed here. |
| `client` | relation | → `Client?` | Object form of FK. | — |
| `assignedBrokerId` | String? | FK → `User.id` (`"ShipmentBroker"`), `onDelete: SetNull` | Broker user assigned to work this shipment. | Not read in files reviewed here. |
| `assignedBroker` | relation | → `User?` | Object form of FK. | — |
| `poReference` | String? | nullable, e.g. `"PO-778899"` | Purchase order reference for this shipment. | Not read in files reviewed here. |
| `entryType` | String? | nullable | Shipment-level entry type (distinct from `CustomsFiling.entryType`, which is the entry's own copy at filing time). | `filing.service.ts` copies `filing.shipment.entryType` into `FilingSnapshotData.shipment.entryType`; `FilingDetailClient.tsx` `ShipmentProps.entryType`. |
| `incoterm` | String? | nullable | Incoterm (e.g. `CIF`, `FOB`) governing the shipment. | `filing.service.ts` snapshot; `FilingDetailClient.tsx` displays it under "Transport". |
| `invoiceCurrency` | String? | nullable, `@default("USD")`, ISO 4217 (e.g. `"EUR"`, `"GBP"`, `"CNY"`) | Currency the commercial invoice was denominated in. Extracted from invoice OCR via `documentIntelligenceAgent.ts` and persisted onto this column by `pipelineOrchestrator.ts`. | `filing.service.ts` and `api/products/[id]/valuation/route.ts` pass this (plus `ladingDate` as the as-of date) to `ExchangeRateService.resolveExchangeRate()` to convert all monetary fields to USD before duty/valuation math. See [ExchangeRate](#exchangerate) below. |
| `portOfEntry` | String? | nullable | Port where the shipment enters. | `filing.service.ts` snapshot; `FilingDetailClient.tsx` "Port of Entry". |
| `carrierName` | String? | nullable | Name of the carrier transporting the shipment. | `filing.service.ts` snapshot; `FilingDetailClient.tsx` "Carrier". |
| `countryOfExport` | String? | nullable | Country the goods were exported from. | `FilingDetailClient.tsx` "Country of Export" (Declaration tab, Parties card). |
| `countryOfOrigin` | String? | nullable | Country of origin at the shipment level (distinct from the per-line-item `ShipmentLineItem.countryOfOrigin`, which is authoritative for the declaration). | Not read directly in the filing files reviewed (line items are used instead for the declaration). |
| `destinationCountry` | String? | nullable, ISO 3166-1 alpha-2 | The country the shipment is being imported **into** — never inferred, always human-entered, because a wrong destination silently misfiles an entry. Selects the `FilingProcedureMapping`/`FilingMessageCatalog`/`FilingAuthorityConfig` rows used to file. | `resolveMessageContext.ts` requires this to be set (throws if not) and uses it as `country` for every wildcard lookup; `api/filing/route.ts` looks up `FilingAuthorityConfig` by it at filing creation; `FilingDetailClient.tsx` displays it under "Declaration". |
| `estimatedArrival` | DateTime? | nullable | Estimated arrival date. | Deadline computation (`deadline.service.ts`, not detailed here). |
| `ladingDate` | DateTime? | nullable | On-board/ETD date — ISF anchor; from BL extraction or broker override. | Deadline rules. |
| `arrivalDate` | DateTime? | nullable | Actual arrival date at first US port; falls back to `estimatedArrival`. | Deadline rules. |
| `transportMode` | String? | nullable, `Ocean \| Air \| Truck \| Rail` | Mode of transport — ISF applies to Ocean only. | Deadline rules (ISF gating). |
| `filingDeadline` | DateTime? | nullable, indexed | Denormalized cache = `min(dueAt)` over OPEN blocking `ComplianceDeadline` rows for this shipment, kept in sync by `deadline.service.ts`. | Read by dashboards/queues that need the earliest blocking deadline without joining `ComplianceDeadline`. |
| `status` | String | `@default("Draft")`, `Draft, In Progress, Ready to File, On Hold, Submitted, Completed` | Shipment-level workflow status (distinct from `CustomsFiling.filingStatus`). | Not directly read in the filing-detail files reviewed here. |
| `currentStage` | String? | nullable, indexed | Pipeline stage: `DOCUMENT_INTAKE \| CLASSIFICATION \| VALUATION \| ORIGIN \| COMPLIANCE \| FILING_PREP \| READY_TO_FILE`. | Agent orchestration (not detailed here). |
| `healthStatus` | String? | nullable | Derived health rollup: `Healthy, At Risk, Critical`. Null until evaluated. | Dashboard/reporting surfaces. |
| `readinessScore` | Int? | nullable, 0-100 | Derived readiness percentage. Null until calculated. | Dashboard/reporting surfaces. |
| `riskScore` | Int? | nullable, 0-100 | Derived risk score. Null until calculated. | Dashboard/reporting surfaces. |
| `ownerName` | String? | nullable | Free-text owner name. | Not read in files reviewed here. |
| `version` | Int | `@default(1)` | Optimistic-concurrency counter for the shipment row. | Not read in files reviewed here. |
| `deletedAt` | DateTime? | nullable, indexed | Soft-delete marker. | Not read in files reviewed here. |
| `createdAt` | DateTime | `@default(now())` | Row creation timestamp. | — |
| `updatedAt` | DateTime | `@updatedAt` | Auto-managed last-modified timestamp. | — |
| `scenarioId` | String? | FK → `LandedCostScenario.id`, `onDelete: SetNull` | Which landed-cost scenario this shipment originated from/is linked to, if any. | Not read in filing files reviewed here. |
| `scenario` | relation | → `LandedCostScenario?` | Object form of FK. | — |
| `masterShipmentId` | String? | FK → `Shipment.id` (self-relation `"MasterHouseRelation"`), `onDelete: SetNull`, indexed | If this is a house shipment, the master shipment it rolls up to. | Not read in filing files reviewed here. |
| `masterShipment` | relation | → `Shipment?` | Object form of FK. | — |
| `houseShipments` | relation | → `Shipment[]` | Inverse of `masterShipmentId` — house shipments under this master. | — |
| `documents` | relation | → `ShipmentDocument[]` | Documents attached to this shipment. | `filing.service.ts` includes `documents: true` and copies `id/fileName/docType` into the snapshot; `page.tsx` includes them for the Declaration tab's "Source Documents" list. |
| `lineItems` | relation | → `ShipmentLineItem[]` | Line items on this shipment — the authoritative declaration content. | `filing.service.ts` includes `lineItems: true`, validates non-empty, feeds `computeFilingTariff()`, and snapshots them; `page.tsx`/`FilingDetailClient.tsx` render/edit them in the Declaration tab. |
| `agentDecisions` | relation | → `AgentDecision[]` | AI-agent review decisions for this shipment. | Not read in filing files reviewed here. |
| `customsFilings` | relation | → `CustomsFiling[]` | All customs filings created for this shipment. | `deadline.service.ts` reads `shipment.customsFilings[0]?.releasedAt`. |
| `exceptionItems` | relation | → `ExceptionItem[]` | Exceptions raised against this shipment. | `inboundConsumer.ts` creates one on filing rejection (see below). |
| `regulatoryUpdateImpacts` | relation | → `RegulatoryUpdateImpact[]` | Regulatory-update impact records. | Not read here. |
| `classificationChangeImpacts` | relation | → `ClassificationChangeImpact[]` | Classification-change impact records. | Not read here. |
| `reconciliationIssues` | relation | → `ReconciliationIssue[]` | Data-reconciliation issues. | Not read here. |
| `pipelineJobs` | relation | → `PipelineJob[]` | Pipeline job runs for this shipment. | Not read here. |
| `facts` | relation | → `Fact[]` | Extracted facts for this shipment. | Not read here. |
| `shipmentParties` | relation | → `ShipmentParty[]` | Parties on this shipment. | Not read here. |
| `changeEvents` | relation | → `ShipmentChangeEvent[]` | Change-event log. | Not read here. |
| `eventLogs` | relation | → `ShipmentEventLog[]` | General event log. | Not read here. |
| `agentExecutionRecords` | relation | → `AgentExecutionRecord[]` | Agent execution history. | Not read here. |
| `fieldApprovals` | relation | → `FieldApproval[]` | Field-level approval records. | Not read here. |
| `documentCandidates` | relation | → `DocumentShipmentCandidate[]` | Candidate document-to-shipment matches. | Not read here. |
| `complianceDeadlines` | relation | → `ComplianceDeadline[]` | Every statutory/commercial deadline attached to this shipment. | `inboundConsumer.ts` creates a `PSC_WINDOW` deadline here on filing acceptance (see below). |

---

## ExchangeRate

Daily-ingested USD conversion rates, fetched from the CurrencyFreaks API by
the `fx-rate-refresh` cron (`src/app/api/cron/fx-rate-refresh/route.ts` →
`ExchangeRateService.fetchAndStoreRates()`). Rows are never deleted — each
refresh flips the prior `isCurrent: true` row for a currency to `false` and
inserts a new one, so the table doubles as a dated rate history. This history
is what `resolveExchangeRate(currencyCode, asOfDate)` queries to resolve the
rate as of a shipment's `ladingDate` (19 CFR 159.34 date-of-export intent)
rather than always using today's rate.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `currencyCode` | String | required, ISO 4217 (e.g. `"EUR"`) | Currency this rate applies to. | Lookup key in `resolveExchangeRate()`. |
| `rateToUsd` | Decimal | `@db.Decimal(18, 8)` | `1 unit of currencyCode = rateToUsd USD` — inverted from CurrencyFreaks' USD-per-X convention at ingestion time so downstream math is a plain multiply. | `ExchangeRateService.resolveExchangeRate()` return value; multiplied into every monetary field at the `filing.service.ts` / valuation call sites. |
| `fetchedAt` | DateTime | `@default(now())` | When this rate was ingested. | `resolveExchangeRate(code, asOfDate)` queries `fetchedAt <= asOfDate`, ordered `fetchedAt desc`, to find the rate in effect as of a given date. |
| `isCurrent` | Boolean | `@default(true)` | Whether this is the latest ingested rate for `currencyCode`. Only one row per currency has `isCurrent: true` at a time. | `resolveExchangeRate(code)` with no `asOfDate` queries this directly. |
| `createdAt` | DateTime | `@default(now())` | Row creation timestamp. | — |
| *(index)* | — | `@@index([currencyCode, isCurrent])` | Fast lookup of the current rate. | — |
| *(index)* | — | `@@index([currencyCode, fetchedAt])` | Fast as-of-date history lookup. | — |

**Fail-closed**: if no rate row exists for a currency (current or as-of-date),
`resolveExchangeRate()` throws rather than defaulting to `1` — silently
treating a foreign-currency invoice as USD is the exact bug this table and
service exist to close.

---

## ShipmentLineItem

The authoritative per-line declaration content — description, value, HTS
code, and country of origin used to build the canonical customs declaration.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | — |
| `shipmentId` | String | FK → `Shipment.id`, `onDelete: Cascade`, indexed | Which shipment this line belongs to. | `filing.service.ts` loads via `shipment.lineItems`. |
| `shipment` | relation | → `Shipment` | Object form of FK. | — |
| `accountId` | String | FK → `Account.id`, `onDelete: Cascade`, indexed | Tenant scoping. | — |
| `account` | relation | → `Account` | Object form of FK. | — |
| `lineNumber` | Int | required | Ordinal position of this line on the entry. | `filing.service.ts` snapshot (`lineNumber`); `FilingDetailClient.tsx` "#" column; declaration line item `lineNumber`. |
| `partNumber` | String? | nullable | Internal/manufacturer part number for this line. | `page.tsx`/`FilingDetailClient.tsx` `LineItemProps.partNumber` (fetched but not rendered in the Declaration table shown). |
| `description` | String | required, e.g. `"Stainless Steel Valve 1/2\" NPT, 316 Grade"` | Commercial description of the goods on this line. | Snapshot; declaration `lineItems[].description`; `FilingDetailClient.tsx` "Description" column. |
| `quantity` | Int | required | Unit quantity on this line. | Snapshot (`Number(item.quantity)`); `FilingDetailClient.tsx` "Qty" column. |
| `unitPrice` | Decimal | required | Per-unit price. | Snapshot; `FilingDetailClient.tsx` "Unit Price". |
| `totalValue` | Decimal | required | Total value of this line (`quantity × unitPrice`, though not derived by a DB constraint). | Snapshot; fed into `computeFilingTariff()`; `FilingDetailClient.tsx` "Total Value"; summed into declaration `totals.customsValue`. |
| `countryOfOrigin` | String | required, e.g. `"Germany"`, `"China"` | Country of origin of the goods on this line — the field actually used for the declaration (as opposed to `Shipment.countryOfOrigin`). | Snapshot; declaration line item `originCountry`; **editable** in `FilingDetailClient.tsx` when `allowUpdates` is true, saved via `PATCH /api/shipments/[id]` from `saveLineItemEdits()`. |
| `htsCode` | String | required, e.g. `"8481.80.5090"` | Harmonized Tariff Schedule code classifying this line. | Snapshot; input to `computeFilingTariff()`/`loadHtsCodesMap()` for duty calculation; declaration line item `hsCode6`; **editable** in `FilingDetailClient.tsx` under the same conditions as `countryOfOrigin`. |
| `htsConfidence` | Int? | nullable | Model confidence for the HTS classification. Null until classified. | `page.tsx`/`FilingDetailClient.tsx` `LineItemProps.htsConfidence` (fetched but not rendered in the visible Declaration table). |
| `eccnCode` | String? | nullable | Export Control Classification Number, if applicable. | Not read in filing files reviewed here. |
| `status` | String | `@default("Unreviewed")`, `Unreviewed, Valid, Review Required, Issue` | Review status of this line item. | `page.tsx`/`FilingDetailClient.tsx` `LineItemProps.status` (fetched, not rendered in the visible table). |
| `dutyStack` | Json? | nullable | Structured duty-stack breakdown for this line (rates, Section 301, etc.), populated by the tariff engine. | Read by `dutyEngine.ts` consumers for reporting (not directly re-read by `filing.service.ts`, which recomputes `computeFilingTariff` fresh each time). |
| `createdAt` | DateTime | `@default(now())` | Row creation timestamp. | — |
| `updatedAt` | DateTime | `@updatedAt` | Auto-managed last-modified timestamp. | — |
| `productId` | String? | FK → `Product.id`, `onDelete: SetNull`, indexed | Link to the tenant's Product Master, if matched. Null is normal/expected, never a reason to withhold the line. | Not read in filing files reviewed here. |
| `product` | relation | → `Product?` | Object form of FK. | — |
| `productMatchStatus` | ProductMatchStatus? | enum, nullable | What the deterministic product matcher concluded (including `AMBIGUOUS`, which must not be guessed away). | Not read in filing files reviewed here. |
| `productMatchedAt` | DateTime? | nullable | When the product match was made. | Not read in filing files reviewed here. |
| `source` | String? | nullable, e.g. `"ERP"` | Data-lineage marker: which system created/updated this line. | Not read in filing files reviewed here. |
| `sourceSystem` | String? | nullable, e.g. `"SAP"`, `"CargoWise"` | Specific source system name. | Not read in filing files reviewed here. |
| `sourceId` | String? | nullable | External identifier for this record in the source system. | Not read in filing files reviewed here. |
| `origins` | relation | → `OriginDetermination[]` | Trade-agreement origin determinations for this line. | Not read in filing files reviewed here. |
| `drawbackMatches` | relation | → `DrawbackMatch[]` | Drawback matches referencing this line. | Not read in filing files reviewed here. |
| `pgaRequirements` | relation | → `PgaRequirement[]` | Partner Government Agency requirements for this line. | Not read in filing files reviewed here. |

---

## ShipmentDocument

Source documents (invoice, packing list, BOL, etc.) attached to a shipment,
carried through into the filing declaration for reference.

| Column | Type | Constraints | Business meaning | Used by |
|---|---|---|---|---|
| `id` | String | `@id @default(cuid())` | Primary key. | Snapshot `documents[].id`. |
| `shipmentId` | String? | FK → `Shipment.id`, `onDelete: SetNull`, indexed | Which shipment this document belongs to. Nullable: a document can be detached and reattached without redoing AI extraction. | `filing.service.ts` loads via `shipment.documents`. |
| `shipment` | relation | → `Shipment?` | Object form of FK. | — |
| `accountId` | String | FK → `Account.id`, `onDelete: Cascade` | Tenant scoping. | — |
| `account` | relation | → `Account` | Object form of FK. | — |
| `docType` | String | required, e.g. `"Commercial Invoice"`, `"Packing List"`, `"Bill of Lading"` | Legacy free-text document type. | Snapshot `documents[].docType`; `FilingDetailClient.tsx` "Source Documents" list (`{fileName} ({docType})`). |
| `documentType` | DocumentType? | enum, nullable | Structured enum equivalent of `docType`, written by the classification pipeline. Null until classification runs. | Not read in filing files reviewed here (filing snapshot uses the legacy `docType` string). |
| `documentTypeConfidence` | Float? | nullable, 0.0-1.0 | Model confidence for the `documentType` assignment. Values below 0.7 route to human review. | Not read in filing files reviewed here. |
| `fileName` | String | required, e.g. `"INV-45678.pdf"` | Original file name. | Snapshot `documents[].fileName`; `page.tsx`/`FilingDetailClient.tsx` `DocumentProps.fileName`, shown in "Source Documents". |
| `pageCount` | Int? | nullable | Number of pages, null until parsed. | Not read in filing files reviewed here. |
| `fileUrl` | String? | nullable | URL to the stored file. | `page.tsx`/`FilingDetailClient.tsx` `DocumentProps.fileUrl` — renders a "View" link when present, else shows `status`. |
| `checksum` | String? | nullable | SHA-256 hash for duplicate detection. | Not read in filing files reviewed here. |
| `version` | String | `@default("1.0")` | Document version label. | Not read in filing files reviewed here. |
| `confidence` | Int? | nullable | Extraction confidence, null until extraction runs. | `page.tsx`/`FilingDetailClient.tsx` `DocumentProps.confidence` (fetched, not rendered in the Declaration tab's document list). |
| `status` | String | `@default("Received")`, `Received, Missing, Review Required, NEEDS_CLASSIFICATION` | Document processing/review status. | `FilingDetailClient.tsx` shown in place of the "View" link when no `fileUrl` exists. |
| `required` | Boolean | `@default(true)` | Whether this document is required for the shipment. | Not read in filing files reviewed here. |
| `displayOrder` | Int? | nullable | Manual display ordering; falls back to `createdAt` when unset. | Not read in filing files reviewed here. |
| `extractedJson` | String? | `@db.Text`, nullable | Raw extracted structured data as a JSON string. | Not read in filing files reviewed here. |
| `rawContent` | String? | `@db.Text`, nullable | Raw extracted text content. | Not read in filing files reviewed here. |
| `createdAt` | DateTime | `@default(now())` | Row creation timestamp. | — |
| `updatedAt` | DateTime | `@updatedAt` | Auto-managed last-modified timestamp. | — |
| `byteSize` | Int? | nullable | Byte size of the original file, recorded at upload. | Not read in filing files reviewed here. |
| `mimeType` | String? | nullable | Detected media type, recorded at upload. | Not read in filing files reviewed here. |
| `activeParseVersionId` | String? | nullable | The one successful `DocumentParseVersion` whose artifacts are authoritative for this document. | Not read in filing files reviewed here. |
| `source` | String | `@default("UPLOAD")`, `UPLOAD \| EMAIL` | How this document row originated. | Not read in filing files reviewed here. |
| `assignedToUserId` | String? | FK → `User.id` (`"DocumentAssignee"`), `onDelete: SetNull` | Direct assignee for a standalone/unattached document. | Not read in filing files reviewed here. |
| `assignedToUser` | relation | → `User?` | Object form of FK. | — |
| `extractionFields` | relation | → `ExtractionField[]` | Individually extracted fields from this document. | Not read in filing files reviewed here. |
| `parseVersions` | relation | → `DocumentParseVersion[]` | History of parsing runs for this document. | Not read in filing files reviewed here. |
| `exceptionItems` | relation | → `ExceptionItem[]` | Exceptions tied to this specific document. | Not read in filing files reviewed here. |
| `fieldApprovals` | relation | → `FieldApproval[]` | Field approvals tied to this document. | Not read in filing files reviewed here. |
| `agentDecisions` | relation | → `AgentDecision[]` | Agent decisions triggered by this document. | Not read in filing files reviewed here. |
| `inboundAttachment` | relation | → `InboundAttachment?` | Inbound-email attachment origin, if `source = "EMAIL"`. | Not read in filing files reviewed here. |
| `productEvidence` | relation | → `ProductEvidence[]` | Product-fact evidence sourced from this document. | Not read in filing files reviewed here. |
| `partyEvidence` | relation | → `PartyEvidence[]` | Party-fact evidence sourced from this document. | Not read in filing files reviewed here. |
| `shipmentCandidates` | relation | → `DocumentShipmentCandidate[]` | Candidate shipment matches for this document. | Not read in filing files reviewed here. |

---

## Fields written to ExceptionItem / ComplianceDeadline by the inbound consumer

`ExceptionItem` and `ComplianceDeadline` are not core filing-config models, but
`src/lib/canonicalMessaging/inboundConsumer.ts` writes into both as a direct
side effect of processing an inbound response. The exact fields it populates:

**`ExceptionItem.create` (only when `data.status === "REJECTED"`):**

| Field | Value written |
|---|---|
| `accountId` | `filing.accountId` |
| `shipmentId` | `filing.shipmentId` |
| `filingId` | `filing.id` |
| `category` | `"FILING"` |
| `type` | `"compliance_flag"` |
| `severity` | `"High"` |
| `description` | `data.humanMessage ?? \`Customs filing ${filing.entryNumber} was rejected by authority.\`` |
| `status` | `"Open"` |
| `blocking` | `true` |
| `requiredAction` | `"Review filing rejection codes and resubmit declaration."` |
| `sourceAgent` | `"CANONICAL_MESSAGING_CONSUMER"` |

**`ComplianceDeadline.create`** (only when `newFilingStatus === "Accepted"` or
`data.status === "ACCEPTED"`, and only if no `PSC_WINDOW` deadline already
exists for that shipment):

| Field | Value written |
|---|---|
| `accountId` | `filing.accountId` |
| `shipmentId` | `filing.shipmentId` |
| `type` | `"PSC_WINDOW"` |
| `deadlineClass` | `"REGULATORY"` |
| `status` | `"OPEN"` |
| `anchorEvent` | `"ENTRY"` |
| `anchorAt` | `new Date()` (the moment the response was processed) |
| `dueAt` | anchor + 300 days |
| `ruleId` | `"PSC_WINDOW_300_DAYS"` |
| `ruleCitation` | `"19 CFR 174.12"` |

---

## Relationships

**CustomsFiling** is the hub of the module: `CustomsFiling.shipmentId` → `Shipment.id` and `CustomsFiling.accountId` → `Account.id`. It is referenced by `CustomsResponse.filingId`, `FilingMessage.filingId`, `FilingSnapshot.filingId` (unique — 1:1), `ExceptionItem.filingId` (nullable), plus `RefundOpportunity`, `PostSummaryCorrection`, `ProtestEntry`, `ComplianceAuditRecord`, `ComplianceFinding`, `ClassificationChangeImpact`, `ValuationAssistsRecord`, and `AuditTimeline`, all of which point back at it.

**FilingMessage** has FKs to both `CustomsFiling.id` (`filingId`) and `Account.id` (`accountId`). Its `correlationId`/`priorMessageId` columns are *logical* references to another `FilingMessage.messageId` — not enforced FK constraints — used to stitch together request/response and supersession chains.

**FilingSnapshot** has a unique FK to `CustomsFiling.id` (`filingId`), enforcing one snapshot per filing.

**CustomsResponse** has FKs to `CustomsFiling.id` (`filingId`) and `Account.id` (`accountId`).

**ExceptionItem** (written by the inbound consumer) has nullable FKs to `Account.id`, `Shipment.id`, `CustomsFiling.id`, and `ShipmentDocument.id` — nullable because an exception can be shipment-level, filing-level, or document-level depending on what triggered it.

**ComplianceDeadline** (written by the inbound consumer) has an FK to `Account.id` and a nullable FK to `Shipment.id`; it is not linked to `CustomsFiling` directly, only to the shipment the accepted filing belongs to.

**FilingProcedureMapping**, **FilingMessageCatalog**, **FilingResponseStatusMapping**, **FilingActionRule**, **FilingChildActionRule**, and **FilingActionDataRequirement** carry no foreign keys at all — they are pure reference/configuration tables keyed by string tuples (country/procedure/messageName/status/action), resolved at runtime by `findMostSpecificMatch()` rather than joined.

**FilingMessageActionCatalog.code** is referenced *by value* (not FK) from the `action` column on `FilingMessageCatalog` and `FilingActionDataRequirement`, and from the `FilingMessageAction` action codes passed around in `filing.service.ts`.

**FilingAuthorityConfig.country** is referenced by value from `Shipment.destinationCountry` when a new `CustomsFiling` is created.

**FilingSchemaVersion** carries no FK to any filing row; it is looked up by `schemaType`/`status` and its `version` string is copied into every outbound message's envelope header.

**Shipment** is the parent of `ShipmentLineItem`, `ShipmentDocument`, `CustomsFiling`, `ComplianceDeadline`, `ExceptionItem`, and many others; `ShipmentLineItem.shipmentId` and `ShipmentDocument.shipmentId` both point to it (the latter nullable, so a document can be detached).

---

## The `"*"` wildcard convention

`FilingProcedureMapping`, `FilingMessageCatalog`, `FilingResponseStatusMapping`,
`FilingActionRule`, `FilingChildActionRule`, and `FilingActionDataRequirement`
all use the literal string `"*"` in one or more of their key columns to mean
"this row applies regardless of the actual value in that column." A row with
`country: "US"` only matches shipments filing to the US; a row with
`country: "*"` matches any country, acting as a default/fallback.

Every lookup follows the same two-step pattern:

1. Query with `{ in: [actualValue, "*"] }` on each relevant column, so both
   exact and wildcard rows come back as candidates.
2. Call `findMostSpecificMatch(candidates, fields, target)` to pick the single
   best candidate.

`findMostSpecificMatch()` (in `src/lib/canonicalMessaging/wildcardLookup.ts`)
resolves ties with a specificity score — the candidate that matches on the
most *non*-wildcard fields wins:

```ts
for (const candidate of candidates) {
  let matches = true;
  let score = 0;
  for (const field of fields) {
    const value = candidate[field];
    if (value === "*") continue;              // wildcard: doesn't disqualify, doesn't score
    if (value !== target[field]) { matches = false; break; }  // exact mismatch: disqualifies
    score++;                                   // exact match: +1 to specificity
  }
  if (matches && score > bestScore) { best = candidate; bestScore = score; }
}
```

So for a `(country, procedureCode, messageName, status)` lookup, a row that
matches on `country` and `procedureCode` exactly but wildcards `messageName`
and `status` (score 2) loses to a row that matches all four exactly (score 4),
and both beat a row that wildcards everything (score 0). Whichever field list
is passed in defines what "specificity" means for that table — e.g.
`FilingResponseStatusMapping` only scores `["country", "messageName"]"` since
`canonicalStatus` is always an exact filter there, never wildcarded.

Two tables deliberately do **not** use this fail-open-by-default posture:
- `FilingActionRule.allowUpdates` and `FilingChildActionRule` fail **closed** — no matching row means `false` / no action offered, never a permissive default, because these gate whether an operator can mutate or act on a legal filing.
- `FilingActionDataRequirement` fails **open** (safe default) — no matching row means zero extra fields required, since the action still works correctly with just the base declaration; this is a data-completeness question, not a security gate.
- `FilingAuthorityConfig` has no wildcard column at all — an unmapped country cannot create a filing, by design.

---

## Reporting usage: what's actually shown to users today

Based on `FilingDetailClient.tsx` (the filing detail page, the module's only
customs-filing UI surface reviewed here) and `page.tsx` (its server-side data
loader):

**Directly rendered to the user:**
- `CustomsFiling`: `entryNumber`, `filingStatus`, `entryType`, `filingType`, `paymentStatus`, `authority`, `totalValue`, `totalDuties`, `totalTaxes`, `totalAmount`, `dutyBreakdown`, `submittedAt`, `releasedAt`, `createdAt` (all in the Overview/Entry Summary/timeline).
- `Shipment`: `importerName`, `destinationCountry`, `countryOfExport`, `portOfEntry`, `carrierName`, `incoterm` (Declaration tab).
- `ShipmentLineItem`: `lineNumber`, `description`, `quantity`, `unitPrice`, `totalValue`, `countryOfOrigin`, `htsCode` (Declaration tab table; the last two are editable when `allowUpdates` is true). `partNumber`, `htsConfidence`, and `status` are fetched into `LineItemProps` but not rendered in the table shown.
- `ShipmentDocument`: `fileName`, `docType`, `fileUrl`/`status` (Declaration tab "Source Documents"). `confidence` is fetched but not rendered there.
- `CustomsResponse`: `title`, `description`, `status`, `code`, `receivedAt` (Response tab "Latest Status" card).
- `FilingMessage`: `messageName`, `direction`, `status`, `correlationId`/`priorMessageId`, `createdAt`, and the full `envelope` (Response tab messages table + the message-detail modal's structured/JSON/"Customs File" views).
- Audit log rows (`AuditLog` filtered to `entity: "CustomsFiling"`) — `action`, `userId`/actor, `createdAt`, `metadata` — shown as the "Timeline & Audit Log" when present, falling back to the state-machine stage view otherwise.

**Read to compute UI *behavior* (gating), not shown as raw data:**
- `FilingActionRule` (via `resolveAllowUpdates()`) → `allowUpdates` boolean prop.
- `FilingChildActionRule` (via `resolveChildActions()`) → `childActions` list, filtered further by "does an outbound message exist" before reaching the client.
- `FilingActionDataRequirement` (via `resolveActionDataFields()`/`GET /api/filing/[id]/action-fields`) → the prompt fields rendered in the CANCEL/AMEND confirmation modal.
- `filingStateMachine.ts`'s `canTransition()` → `canValidate`/`canApprove`/`canTransmit`/`canResubmit` booleans that show/hide/disable the top action buttons.

**Read elsewhere for compliance/financial reporting, not in this detail page:**
- `FilingSnapshot.snapshotData`/`hasSection301`/`section301List` — read by `src/lib/inngest/functions/dailyComplianceAudit.ts`, `src/app/api/compliance/audits/run/route.ts`, and `src/app/api/refunds/section301/route.ts` for audit and Section-301 refund-opportunity reporting.
- `CustomsFiling.totalDuties`/`totalValue` — aggregated in `src/lib/analytics/metricComputer.ts` and read by the PSC/Protest "new request" client pages and `src/app/api/protests/eligible-entries/route.ts`.
- `CustomsFiling.releasedAt` — read by `deadline.service.ts` (CBP release date anchor for deadline rules) and the compliance-audit routes as `liquidationDate`.

**Purely internal/audit, not surfaced in any UI reviewed here:**
- `FilingMessage.queueStatus`/`lockedAt`/`attempts`/`errorMessage` — outbound queue worker bookkeeping only.
- `FilingSchemaVersion` — schema governance, referenced only by `schemaValidator.ts`.
- `FilingProcedureMapping`, `FilingMessageCatalog`, `FilingResponseStatusMapping`, `FilingMessageActionCatalog`, `FilingAuthorityConfig` — pure configuration tables consumed by resolver functions at request time; they have an admin CRUD surface (`src/modules/filingConfig/registry.ts`) but are not rendered as filing-status/reporting data to end users in the files reviewed.
- `ShipmentLineItem.dutyStack`, `productId`/`productMatchStatus`/`source*` — populated by other modules (tariff engine, product matching, ERP sync) but not read by the filing detail page.

Note: this reporting-usage split reflects only the files explicitly reviewed for this reference (see source list at the top). Other UI surfaces in the app (dashboards, the filings list page, PSC/protest workflows) may read additional columns from these tables that were out of scope here.
