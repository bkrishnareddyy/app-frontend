import { describe, it, expect, vi, beforeEach } from "vitest";

// Country Embargo Screening: countryEmbargoScreening.ts orchestrator.
// Covers: enablement gating, transaction/party/line D+O screening, duplicate
// suppression by party identity (not merely by country), status computation,
// and gating audit persistence on accountConfig.audited.

const doEmbargoCheck = vi.fn();
const buildEmbargoAuditContext = vi.fn();
const createEmbargoUsageHeader = vi.fn();
const createEmbargoUsageLines = vi.fn();

vi.mock("@/modules/agents/compliance/embargo/doEmbargoCheck", () => ({ doEmbargoCheck }));
vi.mock("@/modules/agents/compliance/embargo/embargoAudit", () => ({
  buildEmbargoAuditContext,
  createEmbargoUsageHeader,
  createEmbargoUsageLines,
}));

const { runCountryEmbargoScreening } = await import(
  "@/modules/agents/compliance/embargo/countryEmbargoScreening"
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

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    shipmentId: "ship_1",
    shipFromCountry: "CN",
    shipToCountry: "IR",
    parties: [],
    lineItems: [],
    screeningDate: new Date("2026-01-01"),
    accountConfig,
    ...overrides,
  } as Parameters<typeof runCountryEmbargoScreening>[0];
}

function clear(level: string, type: string, target: string, extra: Record<string, unknown> = {}) {
  return {
    result: "CLEAR",
    complianceCountry: "CN",
    screenedCountry: target,
    screeningLevel: level,
    type,
    matcher: "STANDARD",
    context: { accountId: "acct_1", shipmentId: "ship_1", screeningLevel: level, type, ...extra },
    ...extra,
  };
}

function hit(level: string, type: string, target: string, extra: Record<string, unknown> = {}) {
  return {
    ...clear(level, type, target, extra),
    result: "HIT",
    reason: "DIRECT_COUNTRY_PAIR_EMBARGOED",
    ruleId: "1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  buildEmbargoAuditContext.mockReturnValue({ audited: false, writeDetailedLines: false });
});

