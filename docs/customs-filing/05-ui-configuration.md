# Filing Configuration UI

## 1. What this UI is

`/app/app/filing-config` is a single, generic admin screen that can list, create,
edit, and delete rows in every global (non-tenant-scoped) canonical-messaging
reference table the filing workflow depends on. There is no per-table React
component or per-table API route — the whole screen is driven by one registry,
`FILING_CONFIG_TABLES` in `src/modules/filingConfig/registry.ts:170-331`. The
eight registered tables are: Procedure Mapping (`procedure-mapping`, registry.ts:171),
Authority Config (`authority-config`, registry.ts:187), Message Catalog
(`message-catalog`, registry.ts:203), Response Status Mapping
(`response-status-mapping`, registry.ts:221), Action Rule (`action-rule`,
registry.ts:238), Child Action Rule (`child-action-rule`, registry.ts:256),
Message Action Catalog (`message-action-catalog`, registry.ts:274), and Action
Data Requirement (`action-data-requirement`, registry.ts:290). Two related
tables are intentionally excluded from this surface altogether:
`FilingSchemaVersion` (schemas are version-controlled files, loaded only via
migration/seed, never edited live) and `FilingMessage` (an audit/queue log, not
configuration) — both per the comment at registry.ts:5-11.

## 2. How a new reference table gets a UI for free

Adding a ninth table means adding one entry to `FILING_CONFIG_TABLES`; nothing
in `src/app/app/filing-config/` or `src/app/api/filing-config/` changes. Each
entry is a `TableDef<TRow>` (registry.ts:50-61): `label`, `description`,
`idField` (the primary key column name — `"id"` for most tables, but
`"code"` for `message-action-catalog` since `code` is that table's real PK,
registry.ts:277), a `fields: FieldDef[]` array, the four CRUD functions
(`list`/`create`/`update`/`remove`, each backed by a Prisma model call wrapped
in `wrapPrismaErrors` to turn P2002/P2025 into `DuplicateConfigRowError`/
`ConfigRowNotFoundError`, registry.ts:160-168), and `createSchema`/
`updateSchema` Zod schemas.

Each `FieldDef` (registry.ts:41-48) is `{ key, label, type, help?, itemFields? }`
where `type` is `"text" | "boolean" | "fieldArray"`. A `fieldArray` field's
`itemFields: SubFieldDef[]` (registry.ts:32-39) describes the shape of each
entry in that array — `SubFieldDef` adds a `"select"` type (with `options`)
that plain `FieldDef` doesn't have. For example, Procedure Mapping is just
three text fields (registry.ts:176-179) backed by `procedureMappingSchema`
(registry.ts:65-69) — that's the entire amount of code needed to get a full
searchable, paginated, CRUD table in the admin screen: no new page, no new
form component, no new API route, just the registry entry and its Zod schema.
The page itself (`src/app/app/filing-config/page.tsx:32-35`) simply maps
`Object.keys(FILING_CONFIG_TABLES)` into the plain serializable `TableMeta[]`
it hands to the client component — function-valued properties like
`list`/`create` can't cross the server→client boundary, so only
`{key, label, description, idField, fields}` is sent (page.tsx:30-34).

## 3. JSON-based dynamic form rendering

`FilingConfigClient.tsx` never hardcodes a form. `TablePanel` renders one
`<table>` column per `table.fields` entry (FilingConfigClient.tsx:232-234) and,
inside `RowFormModal`, iterates the same `table.fields` array to render inputs
(FilingConfigClient.tsx:412-445): a `boolean` field becomes a yes/no `<select>`
(:417-425), a `fieldArray` field is handed off to `FieldArrayEditor`
(:426-433), and anything else (i.e. `"text"`) becomes a plain `<Input>`
(:434-441).

`FieldArrayEditor` (FilingConfigClient.tsx:478-606) renders a `fieldArray`'s
`itemFields` as a collapsible accordion: each array entry is a row with a
summary line (`entrySummary`, :465-470, which titles the row by its first
`itemField` and appends any `"select"`-typed values as badges) that expands to
a small per-field form. Inside that expanded form, each `SubFieldDef` is
switched on its own `type` (:551-590): `boolean` → select, `select` → a
`<select>` built from `sf.options` (:560-571), `fieldArray` → **the same
`FieldArrayEditor` component, called recursively** (:572-583), anything else →
`<Input>`. This recursive call is what renders `action-data-requirement`'s
genuinely self-referencing `fields[].columns[].columns[]...` tree (a
`FilingActionDataRequirement.fields` entry of `type: "grid"` can itself contain
`columns`, which are the same `TFieldEntry` shape, to unlimited depth per the
comment at registry.ts:108-112 and `actionDataRequirements.ts:11-15`).

The server/client-boundary trick is the `columns` sub-field of
`action-data-requirement`'s `fields` itemFields, defined at
registry.ts:312-320: it declares `type: "fieldArray"` but deliberately has
**no `itemFields`** — the comment there explains why: "itemFields
intentionally omitted: the editor reuses this same shape recursively, since a
self-referencing array can't be serialized across the server/client boundary."
On the client, the recursive call falls back with:

```
itemFields={sf.itemFields ?? itemFields}
```

