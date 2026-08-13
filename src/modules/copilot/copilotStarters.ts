/**
 * Opening suggestions, by page.
 *
 * These do double duty. They save typing, and they set expectations: every one
 * of them is a question the Copilot can actually answer from retrieved records.
 * None asks it to classify, to determine origin, or to decide anything — because
 * it cannot, and an empty panel inviting "ask me anything" would imply it can.
 *
 * Plain data, deliberately: no model call, no network, and safe to render on the
 * server or the client.
 */

import type { CopilotPageContextType } from "./copilotContract";

const GLOBAL_STARTERS = [
  "What needs my attention today?",
  "Which shipments have open compliance exceptions?",
  "Which products are still unclassified?",
] as const;

const STARTERS: Record<CopilotPageContextType, readonly string[]> = {
  PRODUCT_DETAIL: [
    "Summarise what Qubere knows about this product.",
    "Does this product have an approved country of origin?",
    "What evidence supports this product's classification?",
  ],
  PARTY_DETAIL: [
    "Summarise this party's registrations and review status.",
    "What has changed on this party recently?",
    "Which registrations on this party need attention?",
  ],
  SHIPMENT_DETAIL: [
    "Is this shipment ready to file?",
    "Which documents are still missing on this shipment?",
    "Explain the open exceptions on this shipment.",
  ],
  DOCUMENT_DETAIL: [
    "What did Document Intelligence extract from this document?",
    "Which extracted fields have low confidence?",
    "Why is this document in review?",
  ],
  GLOBAL: GLOBAL_STARTERS,
};

export function copilotStarters(page: CopilotPageContextType): readonly string[] {
  return STARTERS[page] ?? GLOBAL_STARTERS;
}
