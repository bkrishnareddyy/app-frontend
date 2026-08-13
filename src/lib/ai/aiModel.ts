/**
 * Which model each AI surface calls.
 *
 * Before this module, seven call sites each read `process.env.GEMINI_MODEL ||
 * "gemini-3.6-flash"`: one global variable and one literal, repeated. That made
 * the model a single platform-wide choice — pointing HTS classification at a
 * stronger model dragged document intake along with it — and moving the built-in
 * default meant editing seven files, one of which had no environment read at all
 * and simply hard-coded the name.
 *
 * Selection is per surface, keyed off the same `AiSurface` strings the quota and
 * metering layers already use. A call site now names its surface once and gets
 * both its model and its meter under that name, so the two cannot drift apart.
 *
 * Precedence, most specific first:
 *
 *   1. `<SURFACE>_MODEL`  — one surface only, e.g. `HTS_CLASSIFICATION_MODEL`.
 *   2. `AI_DEFAULT_MODEL` — every surface that has no override of its own.
 *   3. `GEMINI_MODEL`     — deprecated, still honoured. Environments configured
 *      before per-surface selection existed set this, and dropping the read
 *      would move them onto the built-in default without anyone changing a
 *      setting. Prefer `AI_DEFAULT_MODEL`; this rung can go once no environment
 *      sets it.
 *   4. The built-in default below, so an environment with nothing configured
 *      still runs.
 *
 * A blank value counts as unset at every rung, which is what `||` did before:
 * `COPILOT_MODEL=` falls through rather than asking the provider for a model
 * named empty string.
 *
 * This chooses a model *name*, not a provider. The only adapter wired today is
 * google-genai, so a name from another vendor would be handed to the Gemini
 * client and rejected by it. Provider selection lives in
 * `@/modules/copilot/copilotModel`, and the agents construct their clients
 * directly.
 */

import type { AiSurface } from "./aiQuota";

/** Used when no environment variable selects a model. */
export const DEFAULT_AI_MODEL = "gemini-3.6-flash";

/**
 * Explicit rather than derived from the surface string by upper-casing it. The
 * mapping stays greppable from either direction, and because the type is a total
 * `Record<AiSurface, string>`, adding a surface to `AI_SURFACES` fails to
 * compile until its variable is named here — the omission surfaces at build
 * time rather than as a surface that silently ignores its own setting.
 */
const SURFACE_ENV_KEYS: Record<AiSurface, string> = {
  copilot: "COPILOT_MODEL",
  "hts-classification": "HTS_CLASSIFICATION_MODEL",
  "document-intelligence": "DOCUMENT_INTELLIGENCE_MODEL",
  "product-intelligence": "PRODUCT_INTELLIGENCE_MODEL",
  normalization: "NORMALIZATION_MODEL",
  "compliance-audit": "COMPLIANCE_AUDIT_MODEL",
  "document-intake": "DOCUMENT_INTAKE_MODEL",
  advisory: "ADVISORY_MODEL",
};

function configured(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

/** The model one surface should call. Never empty. */
export function aiModel(surface: AiSurface, env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env[SURFACE_ENV_KEYS[surface]]) ??
    configured(env.AI_DEFAULT_MODEL) ??
    configured(env.GEMINI_MODEL) ??
    DEFAULT_AI_MODEL
  );
}

/** The variable that overrides one surface. For documentation and diagnostics. */
export function aiModelEnvKey(surface: AiSurface): string {
  return SURFACE_ENV_KEYS[surface];
}
