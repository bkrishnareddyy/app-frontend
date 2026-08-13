import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  return NextResponse.json({
    accountName: ctx.accountName,
    userRole: ctx.roleNames.join(", "),
    account: {
      id: ctx.account.id,
      name: ctx.account.name,
      type: ctx.account.type,
      status: ctx.account.status,
      createdAt: ctx.account.createdAt.toISOString(),
    },
    requestId,
  });
});

export const PATCH = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { name, status } = body;

  if (name && (typeof name !== "string" || name.trim().length === 0)) {
    return NextResponse.json({ error: "Invalid account name" });
  }

  const updatedAccount = await db.account.update({
    where: { id: ctx.accountId },
    data: {
      name: name ? name.trim() : undefined,
      status: status ? status : undefined,
    },
});

  // Create AuditLog entry for admin changes
  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "ACCOUNT_UPDATED",
    entity: "Account",
    entityId: ctx.accountId,
    source: "UI",
    metadata: {
      previousName: ctx.account.name,
      newName: updatedAccount.name,
      previousStatus: ctx.account.status,
      newStatus: updatedAccount.status,
    },
  });

  return NextResponse.json({ success: true, account: updatedAccount });

}, { permission: "account.manage", write: true });
