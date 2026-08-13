import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, params, requestId }) => {
  const { id } = params;

  const apiKey = await db.accountApiKey.findFirst({
    where: { id, accountId: ctx.accountId },
});

  if (!apiKey) {
    return NextResponse.json({ error: "API key not found", requestId });
  }

  if (apiKey.status === "REVOKED") {
    return NextResponse.json({ error: "API key already revoked", requestId }, { status: 409 });
  }

  await db.accountApiKey.update({
    where: { id },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "API_KEY_REVOKED",
    entity: "AccountApiKey",
    entityId: id,
    source: "UI",
    metadata: { label: apiKey.label, prefix: apiKey.keyPrefix },
    success: true,
  });

  return NextResponse.json({ success: true, requestId });

}, { permission: "settings.manage", write: true });
