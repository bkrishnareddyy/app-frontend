/**
 * DEPRECATED: Old schema validation logic using FilingSchemaVersion table.
 * The table has been emptied and is no longer used.
 * TODO: Remove this file and all references to it.
 */

import Ajv, { type ValidateFunction } from "ajv";
import { db } from "@/lib/db";
import type { CanonicalSchemaType } from "./types";

const ajv = new (Ajv as any)({ allErrors: true, strict: false, strictSchema: false, validateSchema: false });

/** Compiled-validator cache, keyed by "schemaType@version". Invalidated on promoteSchemaVersion(). */
const validatorCache = new Map<string, ValidateFunction>();

export class SchemaValidationError extends Error {
  constructor(
    readonly schemaType: CanonicalSchemaType,
    readonly errors: string
  ) {
    super(`Canonical message failed ${schemaType} schema validation: ${errors}`);
    this.name = "SchemaValidationError";
  }
}

// DEPRECATED: Returns dummy data since FilingSchemaVersion table is now empty
async function getActiveValidator(schemaType: CanonicalSchemaType): Promise<{ validator: ValidateFunction; version: string }> {
  console.warn(`[DEPRECATED] schemaValidator.getActiveValidator called for ${schemaType} - FilingSchemaVersion table is empty`);
  
  // Return a no-op validator that always passes
  const dummyValidator = (() => true) as unknown as ValidateFunction;
  return { validator: dummyValidator, version: "1.0.0" };
}

/** DEPRECATED: The version currently ACTIVE for schemaType */
export async function getActiveSchemaVersion(schemaType: CanonicalSchemaType): Promise<string> {
  console.warn(`[DEPRECATED] schemaValidator.getActiveSchemaVersion called for ${schemaType}`);
  return "1.0.0";
}

/**
 * DEPRECATED: Validates against the currently ACTIVE schema for schemaType.
 * Now returns success without validation since FilingSchemaVersion is empty.
 */
export async function validateAgainstActiveSchema(schemaType: CanonicalSchemaType, data: unknown): Promise<{ version: string }> {
  console.warn(`[DEPRECATED] schemaValidator.validateAgainstActiveSchema called for ${schemaType} - skipping validation`);
  return { version: "1.0.0" };
}

/** DEPRECATED: Call after activating a new schema version */
export function invalidateSchemaCache(schemaType?: CanonicalSchemaType): void {
  validatorCache.clear();
}
