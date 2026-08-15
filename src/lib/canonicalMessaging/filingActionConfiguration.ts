import { db } from "@/lib/db";

export interface FilingActionContext {
  country: string;
  procedure: string;
  messageName: string;
  status: string;
}

export interface FilingActionRules {
  /** Actions that are currently available (AMENDMENT, CANCELLATION, etc.) */
  availableActions: string[];
  /** Whether the original declaration can be resubmitted (typically after REJECTED) */
  allowSubmit: boolean;
}

/**
 * Resolves which actions are available and whether resubmit is allowed
 * based on the request message sent and the response status received.
 * 
 * Replaces the old FilingActionRule (allowUpdates) and FilingChildActionRule
 * (per-action rows) with a single FilingActionConfiguration lookup.
 * 
 * Example: After sending IE015 and receiving ACCEPTED status, returns:
 *   { availableActions: ["AMENDMENT", "CANCELLATION"], allowSubmit: false }
 * 
 * Fails closed: no matching row means no actions available.
 */
export async function resolveFilingActionRules(
  context: FilingActionContext
): Promise<FilingActionRules> {
  const config = await db.filingActionConfiguration.findUnique({
    where: {
      country_procedureCode_messageName_status: {
        country: context.country,
        procedureCode: context.procedure,
        messageName: context.messageName,
        status: context.status,
      },
      isActive: true,
    },
  });

  if (!config) {
    // Fail closed: no configuration means no actions available
    return {
      availableActions: [],
      allowSubmit: false,
    };
  }

  return {
    availableActions: config.availableActions,
    allowSubmit: config.allowSubmit,
  };
}

/**
 * Legacy function name for backwards compatibility.
 * Use resolveFilingActionRules() for new code.
 * 
 * @deprecated Use resolveFilingActionRules() instead
 */
export async function resolveChildActions(context: FilingActionContext): Promise<string[]> {
  const rules = await resolveFilingActionRules(context);
  return rules.availableActions;
}

/**
 * Legacy function name for backwards compatibility.
 * Use resolveFilingActionRules() for new code.
 * 
 * @deprecated Use resolveFilingActionRules() instead
 */
export async function resolveAllowUpdates(context: FilingActionContext): Promise<boolean> {
  const rules = await resolveFilingActionRules(context);
  return rules.allowSubmit;
}
