/**
 * Turning "what the user is looking at" into something safe to tell the model.
 *
 * The browser sends a page context: a type, an id, and a display label. All
 * three are untrusted. The label is discarded outright — it is only ever used by
 * the panel to render its own chip, and letting it through would mean a record
 * could be described to the model by whatever the client felt like calling it.
 *
 * The id is treated as a *hint about referents*, which is the distinction this
 * whole file exists to enforce. Being on a page does not grant access to the
 * record behind it. So the id is resolved here, through a tenant-scoped read
 * that also checks the user may see that area at all, and:
 *
 *   - resolvable  → the model is told, in one sentence, what is in view, using
 *                   the label the database gave;
 *   - not in this account, or not permitted → the context is dropped silently.
 *     The model is told nothing, and the turn proceeds as if global. Reporting
 *     "you are not allowed to see the record you are looking at" would be a
 *     confusing answer to a question about something else, and confirming that
 *     an id exists somewhere would be an enumeration oracle.
 *
 * Nothing here is recorded in the grounding ledger. Context resolution proves a
 * record exists; it is not the model having retrieved facts about it, and an
 * answer that cites the record must still have called a tool for it.
 */

import { db } from "@/lib/db";
import { canAccessHref } from "@/lib/navigation";
import type { AccountContext } from "@/lib/auth";
import { partyDisplayName } from "@/modules/party/partyDisplay";
import type { CopilotEntityType, CopilotPageContext } from "./copilotContract";

export interface ResolvedCopilotContext {
  /** The sentence handed to the prompt builder, or null for a global turn. */
  sentence: string | null;
  /** What was actually resolved, for audit. Never a client-supplied label. */
  entityType: CopilotEntityType | null;
  entityId: string | null;
  label: string | null;
}

const GLOBAL: ResolvedCopilotContext = {
  sentence: null,
  entityType: null,
  entityId: null,
  label: null,
};

/** The nav href guarding each context type, so the check matches the screens. */
const CONTEXT_NAV: Record<CopilotEntityType, string | null> = {
  PRODUCT: "/app/products",
  PARTY: "/app/parties",
  SHIPMENT: "/app/shipments",
  DOCUMENT: "/app/documents",
  // Not reachable as page contexts in this release; listed so the map stays
  // exhaustive and a new context type has to be considered here.
  EXCEPTION: null,
  TASK: null,
  DECISION: null,
};

const SUPPORTED: readonly CopilotEntityType[] = ["PRODUCT", "PARTY", "SHIPMENT", "DOCUMENT"];

function permitted(context: AccountContext, entityType: CopilotEntityType): boolean {
  const href = CONTEXT_NAV[entityType];
  if (!href) return false;
  return canAccessHref(
    {
      roleNames: context.roleNames,
      permissions: context.permissions,
      isPlatformAdmin: context.isPlatformAdmin,
    },
    href
  );
}

/**
 * One narrow read per type. These are deliberately not the full detail services:
 * resolving context needs a name, not a record, and the model gets facts only
 * from tools the user's question actually caused to run.
 */
async function resolveLabel(
  accountId: string,
  entityType: CopilotEntityType,
  entityId: string
): Promise<string | null> {
  switch (entityType) {
    case "PRODUCT": {
      const row = await db.product.findFirst({
        where: { id: entityId, accountId, deletedAt: null },
        select: { productName: true, internalSku: true },
      });
      return row ? row.productName || row.internalSku : null;
    }
    case "PARTY": {
      const row = await db.party.findFirst({
        where: { id: entityId, accountId, deletedAt: null },
        select: {
          internalPartyCode: true,
          names: { select: { nameType: true, rawName: true, isPrimary: true } },
        },
      });
      return row ? partyDisplayName(row) : null;
    }
    case "SHIPMENT": {
      const row = await db.shipment.findFirst({
        where: { id: entityId, accountId, deletedAt: null },
        select: { shipmentNumber: true },
      });
      return row?.shipmentNumber ?? null;
    }
    case "DOCUMENT": {
      const row = await db.shipmentDocument.findFirst({
        where: { id: entityId, accountId },
        select: { fileName: true, docType: true },
      });
      return row ? row.fileName || row.docType : null;
    }
    default:
      return null;
  }
}

function sentenceFor(entityType: CopilotEntityType, label: string, entityId: string): string {
  switch (entityType) {
    case "PRODUCT":
      return `The user is viewing the Global Product Master record for "${label}" (productId ${entityId}).`;
    case "PARTY":
      return `The user is viewing the Global Party Master record for "${label}" (partyId ${entityId}).`;
    case "SHIPMENT":
      return `The user is viewing shipment ${label} (shipmentId ${entityId}).`;
    case "DOCUMENT":
      return `The user is viewing the document "${label}" (documentId ${entityId}).`;
    default:
      return `The user is viewing ${label}.`;
  }
}

export async function resolveCopilotContext(
  accountId: string,
  context: AccountContext,
  pageContext: CopilotPageContext
): Promise<ResolvedCopilotContext> {
  const { entityType, entityId } = pageContext;

  if (pageContext.page === "GLOBAL" || !entityType || !entityId) return GLOBAL;
  if (!SUPPORTED.includes(entityType)) return GLOBAL;
  if (!permitted(context, entityType)) return GLOBAL;

  let label: string | null;
  try {
    label = await resolveLabel(accountId, entityType, entityId);
  } catch {
    // A failed context read must not fail the question. Answer globally.
    return GLOBAL;
  }

  if (!label) return GLOBAL;

  return {
    sentence: sentenceFor(entityType, label, entityId),
    entityType,
    entityId,
    label,
  };
}
