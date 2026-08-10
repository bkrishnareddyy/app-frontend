import { describe, it, expect } from "vitest";
import {
  resolveTenantShipmentId,
  shipmentResolutionStatus,
  ShipmentResolutionError,
  type ShipmentLookup,
} from "@/modules/shipments/resolveShipment";

const TENANT_A = "acct_a";
const TENANT_B = "acct_b";

// Shipment ownership table the fake lookup enforces, mirroring the accountId filter
// the real Prisma queries apply.
const OWNERSHIP: Record<string, string> = {
  shp_a1: TENANT_A,
  shp_a2: TENANT_A,
  shp_b1: TENANT_B,
};

function makeLookup(): ShipmentLookup {
  return {
    async findOwned(accountId, shipmentId) {
      return OWNERSHIP[shipmentId] === accountId ? shipmentId : null;
    },
  };
}

describe("tenant isolation: shipment resolution", () => {
  it("resolves a shipment the caller owns", async () => {
    const resolved = await resolveTenantShipmentId(TENANT_A, "shp_a1", makeLookup());
    expect(resolved).toBe("shp_a1");
  });

  it("refuses a shipment id belonging to another tenant", async () => {
    await expect(
      resolveTenantShipmentId(TENANT_A, "shp_b1", makeLookup())
    ).rejects.toMatchObject({ code: "SHIPMENT_NOT_FOUND" });
  });

  it("never silently retargets a foreign id onto the caller's own shipment", async () => {
    // The pre-fix code fell back to the caller's latest shipment when the requested id
    // failed to resolve, which turned a rejected write into a write on the wrong record.
    await expect(
      resolveTenantShipmentId(TENANT_A, "shp_b1", makeLookup())
    ).rejects.toBeInstanceOf(ShipmentResolutionError);
  });

  it("reports an unknown id and a foreign id identically", async () => {
    const lookup = makeLookup();
    const foreign = await resolveTenantShipmentId(TENANT_A, "shp_b1", lookup).catch((e) => e);
    const missing = await resolveTenantShipmentId(TENANT_A, "shp_nope", lookup).catch((e) => e);
    expect(foreign.code).toBe(missing.code);
    expect(foreign.message).toBe(missing.message);
  });

  it("refuses to pick a target when no shipment was named", async () => {
    // It used to return the account's newest shipment, so an intake with no
    // stated target was filed against whichever shipment was created last.
    for (const supplied of [null, undefined, ""]) {
      await expect(
        resolveTenantShipmentId(TENANT_A, supplied, makeLookup())
      ).rejects.toMatchObject({ code: "TARGET_NOT_DETERMINED" });
    }
  });

  it("does not read the shipment table at all when no id was supplied", async () => {
    let reads = 0;
    const counting: ShipmentLookup = {
      async findOwned() {
        reads += 1;
        return null;
      },
    };
    await resolveTenantShipmentId(TENANT_A, null, counting).catch(() => null);
    expect(reads).toBe(0);
  });

  it("maps resolution failures to distinct HTTP statuses", () => {
    expect(shipmentResolutionStatus("SHIPMENT_NOT_FOUND")).toBe(404);
    expect(shipmentResolutionStatus("TARGET_NOT_DETERMINED")).toBe(409);
  });
});

describe("tenant isolation: route query scoping", () => {
  const routeSources = [
    "src/app/api/agents/[agentId]/route.ts",
    "src/app/api/documents/upload/route.ts",
    "src/app/api/intake/agent/route.ts",
  ];

  it("no route resolves a caller-supplied shipment id with an unscoped findUnique", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const rel of routeSources) {
      const source = await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
      expect(source, `${rel} must not call shipment.findUnique`).not.toMatch(
        /shipment\.findUnique/
      );
      expect(source, `${rel} must use the tenant-scoped resolver`).toMatch(
        /resolveTenantShipmentId/
      );
    }
  });

  it("the regulatory impact route filters impacts by the caller's account", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../src/app/api/regulatory/[id]/impacted/route.ts", import.meta.url),
      "utf8"
    );
    expect(source).toMatch(/shipment: \{ accountId: ctx\.accountId/);
    // The route used to invent impact rows on a GET request.
    expect(source).not.toMatch(/regulatoryUpdateImpact\.create/);
    expect(source).not.toMatch(/Section 301 tariff adjustment applies/);
  });

  it("the PSC route verifies refund opportunity ownership before linking it", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../src/app/api/refunds/psc/route.ts", import.meta.url),
      "utf8"
    );
    expect(source).toMatch(
      /refundOpportunity\.findFirst\(\{\s*where: \{ id: refundOpportunityId, accountId: ctx\.accountId \}/
    );
  });
});
