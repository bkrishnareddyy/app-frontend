import { NextResponse } from "next/server";
import type { AccountContext } from "@/lib/auth";

export const READ_ONLY_MESSAGE = "Your role is read-only and cannot modify records.";

/**
 * VIEWER is read-only. The permission catalogue is only partially seeded, so a
 * per-action permission check would lock out ADMIN and MEMBER; the role name is
 * the only signal available for every account today. A member holding several
 * roles may write as soon as one of them is not VIEWER; holding no role at all
 * fails closed.
 *
 * Deliberately lives here rather than in `@/lib/auth` so that the guard has no
 * runtime dependency on that module — several suites replace it with a partial
 * mock, which would otherwise silently disable the check under test.
 */
export function canWrite(ctx: Pick<AccountContext, "roleNames" | "isPlatformAdmin">): boolean {
  if (ctx.isPlatformAdmin) return true;
  return ctx.roleNames.some((role) => role !== "VIEWER");
}

/**
 * Returns a 403 for a read-only role, or null when the write may proceed.
 * Authentication alone used to be the only gate on every mutating route, so a
 * VIEWER could approve compliance decisions and transmit entries to CBP.
 */
export function denyReadOnly(
  ctx: Pick<AccountContext, "roleNames" | "isPlatformAdmin">
): NextResponse | null {
  return canWrite(ctx) ? null : NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
}
