import { describe, it, expect, vi, beforeEach } from "vitest";

// Country Embargo Screening: doEmbargoCheck.ts matcher precedence
// (CountryEmbargoScreening_Prompt.md section 16/19/25-28):
//   PRIVATE (falls through when SKIPPED) -> US -> GENERIC -> STANDARD.

const privateEmbargoMatcher = vi.fn();
const usEmbargoMatcher = vi.fn();
const genericEmbargoMatcher = vi.fn();
const standardEmbargoMatcher = vi.fn();

vi.mock("@/modules/agents/compliance/embargo/privateEmbargoMatcher", () => ({ privateEmbargoMatcher }));
vi.mock("@/modules/agents/compliance/embargo/usEmbargoMatcher", () => ({ usEmbargoMatcher }));
vi.mock("@/modules/agents/compliance/embargo/genericEmbargoMatcher", () => ({ genericEmbargoMatcher }));
vi.mock("@/modules/agents/compliance/embargo/standardEmbargoMatcher", () => ({ standardEmbargoMatcher }));

const { doEmbargoCheck } = await import("@/modules/agents/compliance/embargo/doEmbargoCheck");

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    shipmentId: "ship_1",
    screeningLevel: "TRANSACTION",
    complianceCountry: "CN",
    targetCountry: "IR",
    type: "D",
    screeningDate: new Date("2026-01-01"),
    accountConfig: {
      embargoScreeningEnabled: true,
      privateEmbargoEnabled: false,
      serverScreeningEnabled: true,
      genericExportLdEnabled: false,
      audited: false,
      emailAlertEnabled: false,
      generalAuditLogEnabled: false,
    },
    ...overrides,
  } as Parameters<typeof doEmbargoCheck>[0];
}

const clearResult = (matcher: string) => ({
  result: "CLEAR",
  complianceCountry: "CN",
  screenedCountry: "IR",
  screeningLevel: "TRANSACTION",
  type: "D",
  matcher,
  context: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  usEmbargoMatcher.mockResolvedValue(clearResult("US"));
  genericEmbargoMatcher.mockResolvedValue(clearResult("GENERIC"));
  standardEmbargoMatcher.mockResolvedValue(clearResult("STANDARD"));
});

describe("doEmbargoCheck precedence", () => {
  it("routes to the US matcher when the compliance country is US, bypassing generic/standard", async () => {
    const ctx = baseCtx({ complianceCountry: "US" });
    const result = await doEmbargoCheck(ctx);
    expect(usEmbargoMatcher).toHaveBeenCalledWith(ctx);
    expect(genericEmbargoMatcher).not.toHaveBeenCalled();
    expect(standardEmbargoMatcher).not.toHaveBeenCalled();
    expect(result.matcher).toBe("US");
  });

  it("also routes 'USA' compliance country to the US matcher", async () => {
    const ctx = baseCtx({ complianceCountry: "usa" });
    await doEmbargoCheck(ctx);
    expect(usEmbargoMatcher).toHaveBeenCalledWith(ctx);
  });

  it("routes to the generic matcher when server/generic screening is enabled and compliance country is not US", async () => {
    const ctx = baseCtx({ accountConfig: { ...baseCtx().accountConfig, serverScreeningEnabled: true } });
    const result = await doEmbargoCheck(ctx);
    expect(genericEmbargoMatcher).toHaveBeenCalledWith(ctx);
    expect(standardEmbargoMatcher).not.toHaveBeenCalled();
    expect(result.matcher).toBe("GENERIC");
  });

  it("falls back to the standard matcher when neither US nor generic/server screening applies", async () => {
    const ctx = baseCtx({
      accountConfig: { ...baseCtx().accountConfig, serverScreeningEnabled: false, genericExportLdEnabled: false },
    });
    const result = await doEmbargoCheck(ctx);
    expect(standardEmbargoMatcher).toHaveBeenCalledWith(ctx);
    expect(genericEmbargoMatcher).not.toHaveBeenCalled();
    expect(result.matcher).toBe("STANDARD");
  });

  it("tries the private matcher first when enabled, and short-circuits on a non-SKIPPED result", async () => {
    privateEmbargoMatcher.mockResolvedValue({
      result: "HIT",
      complianceCountry: "CN",
      screenedCountry: "IR",
      screeningLevel: "TRANSACTION",
      type: "D",
      matcher: "PRIVATE",
      context: {},
    });
    const ctx = baseCtx({ accountConfig: { ...baseCtx().accountConfig, privateEmbargoEnabled: true } });
    const result = await doEmbargoCheck(ctx);
    expect(privateEmbargoMatcher).toHaveBeenCalledWith(ctx);
    expect(usEmbargoMatcher).not.toHaveBeenCalled();
    expect(genericEmbargoMatcher).not.toHaveBeenCalled();
    expect(standardEmbargoMatcher).not.toHaveBeenCalled();
    expect(result.matcher).toBe("PRIVATE");
  });

  it("falls through to the next matcher when the private matcher reports SKIPPED", async () => {
    privateEmbargoMatcher.mockResolvedValue({
      result: "SKIPPED",
      complianceCountry: "CN",
      screenedCountry: "IR",
      screeningLevel: "TRANSACTION",
      type: "D",
      matcher: "PRIVATE",
      reason: "PRIVATE_EMBARGO_RULES_UNAVAILABLE",
      context: {},
    });
    const ctx = baseCtx({ accountConfig: { ...baseCtx().accountConfig, privateEmbargoEnabled: true } });
    const result = await doEmbargoCheck(ctx);
    expect(privateEmbargoMatcher).toHaveBeenCalledWith(ctx);
    expect(genericEmbargoMatcher).toHaveBeenCalledWith(ctx);
    expect(result.matcher).toBe("GENERIC");
  });
});
