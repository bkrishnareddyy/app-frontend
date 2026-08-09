import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { ACTIVE_ACCOUNT_COOKIE } from "@/lib/auth";

// Uses direct Clerk auth() rather than getAccountContext(): switching accounts
// only requires proof of a Clerk session plus membership in the target
// account, not a fully resolved AccountContext for the (about to change)
// currently-active account.
//
// Deliberately exempt from the read-only role gate: switching the active
// account writes only the caller's own session cookie, and blocking it would
// strand a VIEWER who belongs to more than one account.
export const POST = withPublicRoute(async ({ req }) => {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { targetAccountId } = await req.json();

  if (!targetAccountId) {
    return NextResponse.json({ error: "Target account ID required" }, { status: 400 });
  }

  // Verify user belongs to target account
  const user = await db.user.findUnique({
    where: { clerkUserId },
    include: {
      memberships: {
        where: { accountId: targetAccountId, status: "ACTIVE" },
      },
    },
  });

  if (!user || user.memberships.length === 0) {
    return NextResponse.json({ error: "No active membership in specified account" }, { status: 403 });
  }

  // Set cookie for active account
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ACCOUNT_COOKIE, targetAccountId, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  return NextResponse.json({ success: true, activeAccountId: targetAccountId });
});
