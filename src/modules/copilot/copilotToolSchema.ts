/**
 * Declaration helpers for tool parameters.
 *
 * Every tool declares its arguments twice: once as a `Schema` the model reads,
 * and once as a zod schema the server validates against. The duplication is
 * deliberate — the first is a hint to a model, the second is the actual gate.
 * A model that invents an argument outside the zod schema has that argument
 * rejected, not forwarded.
 *
 * The helpers exist so the two stay legible side by side rather than drifting
 * into two unrelated blobs.
 */

import { Type, type Schema } from "@google/genai";

export function stringParam(description: string, options?: { values?: readonly string[] }): Schema {
  const schema: Schema = { type: Type.STRING, description };
  if (options?.values) schema.enum = [...options.values];
  return schema;
}

export function integerParam(description: string, range?: { min?: number; max?: number }): Schema {
  const schema: Schema = { type: Type.INTEGER, description };
  if (range?.min !== undefined) schema.minimum = range.min;
  if (range?.max !== undefined) schema.maximum = range.max;
  return schema;
}

export function booleanParam(description: string): Schema {
  return { type: Type.BOOLEAN, description };
}

export function params(properties: Record<string, Schema>, required: string[] = []): Schema {
  return { type: Type.OBJECT, properties, required };
}

/** For tools that take nothing. Declared as an empty object rather than omitted. */
export const NO_PARAMS: Schema = { type: Type.OBJECT, properties: {} };
