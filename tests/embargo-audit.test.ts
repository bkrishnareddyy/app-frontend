import { describe, it, expect, vi, beforeEach } from "vitest";

// Country Embargo Screening: embargoAudit.ts persistence.
// Mandatory coverage: header creation gated by accountConfig.audited, detail
// line writes gated by emailAlertEnabled/generalAuditLogEnabled, P/F result
// codes, and SKIPPED/ERROR checks are never recorded as "P".

const dbMock = {
  embargoUsageHeader: { create: vi.fn() },
  embargoUsageLine: { createMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/agents/agentLogger", () => ({ logAgentError: vi.fn() }));

const { buildEmbargoAuditContext, createEmbargoUsageHeader, createEmbargoUsageLines } = await import(
  "@/modules/agents/compliance/embargo/embargoAudit"
);

const accountConfig = {
  embargoScreeningEnabled: true,
  privateEmbargoEnabled: false,
  serverScreeningEnabled: true,
  genericExportLdEnabled: false,
  audited: false,
  emailAlertEnabled: false,
  generalAuditLogEnabled: false,
};

function check(overrides: Record<string, unknown> = {}) {
  return {
    result: "CLEAR",
    complianceCountry: "CN",
    screenedCountry: "IR",
    screeningLevel: "TRANSACTION",
    type: "D",
    matcher: "STANDARD",
    context: { accountId: "acct_1", shipmentId: "ship_1" },
    ...overrides,
  } as Parameters<typeof createEmbargoUsageLines>[2][number];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildEmbargoAuditContext", () => {
  it("is not audited when accountConfig.audited is false, regardless of other flags", () => {
    const ctx = buildEmbargoAuditContext({ ...accountConfig, emailAlertEnabled: true, generalAuditLogEnabled: true });
    expect(ctx.audited).toBe(false);
  });

  it("enables detailed line writes when emailAlertEnabled is set", () => {
    const ctx = buildEmbargoAuditContext({ ...accountConfig, audited: true, emailAlertEnabled: true });
    expect(ctx.writeDetailedLines).toBe(true);
  });

  it("enables detailed line writes when generalAuditLogEnabled is set", () => {
    const ctx = buildEmbargoAuditContext({ ...accountConfig, audited: true, generalAuditLogEnabled: true });
    expect(ctx.writeDetailedLines).toBe(true);
  });

  it("disables detailed line writes when neither audit flag is set", () => {
    const ctx = buildEmbargoAuditContext({ ...accountConfig, audited: true });
    expect(ctx.writeDetailedLines).toBe(false);
  });
});

describe("createEmbargoUsageHeader", () => {
  it("creates exactly one header row scoped to the account and shipment", async () => {
    dbMock.embargoUsageHeader.create.mockResolvedValue({ id: "header_1" });
    const id = await createEmbargoUsageHeader({ accountId: "acct_1", shipmentId: "ship_1", transactionId: "txn_1" });
    expect(id).toBe("header_1");
    expect(dbMock.embargoUsageHeader.create).toHaveBeenCalledTimes(1);
    expect(dbMock.embargoUsageHeader.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: "acct_1",
        shipmentId: "ship_1",
        transactionId: "txn_1",
        screeningType: "COUNTRY_EMBARGO",
      }),
    });
  });

  it("returns null instead of throwing when the write fails, so a screening determination is never lost to an audit error", async () => {
    dbMock.embargoUsageHeader.create.mockRejectedValue(new Error("db down"));
    const id = await createEmbargoUsageHeader({ accountId: "acct_1", shipmentId: "ship_1" });
    expect(id).toBeNull();
  });
});

describe("createEmbargoUsageLines", () => {
  it("writes P for a CLEAR check and F for a HIT check", async () => {
    dbMock.embargoUsageLine.createMany.mockResolvedValue({ count: 2 });
    const count = await createEmbargoUsageLines("header_1", "acct_1", [
      check({ result: "CLEAR" }),
      check({ result: "HIT", ruleId: "9" }),
    ]);
    expect(count).toBe(2);
    const rows = dbMock.embargoUsageLine.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0].result).toBe("P");
    expect(rows[1].result).toBe("F");
  });

  it("never writes a row for SKIPPED or ERROR checks -- they must never be recorded as P", async () => {
    dbMock.embargoUsageLine.createMany.mockResolvedValue({ count: 1 });
    await createEmbargoUsageLines("header_1", "acct_1", [
      check({ result: "SKIPPED" }),
      check({ result: "ERROR" }),
      check({ result: "CLEAR" }),
    ]);
    const rows = dbMock.embargoUsageLine.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows.every((r: { result: string }) => r.result === "P" || r.result === "F")).toBe(true);
  });

  it("skips the write entirely when there are no completed checks", async () => {
    const count = await createEmbargoUsageLines("header_1", "acct_1", [check({ result: "SKIPPED" })]);
    expect(count).toBe(0);
    expect(dbMock.embargoUsageLine.createMany).not.toHaveBeenCalled();
  });

  it("stamps every line with the exception type EM and the given exceptionType/EM invariant", async () => {
    dbMock.embargoUsageLine.createMany.mockResolvedValue({ count: 1 });
    await createEmbargoUsageLines("header_1", "acct_1", [check({ result: "CLEAR" })]);
    const rows = dbMock.embargoUsageLine.createMany.mock.calls[0][0].data;
    expect(rows[0].exceptionType).toBe("EM");
  });

  it("scopes every line to the given headerId and accountId (tenant isolation)", async () => {
    dbMock.embargoUsageLine.createMany.mockResolvedValue({ count: 1 });
    await createEmbargoUsageLines("header_1", "acct_1", [check({ result: "CLEAR" })]);
    const rows = dbMock.embargoUsageLine.createMany.mock.calls[0][0].data;
    expect(rows[0].headerId).toBe("header_1");
    expect(rows[0].accountId).toBe("acct_1");
  });

  it("returns 0 instead of throwing when the batch write fails", async () => {
    dbMock.embargoUsageLine.createMany.mockRejectedValue(new Error("db down"));
    const count = await createEmbargoUsageLines("header_1", "acct_1", [check({ result: "CLEAR" })]);
    expect(count).toBe(0);
  });
});
