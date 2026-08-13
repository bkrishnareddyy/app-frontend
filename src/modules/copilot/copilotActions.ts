/**
 * Where a Copilot action goes.
 *
 * The route for an action is built here, from the action type and a validated
 * id, and nowhere else. The model proposes `OPEN_PRODUCT` against an id; the
 * server decides that this means `/app/products/<id>`. There is deliberately no
 * path by which a string produced by a model becomes an href — the model's
 * schema has no href field, and this module never reads one.
 *
 * Ids are re-encoded on the way in, so an id that somehow carried a slash or a
 * query separator cannot escape its route segment.
 */

import type { CopilotActionType, CopilotEntityType } from "./copilotContract";

/** The entity type an action must be cited against for the route to make sense. */
const ACTION_SUBJECT: Record<CopilotActionType, CopilotEntityType | "EVIDENCE"> = {
  OPEN_PRODUCT: "PRODUCT",
  OPEN_PARTY: "PARTY",
  OPEN_SHIPMENT: "SHIPMENT",
  OPEN_DOCUMENT: "DOCUMENT",
  OPEN_EXCEPTION: "EXCEPTION",
  OPEN_TASK: "TASK",
  OPEN_DECISION: "DECISION",
  VIEW_EVIDENCE: "EVIDENCE",
};

export function actionSubject(type: CopilotActionType): CopilotEntityType | "EVIDENCE" {
  return ACTION_SUBJECT[type];
}

/**
 * Ids in this codebase are cuids, so the encoding below is belt-and-braces
 * rather than a fix for a known-bad id. It stays because the cost is nil and
 * the failure it prevents — a crafted id steering navigation — is not.
 */
function segment(id: string): string {
  return encodeURIComponent(id);
}

/**
 * The route for an action, or null when the action type has no route (which
 * cannot happen for a validated type, but is handled rather than asserted).
 *
 * Evidence has no page of its own in Qubere today. A VIEW_EVIDENCE action
 * therefore opens the product or party whose record carries the evidence, which
 * is where the provenance is actually shown; the caller supplies that owner.
 */
export function actionHref(
  type: CopilotActionType,
  entityId: string,
  evidenceOwner?: { type: "PRODUCT" | "PARTY"; id: string } | null
): string | null {
  switch (type) {
    case "OPEN_PRODUCT":
      return `/app/products/${segment(entityId)}`;
    case "OPEN_PARTY":
      return `/app/parties/${segment(entityId)}`;
    case "OPEN_SHIPMENT":
      return `/app/shipments/${segment(entityId)}`;
    case "OPEN_DOCUMENT":
      return `/app/documents?documentId=${segment(entityId)}`;
    case "OPEN_EXCEPTION":
      return `/app/exceptions?exceptionId=${segment(entityId)}`;
    case "OPEN_TASK":
      return `/app/actions?workItemId=${segment(entityId)}`;
    case "OPEN_DECISION":
      return `/app/decisions?decisionId=${segment(entityId)}`;
    case "VIEW_EVIDENCE": {
      if (!evidenceOwner) return null;
      const base = evidenceOwner.type === "PRODUCT" ? "products" : "parties";
      return `/app/${base}/${segment(evidenceOwner.id)}#evidence-${segment(entityId)}`;
    }
    default:
      return null;
  }
}

/** The action that opens a given entity type, for actions the server offers itself. */
export function openActionFor(type: CopilotEntityType): CopilotActionType {
  switch (type) {
    case "PRODUCT":
      return "OPEN_PRODUCT";
    case "PARTY":
      return "OPEN_PARTY";
    case "SHIPMENT":
      return "OPEN_SHIPMENT";
    case "DOCUMENT":
      return "OPEN_DOCUMENT";
    case "EXCEPTION":
      return "OPEN_EXCEPTION";
    case "TASK":
      return "OPEN_TASK";
    case "DECISION":
      return "OPEN_DECISION";
  }
}
