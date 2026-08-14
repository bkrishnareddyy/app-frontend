import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Every genuinely global (non-tenant-scoped) reference table the filing
 * workflow reads from. FilingSchemaVersion is deliberately excluded --
 * schemas are authored as version-controlled files and loaded via
 * migration/seed only, never edited live through a runtime admin surface.
 * FilingMessage is excluded too: it's an audit/queue log of real messages,
 * not configuration.
 */
export type FilingConfigTableKey =
  | "procedure-mapping"
  | "authority-config"
  | "message-catalog"
  | "response-status-mapping"
  | "action-rule"
  | "child-action-rule"
  | "message-action-catalog"
  | "action-data-requirement";

/**
 * The shape of one entry inside a "fieldArray" column -- e.g. one required
 * field of an action-data requirement. type "fieldArray" here makes THIS
 * sub-field itself a nested list (e.g. a "columns" property whose own rows
 * need describing) -- if itemFields is omitted for a nested fieldArray, the
 * editor reuses its own current itemFields, which is how an arbitrarily deep
 * tree (GoodsItem -> Packages -> ...) renders without the server having to
 * serialize a circular structure across the server/client boundary.
 */
export interface SubFieldDef {
  key: string;
  label: string;
  type: "text" | "boolean" | "select" | "fieldArray";
  options?: string[];
  help?: string;
  itemFields?: SubFieldDef[];
}

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "boolean" | "fieldArray";
  help?: string;
  /** Only present when type === "fieldArray": the shape of each entry in the array. */
  itemFields?: SubFieldDef[];
}

interface TableDef<TRow> {
  label: string;
  description: string;
  idField: string;
  fields: FieldDef[];
  list(): Promise<TRow[]>;
  create(data: Record<string, unknown>): Promise<TRow>;
  update(id: string, data: Record<string, unknown>): Promise<TRow>;
  remove(id: string): Promise<void>;
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
}

const wildcardHelp = '"*" matches any value (wildcard fallback) when no more specific row exists.';

const procedureMappingSchema = z.object({
  entryType: z.string().trim().min(1).max(50),
  country: z.string().trim().min(1).max(50),
  procedureCode: z.string().trim().min(1).max(50),
});

const authorityConfigSchema = z.object({
  country: z.string().trim().min(1).max(50),
  authorityName: z.string().trim().min(1).max(200),
  filingSystemLabel: z.string().trim().min(1).max(200),
});

const messageCatalogSchema = z.object({
  action: z.string().trim().min(1).max(50),
  country: z.string().trim().min(1).max(50),
  procedureCode: z.string().trim().min(1).max(50),
  messageName: z.string().trim().min(1).max(100),
  queueName: z.string().trim().min(1).max(100),
});

const responseStatusMappingSchema = z.object({
  country: z.string().trim().min(1).max(50),
  messageName: z.string().trim().min(1).max(100),
  canonicalStatus: z.string().trim().min(1).max(50),
  filingTransition: z.string().trim().min(1).max(50),
});

const actionRuleSchema = z.object({
  country: z.string().trim().min(1).max(50),
  procedureCode: z.string().trim().min(1).max(50),
  messageName: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(50),
  allowUpdates: z.boolean(),
});

const childActionRuleSchema = z.object({
  country: z.string().trim().min(1).max(50),
  procedureCode: z.string().trim().min(1).max(50),
  messageName: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(50),
  action: z.string().trim().min(1).max(50),
});

// Recursive: type "grid" makes a field a list of rows shaped by `columns`,
// and a column can itself be another grid to any depth (e.g. a GoodsItem
// grid whose rows each contain a nested Packages grid). z.lazy() is required
// for a self-referencing Zod schema; TFieldEntry gives it an explicit type
// since Zod can't infer a recursive type on its own.
type TFieldEntry = {
  key: string;
  label: string;
  type: "text" | "boolean" | "number" | "date" | "grid";
  required: boolean;
  source: string;
  helpText?: string;
  columns?: TFieldEntry[];
};

