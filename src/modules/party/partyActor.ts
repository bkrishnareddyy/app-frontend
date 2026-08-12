/**
 * Turns an authenticated session into a `PartyActor`.
 *
 * This is the only place a party actor is constructed. It reads the account
 * and the user from the session and nowhere else — there is deliberately no
 * overload taking an accountId, so a route cannot accidentally build an actor
 * out of request input. This is the concrete mechanism behind "never trust
 * tenant IDs supplied by clients for authorization": nothing downstream of
 * this function ever sees an accountId that did not come from the session.
 */

import type { AccountContext } from "@/lib/auth";
import type { PartyActor } from "./partyService";

/**
 * Mirrors `hasPermission()` in src/lib/auth.ts, synchronously, against a
 * context that has already been loaded. Platform admins and OWNER bypass, as
 * they do everywhere else in this codebase.
 */
export function holdsPermission(ctx: AccountContext, permission: string): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (ctx.roleNames.includes("OWNER")) return true;
  return ctx.permissions.includes(permission);
}

export function partyActor(ctx: AccountContext, requestId: string): PartyActor {
  return {
    accountId: ctx.accountId,
    userId: ctx.userId,
    // Carried on the actor rather than checked only at the route, so the
    // approval and verification rules hold for every caller, including ones
    // that are not HTTP requests.
    canApproveParty: holdsPermission(ctx, "parties.review.approve"),
    canVerifyRegistration: holdsPermission(ctx, "parties.registration.verify"),
    canResolveRevalidation: holdsPermission(ctx, "parties.revalidation.resolve"),
    requestId,
  };
}
