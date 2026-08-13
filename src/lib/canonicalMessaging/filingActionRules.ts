import { db } from "@/lib/db";
import { findMostSpecificMatch } from "./wildcardLookup";

export interface FilingActionContext {
  country: string;
  procedure: string;
  messageName: string;
  status: string;
}

/**
 * Whether a filing's declaration is editable (and Save/Save & Resubmit
 * should be shown) for this (country, procedure, messageName, status).
 * Fails closed: no matching FilingActionRule row means false, never true.
 */
export async function resolveAllowUpdates(context: FilingActionContext): Promise<boolean> {
  const candidates = await db.filingActionRule.findMany({
    where: {
      country: { in: [context.country, "*"] },
      procedureCode: { in: [context.procedure, "*"] },
      messageName: { in: [context.messageName, "*"] },
      status: { in: [context.status, "*"] },
    },
  });

  const match = findMostSpecificMatch(candidates, ["country", "procedureCode", "messageName", "status"], {
    country: context.country,
    procedureCode: context.procedure,
    messageName: context.messageName,
    status: context.status,
  });

  return match?.allowUpdates ?? false;
}
