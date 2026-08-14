import { db } from "@/lib/db";
import { findMostSpecificMatch } from "./wildcardLookup";

/**
 * One entry inside a FilingActionDataRequirement.fields tree. `source` is
 * either "prompt" (the operator supplies it when invoking the action) or
 * "shipment.<dotted.path>" (resolved automatically -- never asked of the
 * operator). `required` describes the field's own definition and is applied
 * uniformly wherever the field occurs; it is never a per-row setting.
 *
 * type: "grid" makes this field a list of rows, each shaped by `columns` --
 * and a column can itself be another grid, to any depth (e.g. a GoodsItem
 * grid whose rows each contain a nested Packages grid). For a grid,
 * `required` means "at least one row", not "every column of every row
 * populated" -- each column's own `required` still applies within each row.
 */
export interface ActionDataFieldEntry {
  key: string;
  label: string;
  type: "text" | "boolean" | "number" | "date" | "grid";
  required: boolean;
  source: string;
  helpText?: string;
  /** Only present when type === "grid": the shape of each row, recursively. */
  columns?: ActionDataFieldEntry[];
}

/** Thrown when a required field (or, for a grid, its minimum one row) wasn't supplied. Maps to a 400 at the route boundary. */
export class MissingActionFieldError extends Error {
  constructor(
    readonly fieldKey: string,
    readonly fieldLabel: string
  ) {
    super(`"${fieldLabel}" is required to send this action.`);
    this.name = "MissingActionFieldError";
  }
}

function getByPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc !== null && typeof acc === "object" && segment in (acc as object)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

/**
 * Resolves one field against its own local scope. For a top-level field,
 * `localContext`/`localPrompted` are the overall shipment context and the
 * operator's top-level prompted values. For a column nested inside a grid
 * row, both are scoped to that one row -- "shipment.weight" on a Packages
 * column reads the current package's own weight, not anything on the
 * top-level shipment. This is what lets an arbitrarily deep tree (GoodsItem →
 * Packages → ...) resolve with the same function at every level, never a
 * per-depth special case.
 */
function resolveField(
  field: ActionDataFieldEntry,
  localContext: unknown,
  localPrompted: Record<string, unknown>
): unknown {
  if (field.type === "grid") {
    const raw =
      field.source === "prompt"
        ? localPrompted[field.key]
        : getByPath(localContext, field.source.replace(/^shipment\./, ""));
    const rows = Array.isArray(raw) ? raw : [];

    if (field.required && rows.length === 0) {
      throw new MissingActionFieldError(field.key, field.label);
    }

    return rows.map((row) => {
      const rowObject = row !== null && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const resolvedRow: Record<string, unknown> = {};
      for (const column of field.columns ?? []) {
        const value = resolveField(column, rowObject, rowObject);
        if (value !== undefined) resolvedRow[column.key] = value;
      }
      return resolvedRow;
    });
  }

  const value =
    field.source === "prompt"
      ? localPrompted[field.key]
      : getByPath(localContext, field.source.replace(/^shipment\./, ""));

  if (field.required && (value === undefined || value === null || value === "")) {
    throw new MissingActionFieldError(field.key, field.label);
  }
  return value;
}

/**
 * The promptable field tree a UI needs to render for a given context --
 * resolution only, no values. Most-specific-match-wins over (country,
 * procedureCode, messageName); action is always an exact filter, since each
 * action type has its own, unrelated data needs. No match -> empty list,
 * a safe default: the action still works with just the base declaration.
 */
export async function resolveActionDataFields(
  context: { country: string; procedureCode: string; messageName: string },
  action: string
): Promise<ActionDataFieldEntry[]> {
  const candidates = await db.filingActionDataRequirement.findMany({ where: { action } });
  const match = findMostSpecificMatch(candidates, ["country", "procedureCode", "messageName"], {
    country: context.country,
    procedureCode: context.procedureCode,
    messageName: context.messageName,
  });
  return (match?.fields as unknown as ActionDataFieldEntry[] | undefined) ?? [];
}

/**
 * Builds the extensions object for an outbound action message.
 * `shipmentContext` is whatever the caller already has in hand (filing,
 * shipment, snapshot data); `promptedValues` is whatever the operator
 * supplied when they invoked the action. This is the one place
 * cancelFiling()/amendFiling() touch this table -- neither ever branches on
 * country itself, they only ever ask "what does this context need," and
 * neither has to know or care whether that need is a scalar or a
 * GoodsItem-with-nested-Packages tree.
 */
export async function buildActionExtensions(
  context: { country: string; procedureCode: string; messageName: string },
  action: string,
  shipmentContext: Record<string, unknown>,
  promptedValues: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const fields = await resolveActionDataFields(context, action);
  const extensions: Record<string, unknown> = {};

  for (const field of fields) {
    const value = resolveField(field, shipmentContext, promptedValues);
    if (value !== undefined) extensions[field.key] = value;
  }

  return extensions;
}