const actionDataFieldEntrySchema: z.ZodType<TFieldEntry> = z.lazy(() =>
  z.object({
    key: z.string().trim().min(1).max(50),
    label: z.string().trim().min(1).max(100),
    type: z.enum(["text", "boolean", "number", "date", "grid"]),
    // Applies to the whole field, never to an individual data row: for a
    // grid this means "at least one row", not "every row/column populated".
    required: z.boolean(),
    // "prompt" (operator supplies it when the action is invoked) or
    // "shipment.<dotted.path>" (resolved automatically, never asked of the operator).
    source: z.string().trim().min(1).max(200),
    helpText: z.string().trim().max(300).optional(),
    // Only meaningful when type === "grid": the shape of each row, recursively.
    columns: z.array(actionDataFieldEntrySchema).max(50).optional(),
  })
);

const actionDataRequirementSchema = z.object({
  country: z.string().trim().min(1).max(50),
  procedureCode: z.string().trim().min(1).max(50),
  messageName: z.string().trim().min(1).max(100),
  action: z.string().trim().min(1).max(50),
  fields: z.array(actionDataFieldEntrySchema).max(50),
});

const messageActionCatalogCreateSchema = z.object({
  code: z.string().trim().min(1).max(50),
  label: z.string().trim().min(1).max(100),
  requiresPriorMessage: z.boolean(),
});
const messageActionCatalogUpdateSchema = messageActionCatalogCreateSchema.omit({ code: true });

/** P2002 (unique constraint) -> a clear, expected 409, not a generic 500. */
export class DuplicateConfigRowError extends Error {}
/** P2025 (row not found for update/delete) -> a clear 404. */
export class ConfigRowNotFoundError extends Error {}

function wrapPrismaErrors<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") throw new DuplicateConfigRowError("A row with this combination already exists.");
      if (err.code === "P2025") throw new ConfigRowNotFoundError("Row not found.");
    }
    throw err;
  });
}

