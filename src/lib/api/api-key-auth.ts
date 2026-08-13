/**
 * API key authentication for inbound ERP endpoints.
 *
 * Callers supply the raw key via Authorization: Bearer <key> or X-Api-Key: <key>.
 * We look up by prefix (first 8 chars) then verify the hash.
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";

export interface ApiKeyContext {
  accountId: string;
  keyId: string;
  scopes: string[];
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function authenticateApiKey(req: Request): Promise<ApiKeyContext | null> {
  const authHeader = req.headers.get("authorization");
  const xApiKey = req.headers.get("x-api-key");

  let raw: string | null = null;
  if (authHeader?.startsWith("Bearer ")) {
    raw = authHeader.slice(7).trim();
  } else if (xApiKey) {
    raw = xApiKey.trim();
  }

  if (!raw || raw.length < 8) return null;

  const prefix = raw.slice(0, 8);
  const hash = hashKey(raw);

  const apiKey = await db.accountApiKey.findFirst({
    where: { keyPrefix: prefix, keyHash: hash, status: "ACTIVE" },
  });

  if (!apiKey) return null;

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

  await db.accountApiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return { accountId: apiKey.accountId, keyId: apiKey.id, scopes: apiKey.scopes };
}

export function apiKeyHasScope(ctx: ApiKeyContext, scope: string): boolean {
  return ctx.scopes.includes(scope) || ctx.scopes.includes("*");
}
