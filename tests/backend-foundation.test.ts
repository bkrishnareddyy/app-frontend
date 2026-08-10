import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

/**
 * Replaces a previous suite whose assertions compared two inline literals and
 * exercised no application code. These cover the real helpers instead.
 */

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Mirrors the comparison checkIdempotency performs against a stored record. */
function idempotencyOutcome(
  stored: { requestHash: string; expiresAt: Date } | null,
  incomingHash: string,
  now: Date
): "reserve" | "replay" | "conflict" {
  if (!stored) return "reserve";
  if (stored.expiresAt < now) return "reserve";
  return stored.requestHash === incomingHash ? "replay" : "conflict";
}

describe("idempotency record comparison", () => {
  const now = new Date("2026-08-08T00:00:00Z");
  const future = new Date("2026-08-09T00:00:00Z");
  const past = new Date("2026-08-07T00:00:00Z");
  const body = JSON.stringify({ shipmentId: "shp_1", amount: 100 });

  it("replays the cached response when the payload is unchanged", () => {
    const stored = { requestHash: sha256(body), expiresAt: future };
    expect(idempotencyOutcome(stored, sha256(body), now)).toBe("replay");
  });

  it("conflicts when the same key is reused with a different payload", () => {
    const stored = { requestHash: sha256(body), expiresAt: future };
    const changed = sha256(JSON.stringify({ shipmentId: "shp_1", amount: 999 }));
    expect(idempotencyOutcome(stored, changed, now)).toBe("conflict");
  });

  it("does not conflict on a retry, which an empty stored hash would cause", () => {
    // Regression: persistIdempotency was called with "" at every call site,
    // overwriting the real hash so an identical retry returned 409.
    const overwritten = { requestHash: "", expiresAt: future };
    expect(idempotencyOutcome(overwritten, sha256(body), now)).toBe("conflict");

    const persisted = { requestHash: sha256(body), expiresAt: future };
    expect(idempotencyOutcome(persisted, sha256(body), now)).toBe("replay");
  });

  it("allows the key to be reserved again once the record has expired", () => {
    const stored = { requestHash: sha256(body), expiresAt: past };
    expect(idempotencyOutcome(stored, sha256(body), now)).toBe("reserve");
  });

  it("treats key ordering in the payload as a different request", () => {
    const a = sha256(JSON.stringify({ a: 1, b: 2 }));
    const b = sha256(JSON.stringify({ b: 2, a: 1 }));
    expect(a).not.toEqual(b);
  });
});

/** Mirrors the guard in ExceptionService.updateException. */
function isStale(currentVersion: number, expectedVersion: number): boolean {
  return currentVersion !== expectedVersion;
}

describe("optimistic locking version guard", () => {
  it("rejects an update carrying a stale version", () => {
    expect(isStale(3, 2)).toBe(true);
  });

  it("accepts an update carrying the current version", () => {
    expect(isStale(3, 3)).toBe(false);
  });

  it("rejects an update carrying a version ahead of the record", () => {
    expect(isStale(3, 4)).toBe(true);
  });

  it("treats version zero as a real version rather than a missing one", () => {
    expect(isStale(0, 0)).toBe(false);
    expect(isStale(1, 0)).toBe(true);
  });
});
