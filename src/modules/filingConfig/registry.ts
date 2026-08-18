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
 * 
 * MULTI-COUNTRY MIGRATION NOTE:
 * Many old tables have been dropped and replaced with new design.
 * Commented out entries reference dropped tables.
 */
export type FilingConfigTableKey =
  // NEW TABLES (multi-country design)
  | "transaction-type"
  | "action-catalog"
  | "procedure-config"
  | "action-message-mapping"
  | "action-configuration"
  | "ui-configuration"
  | "master-data-source"
  // KEPT TABLES
  | "action-data-requirement"
  // DROPPED TABLES (commented out - kept for reference)
  // | "procedure-mapping" // DROPPED - replaced by procedure-config
  // | "authority-config" // DROPPED - authority names in UI layer
  // | "message-catalog" // DROPPED - replaced by action-message-mapping
  // | "response-status-mapping" // DROPPED - response handling redesigned
  // | "action-rule" // DROPPED - merged into action-configuration
  // | "child-action-rule" // DROPPED - merged into action-configuration
  // | "message-action-catalog"; // DROPPED - replaced by action-catalog


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

// ============================================================================
// NEW MULTI-COUNTRY SCHEMAS
// ============================================================================

const transactionTypeSchema = z.object({
  code: z.string().trim().min(1).max(50),
  isActive: z.boolean(),
  createdBy: z.string().trim().max(100).optional(),
  updatedBy: z.string().trim().max(100).optional(),
});

const actionCatalogSchema = z.object({
  code: z.string().trim().min(1).max(50),
  isActive: z.boolean(),
  createdBy: z.string().trim().max(100).optional(),
  updatedBy: z.string().trim().max(100).optional(),
});

const procedureConfigSchema = z.object({
  transactionTypeId: z.string().trim().min(1),
  country: z.string().trim().min(1).max(50),
  procedureCode: z.string().trim().min(1).max(50),
  messageName: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
  createdBy: z.string().trim().max(100).optional(),
  updatedBy: z.string().trim().max(100).optional(),
});

const actionMessageMappingSchema = z.object({
  country: z.string().trim().min(1).max(50),
  procedureCode: z.string().trim().min(1).max(50),
  action: z.string().trim().min(1).max(50),
  messageName: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
  createdBy: z.string().trim().max(100).optional(),
  updatedBy: z.string().trim().max(100).optional(),
});

const actionConfigurationSchema = z.object({
  country: z.string().trim().min(1).max(50),
  procedureCode: z.string().trim().min(1).max(50),
  messageName: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(50),
  availableActions: z.array(z.string().trim().min(1).max(50)).max(20),
  allowSubmit: z.boolean(),
  isActive: z.boolean(),
  createdBy: z.string().trim().max(100).optional(),
  updatedBy: z.string().trim().max(100).optional(),
});

// ============================================================================
// OLD SCHEMAS (commented out - tables dropped)
// ============================================================================

// const procedureMappingSchema = z.object({
//   entryType: z.string().trim().min(1).max(50),
//   country: z.string().trim().min(1).max(50),
//   procedureCode: z.string().trim().min(1).max(50),
// });

// const authorityConfigSchema = z.object({
//   country: z.string().trim().min(1).max(50),
//   authorityName: z.string().trim().min(1).max(200),
//   filingSystemLabel: z.string().trim().min(1).max(200),
// });

// const messageCatalogSchema = z.object({
//   action: z.string().trim().min(1).max(50),
//   country: z.string().trim().min(1).max(50),
//   procedureCode: z.string().trim().min(1).max(50),
//   messageName: z.string().trim().min(1).max(100),
//   queueName: z.string().trim().min(1).max(100),
// });

// const responseStatusMappingSchema = z.object({
//   country: z.string().trim().min(1).max(50),
//   messageName: z.string().trim().min(1).max(100),
//   canonicalStatus: z.string().trim().min(1).max(50),
//   filingTransition: z.string().trim().min(1).max(50),
// });

// const actionRuleSchema = z.object({
//   country: z.string().trim().min(1).max(50),
//   procedureCode: z.string().trim().min(1).max(50),
//   messageName: z.string().trim().min(1).max(100),
//   status: z.string().trim().min(1).max(50),
//   allowUpdates: z.boolean(),
// });

