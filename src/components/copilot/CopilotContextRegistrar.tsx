"use client";

import type { CopilotEntityType, CopilotPageContextType } from "@/modules/copilot/copilotContract";
import { useRegisterCopilotContext } from "./CopilotProvider";

/**
 * Tells the Copilot what record the page is about.
 *
 * Rendered by server-rendered detail pages, which is why it exists as a
 * component rather than a hook call: it lets a page opt in with one line and no
 * client boundary of its own.
 *
 * It sends three things and no more — a page type, an entity type and an id, plus
 * a label used only for the panel's own chip. It does not send page state, form
 * values, or anything resembling the DOM. The server treats the id as a hint
 * about what "this product" means and re-resolves it against the account before
 * using it; being on a page has never been a permission.
 */
export function CopilotContextRegistrar({
  page,
  entityType,
  entityId,
  label,
}: {
  page: CopilotPageContextType;
  entityType: CopilotEntityType;
  entityId: string;
  label: string;
}) {
  useRegisterCopilotContext({ page, entityType, entityId, label });
  return null;
}