(FilingConfigClient.tsx:578, with the matching dictionary fallback
`dictPath?.[sf.key]?.itemFields ?? dictPath` at :582). When `sf.itemFields` is
`undefined` (as it is for `columns`), the nested editor reuses its own
enclosing `itemFields` — i.e. the same six-field shape (`key`, `label`, `type`,
`required`, `source`, `helpText`, `columns`) — as the shape for the grid's
columns. That is exactly right, because a `columns` entry in
`ActionDataFieldEntry` *is* another `ActionDataFieldEntry`
(`actionDataRequirements.ts:17-26`); the client just re-derives the recursive
type from the one level the server actually sent, instead of the server trying
to serialize an infinite/circular JSON structure (which RSC payloads cannot
represent) down to the client.

## 4. Adding a brand-new workflow's config through this UI, end to end

Say a new action type needs a new operator or field kind on
`FilingActionDataRequirement.fields`. Two source-of-truth types must change,
and neither lives in the UI layer:

1. **`actionDataFieldEntrySchema` / `TFieldEntry`** in `registry.ts:113-138` —
   e.g. widening `type: z.enum([...])` at registry.ts:127 to add a new
   variant, or adding a new optional property to the object.
2. **`ActionDataFieldEntry`** in `src/lib/canonicalMessaging/actionDataRequirements.ts:17-26`
   — the runtime type `resolveActionDataFields`/`buildActionExtensions`
   actually consume (actionDataRequirements.ts:103-141). This type and the Zod
   schema above must stay in sync by hand; nothing enforces that
   automatically.

With those two changed, the admin UI needs **no code change** to let an admin
enter the new field — `FieldArrayEditor` already renders arbitrary
`SubFieldDef`s generically. The one place a new field *type* value does need a
UI change is `registry.ts:308`, where the `"columns"` sub-field's own `type`
selector is hardcoded as a `select` with `options: ["text", "boolean",
"number", "date", "grid"]` — a brand-new enum member has to be added to that
options list to be choosable at all, and if it needs a genuinely new *input
widget* (e.g. a `"date"` type rendered with `<input type="date">` instead of
the generic text `<Input>`), that requires a new case in the sub-field
type switch at `FilingConfigClient.tsx:551-590`, which today only branches on
`"boolean" | "select" | "fieldArray"` and falls through to a plain text
`<Input>` for everything else — so `"date"` and `"number"` values are
currently edited as free-text strings, not native date/number pickers.

## 5. Validation

Every table's `createSchema`/`updateSchema` (registry.ts, e.g.
`procedureMappingSchema` at :65-69 through `actionDataRequirementSchema` at
:140-146) is the single source of truth for what a valid row is. The API
routes call `parseAndValidateBody(req, table.createSchema, requestId)` /
`table.updateSchema` (`src/app/api/filing-config/[table]/route.ts:43`,
`.../[id]/route.ts:25`) before ever touching Prisma, and the `create`/`update`
functions in the registry additionally call `schema.parse(data)` again right
at the Prisma call site (e.g. registry.ts:181-182) — so a row can never reach
the database without passing the same schema twice. There is no
UI-side/client-side duplicate schema: the client only knows field *shape*
metadata (`FieldMeta`/`SubFieldMeta`), not validation rules: it round-trips
whatever the admin typed and lets the server reject it, surfacing
`errorFromResponse` messages back into the modal
(FilingConfigClient.tsx:81-87, :396, :399).

## 6. Access control

Two independent gates enforce platform-admin-only access. The page itself
checks `context.isPlatformAdmin` and renders a "Platform Admin Access
Restricted" card instead of the table UI if false
(`src/app/app/filing-config/page.tsx:11-28`) — this is a UX gate, not a
security boundary. The actual boundary is `requirePlatformAdmin` in both route
files (`.../[table]/route.ts:15-20` and `.../[table]/[id]/route.ts:9-14`),
called at the top of every `GET`/`POST`/`PATCH`/`DELETE` handler before any
table lookup or DB call, returning a 403 `FORBIDDEN` if `ctx.isPlatformAdmin`
is false. The comment at `route.ts:10-14` explains the rationale: these tables
are global, not tenant-scoped, so gating is by the `PLATFORM_ADMIN` role, not
a tenant permission or account type — a change here is visible to every tenant
immediately.

Note: that comment says "these 7 tables," but `FILING_CONFIG_TABLES` registers
8 keys (registry.ts:13-21, :170-331) — the comment appears stale relative to
the current registry (Action Data Requirement was likely added after the
comment was written).

## 7. Current limitations

- **No field-level conditional visibility.** Every `FieldDef`/`SubFieldDef` in
  a table's `fields` (or an itemFields array) is always rendered; there is no
  mechanism to show/hide a field based on another field's value (e.g. showing
  `columns` only when `type === "grid"` — the UI shows the `columns` editor
  for every field row regardless of its `type` selection, registry.ts:312-320).
- **No no-code reordering or renaming of table sections.** The tab order in
  `FilingConfigClient` is simply `Object.keys(FILING_CONFIG_TABLES)` order
  (page.tsx:32, FilingConfigClient.tsx:121-134) — changing the order or
  splitting/merging tables requires editing `registry.ts` source, not a config
  toggle.
- **Admin-entered labels/help text are explicitly out of i18n scope.** The
  comment at `FilingConfigClient.tsx:12-19` states this directly: static
  developer-authored UI chrome (table/field labels, headers) is translated
  through the i18n dictionary via `tableDict`/`fieldLabel`/`fieldHelp`
  (:28-38), but "canonical-schema field labels, and any label an admin types
  into the 'Required Fields' accordion" are deliberately out of scope —
  "runtime content, not something a static compile-time dictionary can cover."
  Those labels are rendered as-is wherever they're consumed downstream (the
  comment points to `FilingDetailClient.tsx`'s `ActionFieldPrompts`).
