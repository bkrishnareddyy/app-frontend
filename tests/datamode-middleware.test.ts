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

  // Regression coverage for the Phase 0 isolation-backstop fix: WorkMetricSnapshot,
  // DrawbackLot, and DrawbackClaimSequence carried a bare accountId with no `account`
  // relation, so the DMMF-driven scan in db.ts never picked them up and they received
  // zero automatic DataMode filtering. Each model now declares an `account` relation
  // (see prisma/migrations/20260814020000_tenant_account_relation_backstop), so they
  // must be isolated exactly like every other tenant-owned model.
  it.each(["WorkMetricSnapshot", "DrawbackLot", "DrawbackClaimSequence"])(
    "injects the account relation dataMode filter for the previously-unprotected model %s",
    (model) => {
      const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
        model,
        "findMany",
        { where: { accountId: "acc_123" } },
        "PRODUCTION"
      );

      expect(effectiveOperation).toBe("findMany");
      expect(newArgs).toEqual({
        where: {
          accountId: "acc_123",
          account: {
            dataMode: "PRODUCTION",
          },
        },
      });
    }
  );
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

describe("Tenant isolation backstop: schema-level scan for unprotected accountId models", () => {
  // A model with a bare `accountId` column but neither an `account` relation nor a
  // `dataMode` field is invisible to buildIsolatedQueryArgs's DMMF scan and gets zero
  // automatic isolation, tenant or DataMode. This happened silently for
  // WorkMetricSnapshot, DrawbackLot, and DrawbackClaimSequence (Phase 0 fix). This test
  // scans prisma/schema.prisma directly so a future model can never reintroduce the same
  // gap without failing CI, independent of whether `prisma generate` has been re-run.
  it("has no tenant-owned model with accountId but no account relation and no dataMode field", async () => {
    const { readFile } = await import("node:fs/promises");
    const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

    const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
    const offenders: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = modelRe.exec(schema))) {
      const [, name, body] = match;
      const hasAccountId = /^\s*accountId\s+String/m.test(body);
      const hasAccountRelation = /^\s*account\s+Account(\?)?\s*(@relation)?/m.test(body);
      const hasDataMode = /^\s*dataMode\s+DataMode/m.test(body);
      if (hasAccountId && !hasAccountRelation && !hasDataMode) {
        offenders.push(name);
      }
    }

    expect(offenders).toEqual([]);
  });
});
