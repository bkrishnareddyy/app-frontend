// The schemas/customs-filing/*.json files declare "$schema":
// ".../draft/2020-12/schema" and use $defs/$ref -- the plain `ajv` default
// export only fully understands draft-07. Ajv2020 is the same library's
// entry point for 2020-12 support.
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { db } from "@/lib/db";
import type { CanonicalSchemaType } from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

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

async function getActiveValidator(schemaType: CanonicalSchemaType): Promise<{ validator: ValidateFunction; version: string }> {
  const active = await db.filingSchemaVersion.findFirst({
    where: { schemaType, status: "ACTIVE" },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!active) {
    throw new Error(`No ACTIVE FilingSchemaVersion row for schemaType "${schemaType}". Run scripts/seed-canonical-messaging.ts.`);
  }

  const cacheKey = `${schemaType}@${active.version}`;
  const cached = validatorCache.get(cacheKey);
  if (cached) return { validator: cached, version: active.version };

  const validator = ajv.compile(active.schemaJson as object);
  validatorCache.set(cacheKey, validator);
  return { validator, version: active.version };
}

/** The version currently ACTIVE for schemaType -- for stamping on an outbound header, not for validation. */
export async function getActiveSchemaVersion(schemaType: CanonicalSchemaType): Promise<string> {
  const { version } = await getActiveValidator(schemaType);
  return version;
}

/**
 * Validates against the currently ACTIVE schema for schemaType. Throws
 * SchemaValidationError on failure -- callers quarantine, they never coerce.
 */
export async function validateAgainstActiveSchema(schemaType: CanonicalSchemaType, data: unknown): Promise<{ version: string }> {
  const { validator, version } = await getActiveValidator(schemaType);
  const valid = validator(data);
  if (!valid) {
    const errors = ajv.errorsText(validator.errors, { separator: "; " });
    throw new SchemaValidationError(schemaType, errors);
  }
  return { version };
}

/** Call after activating a new schema version so stale compiled validators aren't reused. */
export function invalidateSchemaCache(schemaType?: CanonicalSchemaType): void {
  if (!schemaType) {
    validatorCache.clear();
    return;
  }
  for (const key of validatorCache.keys()) {
    if (key.startsWith(`${schemaType}@`)) validatorCache.delete(key);
  }
}
