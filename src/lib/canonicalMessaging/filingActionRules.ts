/**
 * @deprecated This module is replaced by filingActionConfiguration.ts
 * Kept for backwards compatibility during migration.
 */
import { resolveAllowUpdates as newResolveAllowUpdates } from "./filingActionConfiguration";
import type { FilingActionContext } from "./filingActionConfiguration";

export type { FilingActionContext };

/**
 * @deprecated Use resolveFilingActionRules() from filingActionConfiguration.ts instead
 */
export async function resolveAllowUpdates(context: FilingActionContext): Promise<boolean> {
  return newResolveAllowUpdates(context);
}
