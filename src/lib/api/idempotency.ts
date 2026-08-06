import { createHash } from "crypto";
import { db } from "@/lib/db";
import { buildErrorResponse } from "./error";
import { NextResponse } from "next/server";

export async function checkIdempotency(
  req: Request,
  accountId: string,
  requestId: string
): Promise<{
  idempotencyKey: string | null;
  requestHash: string | null;
  cachedResponse: NextResponse | null;
  errorResponse: NextResponse | null;
}> {
  const idempotencyKey = req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return { idempotencyKey: null, requestHash: null, cachedResponse: null, errorResponse: null };
  }

  // Compute request hash from the body
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
      // Key expired — delete old record and allow re-use
      await db.idempotencyRecord.delete({ where: { id: existing.id } });
      return { idempotencyKey, requestHash, cachedResponse: null, errorResponse: null };
    }

    if (existing.requestHash !== requestHash) {
      return {
        idempotencyKey,
        requestHash,
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

    // Return cached response for completed requests
    return {
      idempotencyKey,
      requestHash,
      cachedResponse: NextResponse.json(existing.responseBody, { status: existing.statusCode }),
      errorResponse: null,
    };
  }

  // Atomically reserve the key with PROCESSING status before business execution.
  // This prevents simultaneous duplicate writes: only the first writer succeeds;
  // concurrent arrivals will hit the unique constraint and should retry.
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24hr TTL
    await db.idempotencyRecord.create({
      data: {
        accountId,
        idempotencyKey,
        requestHash, // ← real hash, not ""
        statusCode: 102, // Processing sentinel
        responseBody: { status: "PROCESSING" },
        expiresAt,
      },
    });
  } catch {
    // Unique constraint violation means a concurrent request already reserved this key.
    // Return a conflict so the caller knows to retry or poll.
    return {
      idempotencyKey,
      requestHash,
      cachedResponse: null,
      errorResponse: buildErrorResponse(
        409,
        "IDEMPOTENCY_IN_PROGRESS",
        "A concurrent request with the same idempotency key is already processing",
        undefined,
        requestId
      ),
    };
  }

  return { idempotencyKey, requestHash, cachedResponse: null, errorResponse: null };
}

/**
 * Call this AFTER the business write succeeds (or fails) to update the
 * idempotency record with the final response. Pass the requestHash returned
 * from checkIdempotency — never pass "".
 */
export async function persistIdempotency(
  accountId: string,
  idempotencyKey: string,
  requestHash: string,
  statusCode: number,
  responseBody: unknown
): Promise<void> {
  try {
    await db.idempotencyRecord.update({
      where: {
        accountId_idempotencyKey: { accountId, idempotencyKey },
      },
      data: {
        requestHash, // overwrite the PROCESSING sentinel with the real hash
        statusCode,
        responseBody: responseBody as Parameters<typeof db.idempotencyRecord.update>[0]["data"]["responseBody"],
      },
    });
  } catch (err) {
    console.error("Failed to persist idempotency record:", err);
  }
}

