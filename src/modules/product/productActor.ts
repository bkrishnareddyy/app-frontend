/**
 * Turns an authenticated session into a `ProductActor`.
 *
 * This is the only place a product actor is constructed. It reads the account
 * and the user from the session and nowhere else — there is deliberately no
 * overload taking an accountId, so a route cannot accidentally build an actor
 * out of request input.
 */

import type { AccountContext } from "@/lib/auth";
import type { ProductActor } from "./productService";

/**
 * Mirrors `hasPermission()` in src/lib/auth.ts, synchronously, against a context
 * that has already been loaded. Platform admins and OWNER bypass, as they do
 * everywhere else in this codebase.
 */
export function holdsPermission(ctx: AccountContext, permission: string): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (ctx.roleNames.includes("OWNER")) return true;
  return ctx.permissions.includes(permission);
}

export function productActor(ctx: AccountContext, requestId: string): ProductActor {
  return {
    accountId: ctx.accountId,
    userId: ctx.userId,
    // Carried on the actor rather than checked only at the route, so the
    // approval rule holds for every caller of reviewClassification, including
    // ones that are not HTTP requests.
    canApproveClassification: holdsPermission(ctx, "products.classification.approve"),
    requestId,
  };
}
