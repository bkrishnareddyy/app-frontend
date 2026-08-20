import { describe, it, expect, vi, beforeEach } from "vitest";

// The cron re-evaluation sweep can silently flip an OriginDetermination's
// qualifies/criterion/RVC% (e.g. a trade agreement rule update or a fixed
// composition record) with no audit trail -- the interactive
// /api/advisory/origin-determination route logs ORIGIN_DETERMINED, but this
// system-triggered path previously never called createAuditLog at all.

const dbMock = {
  shipmentLineItem: { findMany: vi.fn() },
  originDetermination: { update: vi.fn() },
};

const createAuditLogMock = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({
  createAuditLog: createAuditLogMock,
  AuditAction: { ORIGIN_DETERMINED: "origin.determined" },
}));

const { reevaluateProductLineItems } = await import("@/app/api/cron/origin-re-eval/route");

function lineItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "sli_1",
    productId: "prod_1",
    htsCode: "8501.10", // chapter 85: USMCA requires 60% RVC
    description: "Widget",
    totalValue: 100,
    countryOfOrigin: "MX",
    product: { compositions: [] },
    origins: [
      {
        id: "od_1",
        qualifies: true,
        criterion: "Criterion A (Wholly Obtained)",
        regionalValueContentPct: 70,
        tradeAgreement: { code: "USMCA" },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.originDetermination.update.mockResolvedValue({});
});

describe("reevaluateProductLineItems audit trail", () => {
  it("logs ORIGIN_DETERMINED with before/after when a re-determination changes the outcome", async () => {
    dbMock.shipmentLineItem.findMany.mockResolvedValue([
      lineItem({
        // The route's composition->material mapping only carries id/name/cost
        // (no htsCode/countryOfOrigin), so any composition makes determineOrigin
        // record a "HTS code unknown" gap and fail the tariff-shift check --
        // flipping qualifies from true to false via its real logic.
        product: {
          compositions: [{ id: "comp_1", material: "Non-originating input", percentage: 50 }],
        },
      }),
    ]);

    await reevaluateProductLineItems("prod_1", "acc_1");

    expect(dbMock.originDetermination.update).toHaveBeenCalledTimes(1);
    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
    const call = createAuditLogMock.mock.calls[0][0];
    expect(call.accountId).toBe("acc_1");
    expect(call.action).toBe("origin.determined");
    expect(call.entity).toBe("OriginDetermination");
    expect(call.entityId).toBe("od_1");
    expect(call.source).toBe("SYSTEM");
    expect(call.beforeJson.qualifies).toBe(true);
    expect(call.afterJson).toBeDefined();
  });

  it("does not log when re-determination reaches the same outcome", async () => {
    // A line item whose stored determination already matches what
    // determineOrigin recomputes -- the common case on a daily sweep. With no
    // compositions, there are no gaps and no non-originating cost, so the
    // tariff shift passes and RVC computes to 100%.
    dbMock.shipmentLineItem.findMany.mockResolvedValue([
      lineItem({
        origins: [
          {
            id: "od_2",
            qualifies: true,
            criterion: "TARIFF_SHIFT",
            regionalValueContentPct: 100,
            tradeAgreement: { code: "USMCA" },
          },
        ],
      }),
    ]);

    await reevaluateProductLineItems("prod_1", "acc_1");

    expect(dbMock.originDetermination.update).toHaveBeenCalledTimes(1);
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });

  it("skips line items with no existing origin determination", async () => {
    dbMock.shipmentLineItem.findMany.mockResolvedValue([lineItem({ origins: [] })]);

    const result = await reevaluateProductLineItems("prod_1", "acc_1");

    expect(dbMock.originDetermination.update).not.toHaveBeenCalled();
    expect(createAuditLogMock).not.toHaveBeenCalled();
    expect(result).toEqual({ evaluatedLineItems: 1, updatedDeterminations: 0 });
  });
});
