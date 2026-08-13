import { db } from "@/lib/db";
import { findMostSpecificMatch } from "./wildcardLookup";
import type { FilingActionContext } from "./filingActionRules";

/**
 * Which child actions (CANCEL, AMEND, INVALIDATE, ...) are offered for this
 * (country, procedure, messageName, status) -- a dynamic list read from
 * FilingChildActionRule, not a fixed set of booleans. Adding a new child
 * action later is a seed-data row; this function and its callers never
 * change. Most-specific-match-wins is applied per action independently, so
 * one action can be enabled by a country-specific row while another falls
 * back to a wildcard row in the same lookup.
 */
export async function resolveChildActions(context: FilingActionContext): Promise<string[]> {
  const candidates = await db.filingChildActionRule.findMany({
    where: {
      country: { in: [context.country, "*"] },
      procedureCode: { in: [context.procedure, "*"] },
      messageName: { in: [context.messageName, "*"] },
      status: { in: [context.status, "*"] },
    },
  });

  const byAction = new Map<string, typeof candidates>();
  for (const row of candidates) {
    const group = byAction.get(row.action);
    if (group) group.push(row);
    else byAction.set(row.action, [row]);
  }

  const actions: string[] = [];
  for (const [action, rows] of byAction) {
    const match = findMostSpecificMatch(rows, ["country", "procedureCode", "messageName", "status"], {
      country: context.country,
      procedureCode: context.procedure,
      messageName: context.messageName,
      status: context.status,
    });
    if (match) actions.push(action);
  }

  return actions;
}
