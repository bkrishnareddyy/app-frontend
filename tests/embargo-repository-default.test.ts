import { describe, it, expect, vi } from "vitest";

// AccountEmbargoConfig has no seed, settings UI, or admin API anywhere in the
// codebase -- accounts with no row rely entirely on this fallback. It used to
// default audited/generalAuditLogEnabled to false, meaning the per-check
// embargo usage audit (EmbargoUsageHeader/Line) could never fire for any
// account that had never had a config row explicitly written.

const dbMock = {
  accountEmbargoConfig: { findUnique: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { getAccountEmbargoConfig } = await import("@/modules/agents/compliance/embargo/embargoRepository");

describe("getAccountEmbargoConfig default fallback", () => {
  it("defaults audited and generalAuditLogEnabled to true when no config row exists", async () => {
    dbMock.accountEmbargoConfig.findUnique.mockResolvedValue(null);

    const config = await getAccountEmbargoConfig("acct_no_row");

    expect(config.audited).toBe(true);
    expect(config.generalAuditLogEnabled).toBe(true);
    expect(config.embargoScreeningEnabled).toBe(true);
  });

  it("uses the row's own values when a config row exists, even if they're false", async () => {
    dbMock.accountEmbargoConfig.findUnique.mockResolvedValue({
      embargoScreeningEnabled: true,
      privateEmbargoEnabled: false,
      serverScreeningEnabled: true,
      genericExportLdEnabled: false,
      audited: false,
      emailAlertEnabled: false,
      generalAuditLogEnabled: false,
    });

    const config = await getAccountEmbargoConfig("acct_with_row");

    expect(config.audited).toBe(false);
    expect(config.generalAuditLogEnabled).toBe(false);
  });
});
