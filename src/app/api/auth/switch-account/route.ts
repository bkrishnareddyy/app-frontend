import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ACTIVE_ACCOUNT_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  try {
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
  } catch (error) {
    console.error("Error switching active account:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
