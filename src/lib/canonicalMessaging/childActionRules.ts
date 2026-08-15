/**
 * @deprecated This module is replaced by filingActionConfiguration.ts
 * Kept for backwards compatibility during migration.
 */
import { resolveChildActions as newResolveChildActions } from "./filingActionConfiguration";
import type { FilingActionContext } from "./filingActionConfiguration";

export type { FilingActionContext };

/**
 * @deprecated Use resolveFilingActionRules() from filingActionConfiguration.ts instead
 */
export async function resolveChildActions(context: FilingActionContext): Promise<string[]> {
  return newResolveChildActions(context);
}
