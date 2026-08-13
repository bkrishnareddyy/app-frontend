import { db } from "@/lib/db";
import { requireEntryTypeCode } from "@/modules/filing/entryType";
import { findMostSpecificMatch } from "./wildcardLookup";
import type { FilingMessageAction } from "./types";

export interface MessageContextInput {
  /** Raw entryType as stored on Shipment/CustomsFiling -- normalized internally. */
  entryType: string | null | undefined;
  destinationCountry: string | null | undefined;
}

export interface ResolvedMessageContext {
  entryTypeCode: string;
  country: string;
  procedure: string;
  messageName: string;
  queueName: string;
}

/**
 * Derives country/procedure/messageName from shipment data and the
 * FilingProcedureMapping/FilingMessageCatalog reference tables. No caller may
 * hardcode any of these three values -- this is the single resolution point.
 */
export async function resolveMessageContext(
  input: MessageContextInput,
  action: FilingMessageAction
): Promise<ResolvedMessageContext> {
  const entryTypeCode = requireEntryTypeCode(input.entryType);

  const country = input.destinationCountry?.trim();
  if (!country) {
    throw new Error(
      "Cannot resolve a message context: shipment.destinationCountry is not set. " +
        "The destination country is never inferred -- set it explicitly on the shipment."
    );
  }

  const procedureCandidates = await db.filingProcedureMapping.findMany({
    where: { entryType: entryTypeCode, country: { in: [country, "*"] } },
  });
  const procedureMatch = findMostSpecificMatch(procedureCandidates, ["country"], { country });
  if (!procedureMatch) {
    throw new Error(
      `No FilingProcedureMapping row for entryType "${entryTypeCode}" and country "${country}" ` +
        `(and no "*" wildcard fallback exists). Add the mapping before filing to this destination.`
    );
  }
  const procedure = procedureMatch.procedureCode;

  const catalogCandidates = await db.filingMessageCatalog.findMany({
    where: {
      action: { in: [action, "*"] },
      country: { in: [country, "*"] },
      procedureCode: { in: [procedure, "*"] },
    },
  });
  const catalogMatch = findMostSpecificMatch(catalogCandidates, ["action", "country", "procedureCode"], {
    action,
    country,
    procedureCode: procedure,
  });
  if (!catalogMatch) {
    throw new Error(
      `No FilingMessageCatalog row for action "${action}", country "${country}", procedure "${procedure}" ` +
        `(and no "*" wildcard fallback exists).`
    );
  }

  return {
    entryTypeCode,
    country,
    procedure,
    messageName: catalogMatch.messageName,
    queueName: catalogMatch.queueName,
  };
}
