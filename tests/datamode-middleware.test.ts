import { describe, it, expect, vi } from "vitest";
import {
  db,
  rawDb,
  runWithDataMode,
  withDataModeContext,
  getDataModeContext,
  buildIsolatedQueryArgs,
} from "@/lib/db";

describe("DataMode Context Management", () => {
  it("defaults to undefined context when not running inside runWithDataMode", () => {
    expect(getDataModeContext()).toBeUndefined();
  });

  it("returns active mode inside runWithDataMode", () => {
    runWithDataMode("PRODUCTION", () => {
      expect(getDataModeContext()).toBe("PRODUCTION");
    });

    runWithDataMode("DEMO", () => {
      expect(getDataModeContext()).toBe("DEMO");
    });

    runWithDataMode("SANDBOX", () => {
      expect(getDataModeContext()).toBe("SANDBOX");
    });
  });

  it("supports explicit null context for platform admin bypass", () => {
    runWithDataMode(null, () => {
      expect(getDataModeContext()).toBeNull();
    });
  });

  it("supports async context execution via withDataModeContext", async () => {
    const result = await withDataModeContext("DEMO", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getDataModeContext();
    });

    expect(result).toBe("DEMO");
  });

  it("maintains isolated nested contexts", () => {
    runWithDataMode("PRODUCTION", () => {
      expect(getDataModeContext()).toBe("PRODUCTION");

      runWithDataMode("DEMO", () => {
        expect(getDataModeContext()).toBe("DEMO");
      });

      expect(getDataModeContext()).toBe("PRODUCTION");
    });
  });
});

describe("buildIsolatedQueryArgs Isolation Transformation", () => {
  it("attaches dataMode: PRODUCTION for Account queries under PRODUCTION context", () => {
    const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
      "Account",
      "findMany",
      { where: { status: "ACTIVE" } },
      "PRODUCTION"
    );

    expect(effectiveOperation).toBe("findMany");
    expect(newArgs).toEqual({
      where: {
        status: "ACTIVE",
        dataMode: "PRODUCTION",
      },
    });
  });

  it("attaches dataMode: DEMO for Account queries under DEMO context", () => {
    const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
      "Account",
      "findMany",
      { where: { status: "ACTIVE" } },
      "DEMO"
    );

    expect(effectiveOperation).toBe("findMany");
    expect(newArgs).toEqual({
      where: {
        status: "ACTIVE",
        dataMode: "DEMO",
      },
    });
  });

  it("attaches account: { dataMode: PRODUCTION } for tenant model queries (e.g. Shipment)", () => {
    const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
      "Shipment",
      "findMany",
      { where: { accountId: "acc_prod_1" } },
      "PRODUCTION"
    );

    expect(effectiveOperation).toBe("findMany");
    expect(newArgs).toEqual({
      where: {
        accountId: "acc_prod_1",
        account: {
          dataMode: "PRODUCTION",
        },
      },
    });
  });

  it("converts findUnique to findFirst on Account model when injecting non-unique dataMode field", () => {
    const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
      "Account",
      "findUnique",
      { where: { id: "acc_123" } },
      "PRODUCTION"
    );

    expect(effectiveOperation).toBe("findFirst");
    expect(newArgs).toEqual({
      where: {
        id: "acc_123",
        dataMode: "PRODUCTION",
      },
    });
  });

  it("converts findUnique to findFirst on tenant model (e.g. CustomsFiling) when injecting account dataMode filter", () => {
    const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
      "CustomsFiling",
      "findUnique",
      { where: { id: "filing_123" } },
      "PRODUCTION"
    );

    expect(effectiveOperation).toBe("findFirst");
    expect(newArgs).toEqual({
      where: {
        id: "filing_123",
        account: {
          dataMode: "PRODUCTION",
        },
      },
    });
  });

  it("respects explicit dataMode in query parameters without overriding", () => {
    const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
      "Account",
      "findMany",
      { where: { dataMode: "DEMO" } },
      "PRODUCTION"
    );

    expect(effectiveOperation).toBe("findMany");
    expect(newArgs).toEqual({
      where: {
        dataMode: "DEMO",
      },
    });
  });

  it("bypasses dataMode isolation when context is explicitly null", () => {
    const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
      "Account",
      "findMany",
      { where: { status: "ACTIVE" } },
      null
    );

    expect(effectiveOperation).toBe("findMany");
    expect(newArgs).toEqual({
      where: {
        status: "ACTIVE",
      },
    });
  });

  it("does not inject account relation filter for models lacking an account relation (e.g. DrawbackLot)", () => {
    const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
      "DrawbackLot",
      "findMany",
      { where: { accountId: "acc_123" } },
      "PRODUCTION"
    );

    expect(effectiveOperation).toBe("findMany");
    expect(newArgs).toEqual({
      where: {
        accountId: "acc_123",
      },
    });
  });
});

describe("DataMode Prisma Client Integration", () => {
  it("converts findUnique to findFirst on Account model and calls rawDb.account.findFirst", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(rawDb.account, "findFirst").mockImplementation((() => Promise.resolve(null)) as any);

    await runWithDataMode("PRODUCTION", async () => {
      await db.account.findUnique({ where: { id: "acc_123" } });
    });

    expect(spy).toHaveBeenCalledWith({
      where: {
        id: "acc_123",
        dataMode: "PRODUCTION",
      },
    });

    spy.mockRestore();
  });

  it("converts findUnique to findFirst on tenant model (e.g. CustomsFiling) and calls rawDb.customsFiling.findFirst", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(rawDb.customsFiling, "findFirst").mockImplementation((() => Promise.resolve(null)) as any);

    await runWithDataMode("PRODUCTION", async () => {
      await db.customsFiling.findUnique({ where: { id: "filing_123" } });
    });

    expect(spy).toHaveBeenCalledWith({
      where: {
        id: "filing_123",
        account: {
          dataMode: "PRODUCTION",
        },
      },
    });

    spy.mockRestore();
  });
});
