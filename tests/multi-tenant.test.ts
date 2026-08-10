import { describe, it, expect, vi, beforeEach } from "vitest";

// This suite previously exercised a `MockAccountDatabase` declared in this same
// file. One test built a role object literal and then asserted that literal held
// the values just assigned to it. No production code was imported, so the real
// account-resolution path was never covered.

const clerk = {
  auth: vi.fn(),
  currentUser: vi.fn(),
};

const cookieStore = { get: vi.fn() };

const dbMock = {
  user: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  account: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  role: { findFirst: vi.fn(), create: vi.fn() },
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => clerk.auth(),
  currentUser: () => clerk.currentUser(),
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { getAccountContext, hasPermission, ACTIVE_ACCOUNT_COOKIE } = await import("@/lib/auth");

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem_1",
    accountId: "acc_1",
    status: "ACTIVE",
    deletedAt: null,
    account: {
      id: "acc_1",
      name: "Acme Corp",
      slug: "acme-corp",
      type: "ENTERPRISE",
      status: "ACTIVE",
      dataMode: "LIVE",
      ownerUserId: "u_1",
      deletedAt: null,
      createdAt: new Date("2026-01-01"),
    },
    // A membership now carries a set of roles through the join table rather
    // than a single roleId.
    roles: [role("OWNER")],
    ...overrides,
  };
}

/** One AccountMembershipRole row, as the context query includes it. */
function role(name: string, permissions: string[] = []) {
  return {
    roleId: `role_${name.toLowerCase()}`,
    role: {
      id: `role_${name.toLowerCase()}`,
      name,
      rolePermissions: permissions.map((p) => ({ permission: { name: p } })),
    },
  };
}

function user(memberships: unknown[], platformRoles: unknown[] = []) {
  return {
    id: "u_1",
    clerkUserId: "clerk_1",
    email: "john@acme.com",
    firstName: "John",
    lastName: "Doe",
    platformRoles,
    memberships,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clerk.auth.mockResolvedValue({ userId: "clerk_1" });
  clerk.currentUser.mockResolvedValue({
    emailAddresses: [{ emailAddress: "john@acme.com" }],
    firstName: "John",
    lastName: "Doe",
  });
  cookieStore.get.mockReturnValue(undefined);
});

describe("getAccountContext membership resolution", () => {
  it("resolves the active membership and its account", async () => {
    dbMock.user.findFirst.mockResolvedValue(user([membership()]));

    const ctx = await getAccountContext();

    expect(ctx?.accountId).toBe("acc_1");
    expect(ctx?.roleNames).toEqual(["OWNER"]);
    expect(ctx?.accountType).toBe("ENTERPRISE");
  });

  it("denies access when the only membership is disabled", async () => {
    // Previously fell through to memberships[0] and only the account was checked,
    // so a DISABLED member kept full access to the account.
    dbMock.user.findFirst.mockResolvedValue(user([membership({ status: "DISABLED" })]));

    expect(await getAccountContext()).toBeNull();
  });

  it("denies access when the only membership is inactive", async () => {
    dbMock.user.findFirst.mockResolvedValue(user([membership({ status: "INACTIVE" })]));

    expect(await getAccountContext()).toBeNull();
  });

  it("skips a disabled membership in favour of an active one", async () => {
    dbMock.user.findFirst.mockResolvedValue(
      user([
        membership({ status: "DISABLED" }),
        membership({
          id: "mem_2",
          accountId: "acc_2",
          account: { ...membership().account, id: "acc_2", name: "Beta Ltd", slug: "beta" },
        }),
      ])
    );

    const ctx = await getAccountContext();

    expect(ctx?.accountId).toBe("acc_2");
  });

  it("denies access when the account itself is suspended", async () => {
    dbMock.user.findFirst.mockResolvedValue(
      user([membership({ account: { ...membership().account, status: "SUSPENDED" } })])
    );

    expect(await getAccountContext()).toBeNull();
  });

  it("ignores an account-switch cookie naming an account the user is not a member of", async () => {
    cookieStore.get.mockReturnValue({ value: "acc_someone_else" });
    dbMock.user.findFirst.mockResolvedValue(user([membership()]));

    const ctx = await getAccountContext();

    // Falls back to a real membership rather than honouring the cookie.
    expect(ctx?.accountId).toBe("acc_1");
    expect(cookieStore.get).toHaveBeenCalledWith(ACTIVE_ACCOUNT_COOKIE);
  });

  it("honours the cookie when the user really is a member of that account", async () => {
    cookieStore.get.mockReturnValue({ value: "acc_2" });
    dbMock.user.findFirst.mockResolvedValue(
      user([
        membership(),
        membership({
          id: "mem_2",
          accountId: "acc_2",
          account: { ...membership().account, id: "acc_2", name: "Beta Ltd", slug: "beta" },
        }),
      ])
    );

    const ctx = await getAccountContext();

    expect(ctx?.accountId).toBe("acc_2");
  });

  it("returns null for a signed-out caller without querying the database", async () => {
    clerk.auth.mockResolvedValue({ userId: null });

    expect(await getAccountContext()).toBeNull();
    expect(dbMock.user.findFirst).not.toHaveBeenCalled();
  });
});

describe("platform admin derivation", () => {
  it("is false for a normal account owner", async () => {
    dbMock.user.findFirst.mockResolvedValue(user([membership()]));

    const ctx = await getAccountContext();

    expect(ctx?.isPlatformAdmin).toBe(false);
  });

  it("requires the PLATFORM_ADMIN platform role, not an account role", async () => {
    dbMock.user.findFirst.mockResolvedValue(
      user([membership()], [{ platformRole: { name: "SUPPORT" } }])
    );

    expect((await getAccountContext())?.isPlatformAdmin).toBe(false);

    dbMock.user.findFirst.mockResolvedValue(
      user([membership()], [{ platformRole: { name: "PLATFORM_ADMIN" } }])
    );

    expect((await getAccountContext())?.isPlatformAdmin).toBe(true);
  });
});

describe("hasPermission", () => {
  it("grants a permission held by the role", async () => {
    dbMock.user.findFirst.mockResolvedValue(
      user([
        membership({
          roles: [role("MEMBER", ["documents.create"])],
        }),
      ])
    );

    expect(await hasPermission("documents.create")).toBe(true);
    expect(await hasPermission("users.manage")).toBe(false);
  });

  it("denies every permission when there is no context", async () => {
    clerk.auth.mockResolvedValue({ userId: null });

    expect(await hasPermission("documents.create")).toBe(false);
  });

  it("does not grant permissions through a disabled membership", async () => {
    dbMock.user.findFirst.mockResolvedValue(
      user([
        membership({
          status: "DISABLED",
          roles: [role("ADMIN", ["users.manage"])],
        }),
      ])
    );

    expect(await hasPermission("users.manage")).toBe(false);
  });
});
