import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { PERMISSION_NAMES } from "@/lib/permissions";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const keys = await db.accountApiKey.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    apiKeys: keys.map((k) => ({
      id: k.id,
      label: k.label,
      keyPrefix: k.keyPrefix,
      scopes: k.scopes,
      status: k.status,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
    requestId,
  });
});

const createKeySchema = z.object({
  label: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.string().datetime().optional(),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createKeySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { label, scopes, expiresAt } = bodyVal.data;

  const invalidScopes = scopes.filter(
    (s) => s !== "*" && !(PERMISSION_NAMES as readonly string[]).includes(s)
  );
  if (invalidScopes.length > 0) {
    return buildErrorResponse(
      400,
      "INVALID_SCOPES",
      `Unknown scopes: ${invalidScopes.join(", ")}`,
      undefined,
      requestId
    );
  }

  const existing = await db.accountApiKey.count({
    where: { accountId: ctx.accountId, status: "ACTIVE" },
});
  if (existing >= 20) {
    return buildErrorResponse(429, "TOO_MANY_KEYS", "Maximum of 20 active API keys per account.", undefined, requestId);
  }

  const raw = `qbr_${randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, 8);
  const hash = hashKey(raw);

  const apiKey = await db.accountApiKey.create({
    data: {
      accountId: ctx.accountId,
      label,
      keyHash: hash,
      keyPrefix: prefix,
      scopes,
      status: "ACTIVE",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdByUserId: ctx.userId,
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "API_KEY_CREATED",
    entity: "AccountApiKey",
    entityId: apiKey.id,
    source: "UI",
    metadata: { label, scopes, prefix },
    success: true,
  });

  return NextResponse.json({
      success: true,
      apiKey: {
        id: apiKey.id,
        label: apiKey.label,
        keyPrefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        status: apiKey.status,
        // Raw key shown once — caller must store it securely.
        key: raw,
        createdAt: apiKey.createdAt.toISOString(),
      },
      requestId,
    },
    { status: 201 }
  );

}, { permission: "settings.manage", write: true });
