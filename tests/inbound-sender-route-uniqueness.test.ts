import { describe, it, expect } from "vitest";

/**
 * Simulates the tenant-isolation guarantee that
 * `InboundSenderRoute.normalizedSenderEmail @unique` gives in Postgres: two
 * accounts racing to claim the same sender cannot both succeed, and the
 * loser gets a conflict rather than silently overwriting the winner's route.
 *
 * A real concurrent-transaction test against Postgres is out of scope for
 * this repo's mocked-Prisma unit test style (see tests/tenant-isolation-routes.test.ts
 * for the same convention applied to shipment resolution); this documents
 * the same invariant at the unique-index boundary the API route
 * (src/app/api/settings/inbound-senders/route.ts) relies on when it catches
 * a Prisma P2002 and returns 409 SENDER_ALREADY_ROUTED without revealing the
 * other account.
 */
class UniqueSenderRouteStore {
  private claimedBy = new Map<string, string>();

  /** Mirrors `db.inboundSenderRoute.create` racing against a unique index. */
  async claim(normalizedEmail: string, accountId: string): Promise<{ ok: true } | { ok: false; code: "P2002" }> {
    if (this.claimedBy.has(normalizedEmail)) {
      return { ok: false, code: "P2002" };
    }
    this.claimedBy.set(normalizedEmail, accountId);
    return { ok: true };
  }

  ownerOf(normalizedEmail: string): string | undefined {
    return this.claimedBy.get(normalizedEmail);
  }
}

describe("inbound sender route uniqueness under concurrency", () => {
  it("lets exactly one of two racing accounts claim the same sender", async () => {
    const store = new UniqueSenderRouteStore();
    const [resultA, resultB] = await Promise.all([
      store.claim("jane@acme.com", "acct_a"),
      store.claim("jane@acme.com", "acct_b"),
    ]);

    const outcomes = [resultA, resultB];
    const winners = outcomes.filter((r) => r.ok);
    const losers = outcomes.filter((r) => !r.ok);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as { code: string }).code).toBe("P2002");
  });

  it("the losing account never becomes the owner", async () => {
    const store = new UniqueSenderRouteStore();
    await store.claim("jane@acme.com", "acct_a");
    const second = await store.claim("jane@acme.com", "acct_b");

    expect(second.ok).toBe(false);
    expect(store.ownerOf("jane@acme.com")).toBe("acct_a");
  });

  it("different senders never contend with each other", async () => {
    const store = new UniqueSenderRouteStore();
    const resultA = await store.claim("jane@acme.com", "acct_a");
    const resultB = await store.claim("accounts@target.com", "acct_b");

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
  });
});