describe("runCountryEmbargoScreening", () => {
  it("skips entirely and never calls doEmbargoCheck when account-level embargo screening is disabled", async () => {
    const result = await runCountryEmbargoScreening(
      baseInput({ accountConfig: { ...accountConfig, embargoScreeningEnabled: false } })
    );
    expect(result.status).toBe("SKIPPED");
    expect(result.skippedChecks).toEqual([{ reason: "EMBARGO_SCREENING_DISABLED" }]);
    expect(doEmbargoCheck).not.toHaveBeenCalled();
  });

  it("skips entirely when embargoScreening is explicitly disabled for this invocation", async () => {
    const result = await runCountryEmbargoScreening(baseInput({ embargoScreening: false }));
    expect(result.status).toBe("SKIPPED");
    expect(doEmbargoCheck).not.toHaveBeenCalled();
  });

  it("runs a transaction-level destination check and reports CLEAR when no hits occur", async () => {
    doEmbargoCheck.mockResolvedValue(clear("TRANSACTION", "D", "IR"));
    const result = await runCountryEmbargoScreening(baseInput());
    expect(result.status).toBe("CLEAR");
    expect(result.hits).toHaveLength(0);
    expect(doEmbargoCheck).toHaveBeenCalledTimes(1);
  });

  it("reports a transaction-level HIT and records it as a finding", async () => {
    doEmbargoCheck.mockResolvedValue(hit("TRANSACTION", "D", "IR"));
    const result = await runCountryEmbargoScreening(baseInput());
    expect(result.status).toBe("HIT");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ country: "IR", embargo: "Y" });
  });

  it("skips transaction-level screening with a documented reason when shipToCountry is missing", async () => {
    doEmbargoCheck.mockResolvedValue(clear("PARTY", "D", "IR"));
    const result = await runCountryEmbargoScreening(baseInput({ shipToCountry: null }));
    expect(result.skippedChecks).toContainEqual({ reason: "MISSING_SHIP_TO_COUNTRY", screeningLevel: "TRANSACTION" });
  });

  it("screens every party for destination embargo and skips parties with no country", async () => {
    doEmbargoCheck.mockResolvedValue(clear("PARTY", "D", "IR"));
    const result = await runCountryEmbargoScreening(
      baseInput({
        shipToCountry: null,
        parties: [
          { partyId: "p1", partyType: "CONSIGNEE", country: "IR" },
          { partyId: "p2", partyType: "NOTIFY", country: null },
        ],
      })
    );
    expect(doEmbargoCheck).toHaveBeenCalledTimes(1);
    expect(result.skippedChecks).toContainEqual({ reason: "MISSING_PARTY_COUNTRY", screeningLevel: "PARTY", partyId: "p2" });
  });

  it("propagates a party's militaryEndUse flag into the check context", async () => {
    doEmbargoCheck.mockResolvedValue(clear("PARTY", "D", "IR"));
    await runCountryEmbargoScreening(
      baseInput({
        shipToCountry: null,
        parties: [{ partyId: "p1", partyType: "CONSIGNEE", country: "IR", militaryEndUse: true }],
      })
    );
    expect(doEmbargoCheck).toHaveBeenCalledWith(expect.objectContaining({ militaryEndUse: true, partyId: "p1" }));
  });

  it("suppresses a duplicate SHIP_TO party hit when the transaction-level check already hit on the same country", async () => {
    doEmbargoCheck.mockImplementation((ctx: { screeningLevel: string }) =>
      Promise.resolve(hit(ctx.screeningLevel, "D", "IR"))
    );
    const result = await runCountryEmbargoScreening(
      baseInput({
        parties: [{ partyId: "p1", partyType: "CONSIGNEE", country: "IR", isShipTo: true }],
      })
    );
    // Transaction check + party check both run (audit completeness), but only one finding surfaces.
    expect(doEmbargoCheck).toHaveBeenCalledTimes(1 + 1);
    expect(result.hits).toHaveLength(1);
    expect(result.checks).toHaveLength(2);
  });

  it("does not suppress a party hit when the party is not the SHIP_TO party, even if the country matches", async () => {
    doEmbargoCheck.mockImplementation((ctx: { screeningLevel: string }) =>
      Promise.resolve(hit(ctx.screeningLevel, "D", "IR"))
    );
    const result = await runCountryEmbargoScreening(
      baseInput({
        parties: [{ partyId: "p1", partyType: "CONSIGNEE", country: "IR", isShipTo: false }],
      })
    );
    expect(result.hits).toHaveLength(2);
  });

  it("suppresses a line-destination hit when the same party already produced a hit at a higher level", async () => {
    doEmbargoCheck.mockImplementation((ctx: { screeningLevel: string }) =>
      Promise.resolve(hit(ctx.screeningLevel, "D", "IR"))
    );
    const result = await runCountryEmbargoScreening(
      baseInput({
        parties: [{ partyId: "p1", partyType: "CONSIGNEE", country: "IR", isShipTo: true }],
        lineItems: [
          {
            lineItemId: "line_1",
            lineNumber: 1,
            destinationParty: { partyId: "p1", partyType: "CONSIGNEE", country: "IR" },
          },
        ],
      })
    );
    // transaction hit + party hit suppressed against transaction + line-destination hit suppressed against party
    expect(result.checks).toHaveLength(3);
    expect(result.hits).toHaveLength(1);
  });

  it("skips a line's destination check with a documented reason when it has no destination party", async () => {
    doEmbargoCheck.mockResolvedValue(clear("LINE", "O", "CN"));
    const result = await runCountryEmbargoScreening(
      baseInput({
        shipToCountry: null,
        lineItems: [{ lineItemId: "line_1", lineNumber: 1, countryOfOrigin: "CN" }],
      })
    );
    expect(result.skippedChecks).toContainEqual({
      reason: "MISSING_LINE_DESTINATION_PARTY",
      screeningLevel: "LINE",
      lineItemId: "line_1",
    });
  });

  it("skips a line's origin check with a documented reason when countryOfOrigin is missing", async () => {
    doEmbargoCheck.mockResolvedValue(clear("LINE", "D", "IR"));
    const result = await runCountryEmbargoScreening(
      baseInput({
        shipToCountry: null,
        lineItems: [
          {
            lineItemId: "line_1",
            lineNumber: 1,
            destinationParty: { partyId: "p9", partyType: "CONSIGNEE", country: "IR" },
          },
        ],
      })
    );
    expect(result.skippedChecks).toContainEqual({
      reason: "MISSING_COUNTRY_OF_ORIGIN",
      screeningLevel: "LINE",
      lineItemId: "line_1",
    });
  });

  it("never suppresses an origin hit against a destination hit on the same line -- D and O stay logically distinct", async () => {
    doEmbargoCheck.mockImplementation((ctx: { type: string }) =>
      Promise.resolve(hit("LINE", ctx.type, ctx.type === "D" ? "IR" : "KP"))
    );
    const result = await runCountryEmbargoScreening(
      baseInput({
        shipToCountry: null,
        lineItems: [
          {
            lineItemId: "line_1",
            lineNumber: 1,
            countryOfOrigin: "KP",
            destinationParty: { partyId: "p9", partyType: "CONSIGNEE", country: "IR" },
          },
        ],
      })
    );
    expect(result.hits).toHaveLength(2);
    expect(result.hits.map((h: { type: string }) => h.type).sort()).toEqual(["D", "O"]);
  });

  it("parses a line's pipe-delimited classification string for ECCN when no explicit eccn is supplied", async () => {
    doEmbargoCheck.mockResolvedValue(clear("LINE", "D", "IR"));
    await runCountryEmbargoScreening(
      baseInput({
        shipToCountry: null,
        lineItems: [
          {
            lineItemId: "line_1",
            lineNumber: 1,
            classification: "HTS|8501.10|CCL|3A001",
            destinationParty: { partyId: "p9", partyType: "CONSIGNEE", country: "IR" },
          },
        ],
      })
    );
    expect(doEmbargoCheck).toHaveBeenCalledWith(expect.objectContaining({ eccn: "3A001" }));
  });

  it("reports status ERROR when every check errors and none hit", async () => {
    doEmbargoCheck.mockResolvedValue({
      result: "ERROR",
      complianceCountry: "CN",
      screenedCountry: "IR",
      screeningLevel: "TRANSACTION",
      type: "D",
      matcher: "STANDARD",
      reason: "COUNTRY_NOT_RESOLVED",
      context: { accountId: "acct_1", shipmentId: "ship_1", screeningLevel: "TRANSACTION", type: "D" },
    });
    const result = await runCountryEmbargoScreening(baseInput());
    expect(result.status).toBe("ERROR");
    expect(result.errors).toHaveLength(1);
  });

  it("reports status PARTIAL when both hits and errors occur", async () => {
    doEmbargoCheck
      .mockResolvedValueOnce(hit("TRANSACTION", "D", "IR"))
      .mockResolvedValueOnce({
        result: "ERROR",
        complianceCountry: "CN",
        screenedCountry: "KP",
        screeningLevel: "LINE",
        type: "O",
        matcher: "STANDARD",
        reason: "COUNTRY_NOT_RESOLVED",
        context: { accountId: "acct_1", shipmentId: "ship_1", screeningLevel: "LINE", type: "O" },
      });
    const result = await runCountryEmbargoScreening(
      baseInput({ lineItems: [{ lineItemId: "line_1", lineNumber: 1, countryOfOrigin: "KP" }] })
    );
    expect(result.status).toBe("PARTIAL");
  });

  it("never creates an audit header when the account is not audited", async () => {
    doEmbargoCheck.mockResolvedValue(clear("TRANSACTION", "D", "IR"));
    buildEmbargoAuditContext.mockReturnValue({ audited: false, writeDetailedLines: false });
    await runCountryEmbargoScreening(baseInput());
    expect(createEmbargoUsageHeader).not.toHaveBeenCalled();
    expect(createEmbargoUsageLines).not.toHaveBeenCalled();
  });

  it("creates exactly one audit header per invocation when the account is audited", async () => {
    doEmbargoCheck.mockResolvedValue(clear("TRANSACTION", "D", "IR"));
    buildEmbargoAuditContext.mockReturnValue({ audited: true, writeDetailedLines: false });
    createEmbargoUsageHeader.mockResolvedValue("header_1");
    const result = await runCountryEmbargoScreening(baseInput());
    expect(createEmbargoUsageHeader).toHaveBeenCalledTimes(1);
    expect(createEmbargoUsageLines).not.toHaveBeenCalled();
    expect(result.audit).toEqual({ usageId: "header_1", headerCreated: true, detailedLinesCreated: 0 });
  });

  it("writes detail lines only when the audit context enables detailed lines", async () => {
    doEmbargoCheck.mockResolvedValue(clear("TRANSACTION", "D", "IR"));
    buildEmbargoAuditContext.mockReturnValue({ audited: true, writeDetailedLines: true });
    createEmbargoUsageHeader.mockResolvedValue("header_1");
    createEmbargoUsageLines.mockResolvedValue(1);
    const result = await runCountryEmbargoScreening(baseInput());
    expect(createEmbargoUsageLines).toHaveBeenCalledWith("header_1", "acct_1", expect.any(Array));
    expect(result.audit?.detailedLinesCreated).toBe(1);
  });
});
