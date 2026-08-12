import { describe, it, expect } from "vitest";
import { resolveInboundRoute, type InboundRouteLookup, type ResolvedInboundRoute } from "@/modules/inbound/senderRouting";

const ACCOUNT_A = "acct_a";
const ACCOUNT_B = "acct_b";

// Routing table the fake lookup enforces, mirroring the
// `normalizedSenderEmail @unique` constraint the real Prisma schema applies:
// a given normalized email can appear at most once across all accounts.
const ROUTES: Record<string, ResolvedInboundRoute> = {
  "jane@acme.com": { id: "route_1", accountId: ACCOUNT_A, defaultAssignedToUserId: "user_jane" },
  "accounts@target.com": { id: "route_2", accountId: ACCOUNT_B, defaultAssignedToUserId: null },
};

function makeLookup(overrides?: Partial<InboundRouteLookup>): InboundRouteLookup {
  return {
    async findActiveByNormalizedEmail(normalizedEmail) {
      return ROUTES[normalizedEmail] ?? null;
    },
    ...overrides,
  };
}

describe("inbound sender routing", () => {
  it("resolves an authorized sender to its account", async () => {
    const route = await resolveInboundRoute("jane@acme.com", makeLookup());
    expect(route).toEqual(ROUTES["jane@acme.com"]);
  });

  it("resolves after normalizing (whitespace/case)", async () => {
    const route = await resolveInboundRoute("  Jane@ACME.com  ", makeLookup());
    expect(route?.accountId).toBe(ACCOUNT_A);
  });

  it("returns null for an unknown sender -- never guesses a tenant", async () => {
    const route = await resolveInboundRoute("stranger@nowhere.com", makeLookup());
    expect(route).toBeNull();
  });

  it("resolves a route with no default assignee to a route with a null assignee, not an error", async () => {
    const route = await resolveInboundRoute("accounts@target.com", makeLookup());
    expect(route).toEqual({ id: "route_2", accountId: ACCOUNT_B, defaultAssignedToUserId: null });
  });

  it("a sender can only ever resolve to one account (uniqueness lives in the DB constraint, not here)", async () => {
    // The lookup itself can only return a single route per normalized email
    // by construction (a Record key), which is the same guarantee
    // `normalizedSenderEmail @unique` gives the real implementation: two
    // accounts racing to claim the same sender cannot both win, because the
    // second `create` hits the unique constraint and fails. This test
    // documents that expectation at the resolver boundary.
    const lookup = makeLookup({
      async findActiveByNormalizedEmail(normalizedEmail) {
        const route = ROUTES[normalizedEmail];
        return route ? { ...route } : null;
      },
    });
    const first = await resolveInboundRoute("jane@acme.com", lookup);
    const second = await resolveInboundRoute("jane@acme.com", lookup);
    expect(first?.accountId).toBe(second?.accountId);
  });
});