// const childActionRuleSchema = z.object({
//   country: z.string().trim().min(1).max(50),
//   procedureCode: z.string().trim().min(1).max(50),
//   messageName: z.string().trim().min(1).max(100),
//   status: z.string().trim().min(1).max(50),
//   action: z.string().trim().min(1).max(50),
// });

// ============================================================================
// KEPT SCHEMAS
// ============================================================================

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

// OLD SCHEMA (commented out - FilingMessageActionCatalog dropped, replaced by FilingActionCatalog)
// const messageActionCatalogCreateSchema = z.object({
//   code: z.string().trim().min(1).max(50),
//   label: z.string().trim().min(1).max(100),
//   requiresPriorMessage: z.boolean(),
// });
// const messageActionCatalogUpdateSchema = messageActionCatalogCreateSchema.omit({ code: true });

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
  // ============================================================================
  // NEW MULTI-COUNTRY TABLES (stubs - TODO: Implement full UI)
  // ============================================================================
  "transaction-type": {
    label: "Transaction Type",
    description: "Universal transaction types (IMPORT, EXPORT, NCTS, etc.)",
    idField: "id",
    fields: [
      { key: "code", label: "Code", type: "text" },
      { key: "isActive", label: "Is Active", type: "boolean" },
    ],
    list: () => db.filingTransactionType.findMany({ orderBy: { code: "asc" } }),
    create: (data) => wrapPrismaErrors(() => db.filingTransactionType.create({ data: transactionTypeSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingTransactionType.update({ where: { id }, data: transactionTypeSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingTransactionType.delete({ where: { id } })).then(() => undefined),
    createSchema: transactionTypeSchema,
    updateSchema: transactionTypeSchema,
  },
  "action-catalog": {
    label: "Action Catalog",
    description: "Universal action codes (SUBMIT, AMENDMENT, CANCELLATION, etc.)",
    idField: "id",
    fields: [
      { key: "code", label: "Code", type: "text" },
      { key: "isActive", label: "Is Active", type: "boolean" },
    ],
    list: () => db.filingActionCatalog.findMany({ orderBy: { code: "asc" } }),
    create: (data) => wrapPrismaErrors(() => db.filingActionCatalog.create({ data: actionCatalogSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingActionCatalog.update({ where: { id }, data: actionCatalogSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingActionCatalog.delete({ where: { id } })).then(() => undefined),
    createSchema: actionCatalogSchema,
    updateSchema: actionCatalogSchema,
  },
  "procedure-config": {
    label: "Procedure Configuration",
    description: "(transactionType, country, procedureCode, messageName) - lists valid messages per country/procedure",
    idField: "id",
    fields: [
      { key: "transactionType.code", label: "Transaction Type", type: "text" },
      { key: "country", label: "Country", type: "text" },
      { key: "procedureCode", label: "Procedure Code", type: "text" },
      { key: "messageName", label: "Message Name", type: "text" },
      { key: "isActive", label: "Is Active", type: "boolean" },
    ],
    list: () => db.filingProcedureConfig.findMany({ 
      orderBy: [{ country: "asc" }, { procedureCode: "asc" }],
      include: { transactionType: { select: { code: true } } }
    }),
    create: (data) => wrapPrismaErrors(() => db.filingProcedureConfig.create({ data: procedureConfigSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingProcedureConfig.update({ where: { id }, data: procedureConfigSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingProcedureConfig.delete({ where: { id } })).then(() => undefined),
    createSchema: procedureConfigSchema,
    updateSchema: procedureConfigSchema,
  },
  "action-message-mapping": {
    label: "Action Message Mapping",
    description: "(country, procedureCode, action) → messageName - maps user actions to outbound messages",
    idField: "id",
    fields: [
      { key: "transactionType", label: "Transaction Type", type: "text" },
      { key: "country", label: "Country", type: "text" },
      { key: "procedureCode", label: "Procedure Code", type: "text" },
      { key: "action", label: "Action", type: "text" },
      { key: "messageName", label: "Message Name", type: "text" },
      { key: "isActive", label: "Is Active", type: "boolean" },
    ],
    list: async () => {
      const rows = await db.filingActionMessageMapping.findMany({ 
        orderBy: [{ country: "asc" }, { action: "asc" }] 
      });
      
      // Get unique (country, procedureCode) pairs for lookup
      const uniquePairs = Array.from(
        new Set(rows.map(r => `${r.country}|${r.procedureCode}`))
      );
      
      // Fetch transaction types for all procedure codes
      const procedureConfigs = await db.filingProcedureConfig.findMany({
        where: {
          OR: uniquePairs.map(pair => {
            const [country, procedureCode] = pair.split('|');
            return { country, procedureCode };
          })
        },
        include: {
          transactionType: {
            select: { code: true }
          }
        }
      });
      
      // Create lookup map
      const transactionTypeMap = new Map(
        procedureConfigs.map(pc => [
          `${pc.country}|${pc.procedureCode}`,
          pc.transactionType?.code || null
        ])
      );
      
      // Enrich rows with transaction type
      return rows.map(row => ({
        ...row,
        transactionType: transactionTypeMap.get(`${row.country}|${row.procedureCode}`) || '—'
      }));
    },
    create: (data) => wrapPrismaErrors(() => db.filingActionMessageMapping.create({ data: actionMessageMappingSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingActionMessageMapping.update({ where: { id }, data: actionMessageMappingSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingActionMessageMapping.delete({ where: { id } })).then(() => undefined),
    createSchema: actionMessageMappingSchema,
    updateSchema: actionMessageMappingSchema,
  },
  "action-configuration": {
    label: "Action Configuration",
    description: "(country, procedureCode, messageName, status) → availableActions, allowSubmit - determines UI actions",
    idField: "id",
    fields: [
      { key: "transactionType", label: "Transaction Type", type: "text" },
      { key: "country", label: "Country", type: "text" },
      { key: "procedureCode", label: "Procedure Code", type: "text" },
      { key: "messageName", label: "Message Name", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { 
        key: "availableActions", 
        label: "Available Actions", 
        type: "fieldArray",
        help: "List of actions available in this state. Select from the Action Catalog.",
        itemFields: [
          { 
            key: "action", 
            label: "Action", 
            type: "select",
            // Will be populated dynamically - see getFilingConfigTableMeta()
            options: [],
            help: "Select an action from the catalog" 
          }
        ]
      },
      { key: "allowSubmit", label: "Allow Submit", type: "boolean" },
      { key: "isActive", label: "Is Active", type: "boolean" },
    ],
    list: async () => {
      const rows = await db.filingActionConfiguration.findMany({ 
        orderBy: [{ country: "asc" }, { status: "asc" }] 
      });
      
      // Get unique (country, procedureCode) pairs for lookup
      const uniquePairs = Array.from(
        new Set(rows.map(r => `${r.country}|${r.procedureCode}`))
      );
      
      // Fetch transaction types for all procedure codes
      const procedureConfigs = await db.filingProcedureConfig.findMany({
        where: {
          OR: uniquePairs.map(pair => {
            const [country, procedureCode] = pair.split('|');
            return { country, procedureCode };
          })
        },
        include: {
          transactionType: {
            select: { code: true }
          }
        },
        distinct: ['country', 'procedureCode']
      });
      
      // Create lookup map
      const transactionTypeMap = new Map(
        procedureConfigs.map(pc => [
          `${pc.country}|${pc.procedureCode}`,
          pc.transactionType?.code || null
        ])
      );
      
      // Transform string[] to object[] for UI and add transaction type
      return rows.map((row) => ({
        ...row,
        transactionType: transactionTypeMap.get(`${row.country}|${row.procedureCode}`) || '—',
        availableActions: row.availableActions.map((action) => ({ action })),
      }));
    },
    create: async (data) => {
      // Transform object[] back to string[] for database
      const transformed = {
        ...data,
        availableActions: Array.isArray(data.availableActions) 
          ? (data.availableActions as Array<{ action: string }>).map((item) => item.action)
          : [],
      };
      return wrapPrismaErrors(() => db.filingActionConfiguration.create({ data: actionConfigurationSchema.parse(transformed) }));
    },
    update: async (id, data) => {
      // Transform object[] back to string[] for database
      const transformed = {
        ...data,
        availableActions: Array.isArray(data.availableActions) 
          ? (data.availableActions as Array<{ action: string }>).map((item) => item.action)
          : [],
      };
      return wrapPrismaErrors(() => db.filingActionConfiguration.update({ where: { id }, data: actionConfigurationSchema.parse(transformed) }));
    },
    remove: (id) => wrapPrismaErrors(() => db.filingActionConfiguration.delete({ where: { id } })).then(() => undefined),
    createSchema: actionConfigurationSchema,
    updateSchema: actionConfigurationSchema,
  },
  // ============================================================================
  // KEPT TABLE (existing functionality)
  // ============================================================================
  "action-data-requirement": {
    label: "Action Data Requirement",
    description:
      "(country, procedure, messageName, action) → extra fields a child action needs beyond the declaration itself (e.g. a guarantee reference a German NCTS cancellation needs that a US consumption cancellation doesn't). No match = no extra fields required -- cancelFiling()/amendFiling() stay single, country-agnostic implementations that just ask this table what a context needs.",
    idField: "id",
    fields: [
      { key: "transactionType", label: "Transaction Type", type: "text" },
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
    list: async () => {
      const rows = await db.filingActionDataRequirement.findMany({ 
        orderBy: [{ country: "asc" }, { action: "asc" }] 
      });
      
      // Get unique (country, procedureCode) pairs for lookup
      // Filter out wildcards as they don't have a specific transaction type
      const uniquePairs = Array.from(
        new Set(
          rows
            .filter(r => r.country !== '*' && r.procedureCode !== '*')
            .map(r => `${r.country}|${r.procedureCode}`)
        )
      );
      
      // Fetch transaction types for all procedure codes
      const procedureConfigs = await db.filingProcedureConfig.findMany({
        where: {
          OR: uniquePairs.map(pair => {
            const [country, procedureCode] = pair.split('|');
            return { country, procedureCode };
          })
        },
        include: {
          transactionType: {
            select: { code: true }
          }
        },
        distinct: ['country', 'procedureCode']
      });
      
      // Create lookup map
      const transactionTypeMap = new Map(
        procedureConfigs.map(pc => [
          `${pc.country}|${pc.procedureCode}`,
          pc.transactionType?.code || null
        ])
      );
      
      // Enrich rows with transaction type
      return rows.map(row => ({
        ...row,
        transactionType: row.country === '*' || row.procedureCode === '*' 
          ? '*' 
          : transactionTypeMap.get(`${row.country}|${row.procedureCode}`) || '—'
      }));
    },
    create: (data) => wrapPrismaErrors(() => db.filingActionDataRequirement.create({ data: actionDataRequirementSchema.parse(data) })),
    update: (id, data) => wrapPrismaErrors(() => db.filingActionDataRequirement.update({ where: { id }, data: actionDataRequirementSchema.parse(data) })),
    remove: (id) => wrapPrismaErrors(() => db.filingActionDataRequirement.delete({ where: { id } })).then(() => undefined),
    createSchema: actionDataRequirementSchema,
    updateSchema: actionDataRequirementSchema,
  },

  // ============================================================================
  // UI CONFIGURATION TABLES
  // ============================================================================

  "ui-configuration": {
    label: "UI Configuration",
    description: "Configure form fields and layouts for declaration and response views",
    idField: "id",
    fields: [
      { key: "country", label: "Country", type: "text" },
      { key: "procedureCode", label: "Procedure Code", type: "text" },
      { key: "messageName", label: "Message Name", type: "text" },
      { key: "messageType", label: "Message Type", type: "text", help: "request or response" },
      { key: "transactionType", label: "Transaction Type", type: "text", help: "import or export" },
      { key: "version", label: "Version", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "totalFields", label: "Total Fields", type: "text", help: "Number of configured fields" },
      { key: "isActive", label: "Active", type: "boolean" },
      { key: "updatedAt", label: "Updated At", type: "text" },
      { key: "createdBy", label: "Created By", type: "text" },
      { key: "updatedBy", label: "Updated By", type: "text" },
    ],
    list: async () => {
      const rows = await db.filingUIConfig.findMany({
        where: { isActive: true },
        orderBy: [
          { country: "asc" },
          { procedureCode: "asc" },
          { messageName: "asc" },
          { messageType: "asc" },
          { transactionType: "asc" },
        ],
      });
      
      // Transform rows to include totalFields from configData
      return rows.map(row => ({
        id: row.id,
        country: row.country,
        procedureCode: row.procedureCode,
        messageName: row.messageName,
        messageType: row.messageType,
        transactionType: row.transactionType,
        version: row.version,
        description: row.description,
        totalFields: (row.configData as any)?.fields?.length || 0,
        isActive: row.isActive,
        updatedAt: row.updatedAt.toISOString(),
        createdBy: row.createdBy,
        updatedBy: row.updatedBy,
      }));
    },
    create: (data) => wrapPrismaErrors(() => db.filingUIConfig.create({ 
      data: {
        country: String(data.country || ""),
        procedureCode: String(data.procedureCode || ""),
        messageName: String(data.messageName || ""),
        messageType: String(data.messageType || "request"),
        transactionType: String(data.transactionType || "import"),
        configData: data.configData || { fields: [], totalFields: 0, sections: [] },
        version: Number(data.version || 1),
        description: data.description ? String(data.description) : null,
        isActive: data.isActive !== false,
        createdBy: data.createdBy ? String(data.createdBy) : 'system',
        updatedBy: data.updatedBy ? String(data.updatedBy) : 'system',
      } 
    })),
    update: (id, data) => wrapPrismaErrors(() => db.filingUIConfig.update({ 
      where: { id }, 
      data: {
        country: data.country ? String(data.country) : undefined,
        procedureCode: data.procedureCode ? String(data.procedureCode) : undefined,
        messageName: data.messageName ? String(data.messageName) : undefined,
        messageType: data.messageType ? String(data.messageType) : undefined,
        transactionType: data.transactionType ? String(data.transactionType) : undefined,
        configData: data.configData || undefined,
        version: data.version !== undefined ? Number(data.version) : undefined,
        description: data.description !== undefined ? String(data.description) : undefined,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : undefined,
        updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
      } 
    })),
    remove: (id) => wrapPrismaErrors(() => db.filingUIConfig.delete({ where: { id } })).then(() => undefined),
    createSchema: z.object({
      country: z.string(),
      procedureCode: z.string(),
      messageName: z.string(),
      messageType: z.enum(["request", "response"]),
      transactionType: z.enum(["import", "export"]).default("import"),
      configData: z.object({
        fields: z.array(z.any()),
        totalFields: z.number(),
        sections: z.array(z.string()),
      }),
      description: z.string().optional(),
      isActive: z.boolean().default(true),
      createdBy: z.string().optional(),
      updatedBy: z.string().optional(),
    }),
    updateSchema: z.object({
      country: z.string().optional(),
      procedureCode: z.string().optional(),
      messageName: z.string().optional(),
      messageType: z.enum(["request", "response"]).optional(),
      transactionType: z.enum(["import", "export"]).optional(),
      configData: z.object({
        fields: z.array(z.any()),
        totalFields: z.number(),
        sections: z.array(z.string()),
      }).optional(),
      version: z.number().optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
      updatedBy: z.string().optional(),
    }),
  },

  "master-data-source": {
    label: "Master Data Sources",
    description: "Define master data sources for dropdown and lookup fields",
    idField: "id",
    fields: [
      { key: "sourceName", label: "Source Name", type: "text", help: "Unique identifier (e.g., Country, Currency)" },
      { key: "sourceType", label: "Source Type", type: "text", help: "table, enum, api, or static" },
      { key: "tableName", label: "Table Name", type: "text", help: "Prisma model name for table-based sources" },
      { key: "valueField", label: "Value Field", type: "text", help: "Field to use as option value" },
      { key: "labelField", label: "Label Field", type: "text", help: "Field to use as option label" },
      { key: "apiEndpoint", label: "API Endpoint", type: "text", help: "For API-based sources" },
      { key: "apiMethod", label: "API Method", type: "text" },
      { key: "isActive", label: "Active", type: "boolean" },
    ],
    list: async () => {
      const rows = await db.filingMasterDataSource.findMany({
        orderBy: { sourceName: "asc" },
      });
      return rows;
    },
    create: (data) => wrapPrismaErrors(() => db.filingMasterDataSource.create({ 
      data: {
        sourceName: String(data.sourceName || ""),
        sourceType: String(data.sourceType || "static"),
        tableName: data.tableName ? String(data.tableName) : null,
        valueField: data.valueField ? String(data.valueField) : null,
        labelField: data.labelField ? String(data.labelField) : null,
        apiEndpoint: data.apiEndpoint ? String(data.apiEndpoint) : null,
        apiMethod: String(data.apiMethod || "GET"),
        isActive: data.isActive !== false,
      } 
    })),
    update: (id, data) => wrapPrismaErrors(() => db.filingMasterDataSource.update({ 
      where: { id }, 
      data: {
        sourceName: data.sourceName ? String(data.sourceName) : undefined,
        sourceType: data.sourceType ? String(data.sourceType) : undefined,
        tableName: data.tableName !== undefined ? (data.tableName ? String(data.tableName) : null) : undefined,
        valueField: data.valueField !== undefined ? (data.valueField ? String(data.valueField) : null) : undefined,
        labelField: data.labelField !== undefined ? (data.labelField ? String(data.labelField) : null) : undefined,
        apiEndpoint: data.apiEndpoint !== undefined ? (data.apiEndpoint ? String(data.apiEndpoint) : null) : undefined,
        apiMethod: data.apiMethod ? String(data.apiMethod) : undefined,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : undefined,
      } 
    })),
    remove: (id) => wrapPrismaErrors(() => db.filingMasterDataSource.delete({ where: { id } })).then(() => undefined),
    createSchema: z.object({
      sourceName: z.string(),
      sourceType: z.enum(["table", "enum", "api", "static"]),
      tableName: z.string().optional(),
      valueField: z.string().optional(),
      labelField: z.string().optional(),
      apiEndpoint: z.string().optional(),
      apiMethod: z.string().default("GET"),
      isActive: z.boolean().default(true),
    }),
    updateSchema: z.object({
      sourceName: z.string().optional(),
      sourceType: z.enum(["table", "enum", "api", "static"]).optional(),
      tableName: z.string().optional(),
      valueField: z.string().optional(),
      labelField: z.string().optional(),
      apiEndpoint: z.string().optional(),
      apiMethod: z.string().optional(),
      isActive: z.boolean().optional(),
    }),
  },
};

/**
 * Get table metadata with dynamically populated options (for select fields)
 * This is called from the page component to populate dropdown options from the database
 */
export async function getFilingConfigTableMeta(tableKey: FilingConfigTableKey): Promise<TableMeta<unknown>> {
  const tableDef = FILING_CONFIG_TABLES[tableKey];
  
  // For action-configuration table, populate action options from FilingActionCatalog
  if (tableKey === "action-configuration") {
    const actions = await db.filingActionCatalog.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true }
    });
    const actionOptions = actions.map(a => a.code);

    // Deep clone and update the itemFields options
    const fieldsWithOptions: FieldDef[] = tableDef.fields.map(field => {
      if (field.key === "availableActions" && field.type === "fieldArray" && field.itemFields) {
        return {
          ...field,
          itemFields: field.itemFields.map(subField => {
            if (subField.key === "action" && subField.type === "select") {
              return { ...subField, options: actionOptions };
            }
            return subField;
          })
        };
      }
      return field;
    });

    return {
      ...tableDef,
      fields: fieldsWithOptions
    };
  }

  return tableDef;
}

type TableMeta<TRow> = Omit<TableDef<TRow>, 'list' | 'create' | 'update' | 'remove' | 'createSchema' | 'updateSchema'>;

export function isFilingConfigTableKey(key: string): key is FilingConfigTableKey {
  return Object.prototype.hasOwnProperty.call(FILING_CONFIG_TABLES, key);
}
