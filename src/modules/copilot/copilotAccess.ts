/**
 * Whether this user may use this tool.
 *
 * The rule is not a new permission model. It is the existing one, read through
 * the same functions the UI reads it through:
 *
 *   - `canAccessHref` decides nav-gated tools, exactly as it decides whether the
 *     sidebar shows the link and whether the page renders.
 *   - `holdsPermission` mirrors `hasPermission()` in src/lib/auth.ts, including
 *     the platform-admin and OWNER bypasses that apply everywhere else.
 *
 * The consequence is the one the specification asks for: a user who cannot open
 * a screen in Qubere cannot reach its data by asking the Copilot instead, and a
 * permission added to the catalogue later takes effect here without a change.
 */

import type { AccountContext } from "@/lib/auth";
import { canAccessHref } from "@/lib/navigation";
import { holdsPermission } from "@/modules/product/productActor";
import type { AnyCopilotTool, CopilotToolAccess } from "./copilotToolTypes";

export function canUseTool(context: AccountContext, access?: CopilotToolAccess): boolean {
  if (!access) return true;

  if (access.navHref) {
    const allowed = canAccessHref(
      {
        roleNames: context.roleNames,
        permissions: context.permissions,
        isPlatformAdmin: context.isPlatformAdmin,
      },
      access.navHref
    );
    if (!allowed) return false;
  }

  if (access.permission && !holdsPermission(context, access.permission)) {
    return false;
  }

  return true;
}

/** The subset of the registry this user may see. Tools they cannot use are never described to the model. */
export function availableTools(
  context: AccountContext,
  tools: readonly AnyCopilotTool[]
): AnyCopilotTool[] {
  return tools.filter((tool) => canUseTool(context, tool.access));
}