export const FILING_CONFIG_TABLES: Record<FilingConfigTableKey, TableDef<unknown>> = {
  "procedure-mapping": {
    label: "Procedure Mapping",
    description: "(entryType, country) → the third-party procedure code used to file that entry type in that country.",
    idField: "id",
    fields: [
      { key: "entryType", label: "Entry Type", type: "text" },
      { key: "country", label: "Country", type: "text", help: 'ISO 3166-1 alpha-2, or "*". ' + wildcardHelp },
      { key: "procedureCode", label: "Procedure Code", type: "text" },
    ],
    list: () => db.filingProcedureMapping.findMany({ orderBy: [{ country: "asc" }, { entryType: "asc" }] }),
    create: (data) => wrapPrismaErrors(() => db.filingProcedureMapping.create({ data: procedureMappingSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingProcedureMapping.update({ where: { id }, data: procedureMappingSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingProcedureMapping.delete({ where: { id } })).then(() => undefined),
    createSchema: procedureMappingSchema,
    updateSchema: procedureMappingSchema,
  },
  "authority-config": {
    label: "Authority Config",
    description: "country → the filing authority name and filing-system label used on every filing for that destination. No wildcard fallback.",
    idField: "id",
    fields: [
      { key: "country", label: "Country", type: "text", help: "ISO 3166-1 alpha-2. Must be unique -- no wildcard fallback for authority." },
      { key: "authorityName", label: "Authority Name", type: "text" },
      { key: "filingSystemLabel", label: "Filing System Label", type: "text" },
    ],
    list: () => db.filingAuthorityConfig.findMany({ orderBy: { country: "asc" } }),
    create: (data) => wrapPrismaErrors(() => db.filingAuthorityConfig.create({ data: authorityConfigSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingAuthorityConfig.update({ where: { id }, data: authorityConfigSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingAuthorityConfig.delete({ where: { id } })).then(() => undefined),
    createSchema: authorityConfigSchema,
    updateSchema: authorityConfigSchema,
  },
  "message-catalog": {
    label: "Message Catalog",
    description: "(action, country, procedure) → our own internal messageName + queueName. Usually wildcard country (\"*\") -- our message vocabulary doesn't vary by destination.",
    idField: "id",
    fields: [
      { key: "action", label: "Action", type: "text" },
      { key: "country", label: "Country", type: "text", help: wildcardHelp },
      { key: "procedureCode", label: "Procedure Code", type: "text", help: wildcardHelp },
      { key: "messageName", label: "Message Name", type: "text" },
      { key: "queueName", label: "Queue Name", type: "text" },
    ],
    list: () => db.filingMessageCatalog.findMany({ orderBy: [{ action: "asc" }, { country: "asc" }] }),
    create: (data) => wrapPrismaErrors(() => db.filingMessageCatalog.create({ data: messageCatalogSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingMessageCatalog.update({ where: { id }, data: messageCatalogSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingMessageCatalog.delete({ where: { id } })).then(() => undefined),
    createSchema: messageCatalogSchema,
    updateSchema: messageCatalogSchema,
  },
  "response-status-mapping": {
    label: "Response Status Mapping",
    description: "(country, messageName, canonicalStatus) → which filing-status transition to apply when a response arrives. Usually wildcard country -- response semantics don't vary by destination.",
    idField: "id",
    fields: [
      { key: "country", label: "Country", type: "text", help: wildcardHelp },
      { key: "messageName", label: "Message Name", type: "text", help: wildcardHelp },
      { key: "canonicalStatus", label: "Canonical Status", type: "text", help: "The status value the third-party response carries (e.g. ACCEPTED, REJECTED, CANCELLED)." },
      { key: "filingTransition", label: "Filing Transition", type: "text", help: "Must name a real transition in filingStateMachine.ts. An unrecognized name is logged as a warning and does nothing -- it does not crash message processing." },
    ],
    list: () => db.filingResponseStatusMapping.findMany({ orderBy: [{ country: "asc" }, { messageName: "asc" }] }),
    create: (data) => wrapPrismaErrors(() => db.filingResponseStatusMapping.create({ data: responseStatusMappingSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingResponseStatusMapping.update({ where: { id }, data: responseStatusMappingSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingResponseStatusMapping.delete({ where: { id } })).then(() => undefined),
    createSchema: responseStatusMappingSchema,
    updateSchema: responseStatusMappingSchema,
  },
  "action-rule": {
    label: "Action Rule",
    description: "(country, procedure, messageName, status) → whether the declaration can currently be edited/resubmitted. No match defaults to false (fail closed).",
    idField: "id",
    fields: [
      { key: "country", label: "Country", type: "text", help: wildcardHelp },
      { key: "procedureCode", label: "Procedure Code", type: "text", help: wildcardHelp },
      { key: "messageName", label: "Message Name", type: "text", help: wildcardHelp },
      { key: "status", label: "Status", type: "text", help: wildcardHelp + " Must otherwise name a real FilingStatus." },
      { key: "allowUpdates", label: "Allow Updates", type: "boolean" },
    ],
    list: () => db.filingActionRule.findMany({ orderBy: [{ country: "asc" }, { status: "asc" }] }),
    create: (data) => wrapPrismaErrors(() => db.filingActionRule.create({ data: actionRuleSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingActionRule.update({ where: { id }, data: actionRuleSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingActionRule.delete({ where: { id } })).then(() => undefined),
    createSchema: actionRuleSchema,
    updateSchema: actionRuleSchema,
  },
  "child-action-rule": {
    label: "Child Action Rule",
    description: "(country, procedure, messageName, status, action) → whether this extra action (e.g. CANCEL) is offered right now. A row's mere existence means yes.",
    idField: "id",
    fields: [
      { key: "country", label: "Country", type: "text", help: wildcardHelp },
      { key: "procedureCode", label: "Procedure Code", type: "text", help: wildcardHelp },
      { key: "messageName", label: "Message Name", type: "text", help: wildcardHelp },
      { key: "status", label: "Status", type: "text", help: wildcardHelp + " Must otherwise name a real FilingStatus." },
      { key: "action", label: "Action", type: "text", help: "e.g. CANCEL. Must have an entry in Message Action Catalog to mean anything in the UI's action registry." },
    ],
    list: () => db.filingChildActionRule.findMany({ orderBy: [{ country: "asc" }, { status: "asc" }, { action: "asc" }] }),
    create: (data) => wrapPrismaErrors(() => db.filingChildActionRule.create({ data: childActionRuleSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingChildActionRule.update({ where: { id }, data: childActionRuleSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingChildActionRule.delete({ where: { id } })).then(() => undefined),
    createSchema: childActionRuleSchema,
    updateSchema: childActionRuleSchema,
  },
  "message-action-catalog": {
    label: "Message Action Catalog",
    description: "The closed vocabulary of valid message actions (SUBMIT, RESUBMIT, CANCELLATION, ...). code is the primary key -- it cannot be changed after creation.",
    idField: "code",
    fields: [
      { key: "code", label: "Code", type: "text", help: "Primary key. Cannot be edited after creation -- delete and recreate instead." },
      { key: "label", label: "Label", type: "text" },
      { key: "requiresPriorMessage", label: "Requires Prior Message", type: "boolean" },
    ],
    list: () => db.filingMessageActionCatalog.findMany({ orderBy: { code: "asc" } }),
    create: (data) => wrapPrismaErrors(() => db.filingMessageActionCatalog.create({ data: messageActionCatalogCreateSchema.parse(data) })),
    update: (code, data) => wrapPrismaErrors(() => db.filingMessageActionCatalog.update({ where: { code }, data: messageActionCatalogUpdateSchema.parse(data) })),
    remove: (code) => wrapPrismaErrors(() => db.filingMessageActionCatalog.delete({ where: { code } })).then(() => undefined),
    createSchema: messageActionCatalogCreateSchema,
    updateSchema: messageActionCatalogUpdateSchema,
  },
  "action-data-requirement": {
    label: "Action Data Requirement",
    description:
      "(country, procedure, messageName, action) → extra fields a child action needs beyond the declaration itself (e.g. a guarantee reference a German NCTS cancellation needs that a US consumption cancellation doesn't). No match = no extra fields required -- cancelFiling()/amendFiling() stay single, country-agnostic implementations that just ask this table what a context needs.",
    idField: "id",
    fields: [
      { key: "country", label: "Country", type: "text", help: wildcardHelp },
      { key: "procedureCode", label: "Procedure Code", type: "text", help: wildcardHelp },
      { key: "messageName", label: "Message Name", type: "text", help: wildcardHelp },
      { key: "action", label: "Action", type: "text", help: "e.g. CANCELLATION, AMENDMENT -- a FilingMessageActionCatalog code." },
      {
        key: "fields",
        label: "Required Fields",
        type: "fieldArray",
        help: 'Each field is either "prompt" (the operator supplies it when invoking the action) or "shipment.<dotted.path>" (resolved automatically, never asked of the operator).',
        itemFields: [
          { key: "key", label: "Field Key", type: "text", help: "The key this value is stored under in the message's extensions." },
          { key: "label", label: "Display Label", type: "text" },
          { key: "type", label: "Type", type: "select", options: ["text", "boolean", "number", "date", "grid"] },
          { key: "required", label: "Required", type: "boolean", help: "Applies to the whole field, always -- for a grid, means at least one row. Never set per data row." },
          { key: "source", label: "Source", type: "text", help: '"prompt" or "shipment.<dotted.path>"' },
          { key: "helpText", label: "Help Text (optional)", type: "text" },
          {
            key: "columns",
            label: "Grid Columns (only used when Type = grid)",
            type: "fieldArray",
            help: 'Defines each row\'s own fields. Set a column\'s own Type to "grid" to nest another list inside it (e.g. GoodsItem rows each containing a Packages grid) -- no depth limit.',
            // itemFields intentionally omitted: the editor reuses this same
            // shape recursively, since a self-referencing array can't be
            // serialized across the server/client boundary.
          },
        ],
      },
    ],
    list: () => db.filingActionDataRequirement.findMany({ orderBy: [{ country: "asc" }, { action: "asc" }] }),
    create: (data) => wrapPrismaErrors(() => db.filingActionDataRequirement.create({ data: actionDataRequirementSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingActionDataRequirement.update({ where: { id }, data: actionDataRequirementSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingActionDataRequirement.delete({ where: { id } })).then(() => undefined),
    createSchema: actionDataRequirementSchema,
    updateSchema: actionDataRequirementSchema,
  },
};

export function isFilingConfigTableKey(key: string): key is FilingConfigTableKey {
  return Object.prototype.hasOwnProperty.call(FILING_CONFIG_TABLES, key);
}
