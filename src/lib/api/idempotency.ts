import { createHash } from "crypto";
import { db } from "@/lib/db";
import { buildErrorResponse } from "./error";
import { NextResponse } from "next/server";

export async function checkIdempotency(
  req: Request,
  accountId: string,
  requestId: string
): Promise<{ idempotencyKey: string | null; cachedResponse: NextResponse | null; errorResponse: NextResponse | null }> {
  const idempotencyKey = req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return { idempotencyKey: null, cachedResponse: null, errorResponse: null };
  }

  // Clone request body to hash
  let requestHash = "";
  try {
    const clone = req.clone();
    const text = await clone.text();
    requestHash = createHash("sha256").update(text).digest("hex");
  } catch {
    requestHash = "empty";
  }

  const existing = await db.idempotencyRecord.findUnique({
    where: {
      accountId_idempotencyKey: {
        accountId,
        idempotencyKey,
      },
    },
  });

  if (existing) {
    if (existing.expiresAt < new Date()) {
      // Key expired, delete old record
      await db.idempotencyRecord.delete({ where: { id: existing.id } });
      return { idempotencyKey, cachedResponse: null, errorResponse: null };
    }

    if (existing.requestHash !== requestHash) {
      return {
        idempotencyKey,
        cachedResponse: null,
        errorResponse: buildErrorResponse(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used previously with a different request payload",
          undefined,
          requestId
        ),
      };
    }

    // Return cached response
    return {
      idempotencyKey,
      cachedResponse: NextResponse.json(existing.responseBody, { status: existing.statusCode }),
      errorResponse: null,
    };
  }

  return { idempotencyKey, cachedResponse: null, errorResponse: null };
}

export async function persistIdempotency(
  accountId: string,
  idempotencyKey: string,
  requestHash: string,
  statusCode: number,
  responseBody: any
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24hr TTL
    await db.idempotencyRecord.create({
      data: {
        accountId,
        idempotencyKey,
        requestHash,
        statusCode,
        responseBody,
        expiresAt,
      },
    });
  } catch (err) {
    console.error("Failed to persist idempotency record:", err);
  }
}
