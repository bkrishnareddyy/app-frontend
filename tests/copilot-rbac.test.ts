import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AccountContext } from "@/lib/auth";

/**
 * RBAC: the Copilot is never a softer door than the app.
 *
 * Two halves. The mechanism — `canUseTool` and `availableTools` — is tested
 * against the real navigation config and the real permission mirror. The
 * consequence is tested by denying one screen and checking that the tool behind
 * it disappears from the declarations *and* is refused if the model names it
 * anyway: an undeclared tool is not a protected tool.
 *
 * `canAccessHref` is stubbed here rather than hand-crafting a role that fails,
 * because in the shipped navigation config the operational screens are open to
 * every account member. Stubbing it tests the wiring — that the Copilot asks the
 * app's own gate and obeys the answer — which is the part that could regress.
 */

const canAccessHrefMock = vi.fn();

vi.mock("@/lib/navigation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/navigation")>("@/lib/navigation");
  return { ...actual, canAccessHref: canAccessHrefMock };
});

const dbMock = {
  product: { findFirst: vi.fn() },
  productEvidence: { findMany: vi.fn(), count: vi.fn() },
  shipmentDocument: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  agentDecision: { findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { canUseTool, availableTools } = await import("@/modules/copilot/copilotAccess");
const { COPILOT_TOOLS } = await import("@/modules/copilot/copilotTools");
const { CopilotToolExecutor } = await import("@/modules/copilot/copilotToolExecutor");
const { CopilotLedger } = await import("@/modules/copilot/copilotLedger");

function accountContext(overrides: Partial<AccountContext> = {}): AccountContext {
  return {
    userId: "user_1",
    clerkUserId: "clerk_1",
    email: "clerk@example.com",
    isPlatformAdmin: false,
    platformRoles: [],
    accountId: "acct_alpha",
    accountName: "Alpha Customs",
    accountSlug: "alpha",
    accountType: "BROKER",
    dataMode: "LIVE",
    membershipId: "mem_1",
    roleIds: ["role_1"],
    roleNames: ["MEMBER"],
    permissions: [],
    memberships: [],
    ...overrides,
  } as unknown as AccountContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  canAccessHrefMock.mockReturnValue(true);
});

describe("tool access mirrors the app's own gates", () => {
  it("asks canAccessHref for a nav-gated tool and obeys the answer", () => {
    const context = accountContext();

    expect(canUseTool(context, { navHref: "/app/documents" })).toBe(true);
    expect(canAccessHrefMock).toHaveBeenCalledWith(
      {
        roleNames: context.roleNames,
        permissions: context.permissions,
        isPlatformAdmin: context.isPlatformAdmin,
      },
      "/app/documents"
    );

    canAccessHrefMock.mockReturnValue(false);
    expect(canUseTool(context, { navHref: "/app/documents" })).toBe(false);
  });

  it("checks a catalogued permission through the same mirror the services use", () => {
    const gate = { permission: "products.classification.approve" };

    expect(canUseTool(accountContext(), gate)).toBe(false);
    expect(canUseTool(accountContext({ permissions: [gate.permission] }), gate)).toBe(true);
    // The OWNER and platform-admin bypasses that apply everywhere else apply here.
    expect(canUseTool(accountContext({ roleNames: ["OWNER"] }), gate)).toBe(true);
    expect(canUseTool(accountContext({ isPlatformAdmin: true }), gate)).toBe(true);
  });

  it("requires both gates when a tool declares both", () => {
    const gate = { navHref: "/app/products", permission: "products.classification.approve" };

    expect(canUseTool(accountContext(), gate)).toBe(false);

    canAccessHrefMock.mockReturnValue(false);
    expect(canUseTool(accountContext({ permissions: [gate.permission] }), gate)).toBe(false);
  });

  it("treats an ungated tool as available to any member of the account", () => {
    expect(canUseTool(accountContext(), undefined)).toBe(true);
  });
});

describe("tools the user cannot use are neither offered nor served", () => {
  /** Deny exactly one screen, as a role restricted away from Documents would. */
  function denyDocuments() {
    canAccessHrefMock.mockImplementation((_access: unknown, href: string) => href !== "/app/documents");
  }

  it("omits the tools behind a denied screen from the declarations", () => {
    denyDocuments();
    const offered = availableTools(accountContext(), COPILOT_TOOLS).map((tool) => tool.name);

    expect(offered).not.toContain("searchDocuments");
    expect(offered).not.toContain("getDocument");
    // And nothing else is collateral damage.
    expect(offered).toContain("searchProducts");
    expect(offered).toContain("listExceptions");
    expect(offered.length).toBe(COPILOT_TOOLS.length - 2);
  });

  it("refuses a denied tool the model names anyway, and runs no query", async () => {
    denyDocuments();
    const context = accountContext();
    const ledger = new CopilotLedger();
    const executor = new CopilotToolExecutor({
      actor: { accountId: context.accountId, userId: context.userId, requestId: "req_1", context },
      ledger,
    });

    const outcome = await executor.run({ name: "getDocument", args: { documentId: "doc_1" } });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("NOT_AUTHORIZED");
    expect(String((outcome.payload.error as { message: string }).message)).toContain(
      "does not have access"
    );
    // The check happens before the read, so nothing about the record leaks —
    // not even whether it exists.
    expect(dbMock.shipmentDocument.findFirst).not.toHaveBeenCalled();
    expect(executor.callsMade).toBe(0);
    expect(ledger.isEmpty).toBe(true);
  });

  it("still serves the tools the user is allowed to use", async () => {
    denyDocuments();
    dbMock.agentDecision.findMany.mockResolvedValue([]);
    const context = accountContext();
    const executor = new CopilotToolExecutor({
      actor: { accountId: context.accountId, userId: context.userId, requestId: "req_1", context },
      ledger: new CopilotLedger(),
    });

    const outcome = await executor.run({ name: "listDecisions", args: {} });

    expect(outcome.ok).toBe(true);
  });

  it("fails closed for a gate naming a route the app does not have", async () => {
    // The real gate this time: an unknown href has no nav item to authorize, so
    // it denies everyone — including a platform admin.
    const { canAccessHref } = await vi.importActual<typeof import("@/lib/navigation")>(
      "@/lib/navigation"
    );
    const access = { roleNames: ["OWNER"], permissions: [], isPlatformAdmin: true };

    expect(canAccessHref(access, "/app/nonexistent")).toBe(false);
    expect(canAccessHref(access, "/app/documents")).toBe(true);
  });
});
