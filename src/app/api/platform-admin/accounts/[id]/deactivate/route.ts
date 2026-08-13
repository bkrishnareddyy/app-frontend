import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json({ error: "Forbidden: Platform Admin privileges required" },
      { status: 403 }
    );
  }

  const { id } = params;

  const account = await db.account.findUnique({ where: { id } });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  if (account.status === "INACTIVE" || account.deletedAt !== null) {
    return NextResponse.json(
      { error: "Account is already inactive", requestId },
      { status: 409 }
    );
  }

  const updated = await db.account.update({
    where: { id },
    data: { status: "INACTIVE", deletedAt: new Date() },
});

  await createAuditLog({
    accountId: id,
    userId: ctx.userId,
    action: "ACCOUNT_DEACTIVATED",
    entity: "Account",
    entityId: id,
    source: "UI",
    metadata: { deactivatedBy: ctx.email, previousStatus: account.status },
    success: true,
  });

  return NextResponse.json({
    success: true,
    account: { id: updated.id, status: updated.status, deletedAt: updated.deletedAt },
    requestId,
  });

}, { permission: "account.manage", write: true });
