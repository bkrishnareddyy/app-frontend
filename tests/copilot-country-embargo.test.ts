import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@/lib/auth";
import { CopilotLedger } from "@/modules/copilot/copilotLedger";

const getAccountEmbargoConfig = vi.fn();
const doEmbargoCheck = vi.fn();

vi.mock("@/modules/agents/compliance/embargo/embargoRepository", () => ({
  getAccountEmbargoConfig,
}));
vi.mock("@/modules/agents/compliance/embargo/doEmbargoCheck", () => ({
  doEmbargoCheck,
}));

const { getCountryEmbargoScreeningTool } = await import(
  "@/modules/copilot/tools/complianceTools"
);
const { COPILOT_TOOL_NAMES } = await import("@/modules/copilot/copilotTools");
const {
  COPILOT_PROMPT_VERSION,
  buildCopilotSystemPrompt,
} = await import("@/modules/copilot/prompts/copilotSystemPrompt");

const enabledConfig = {
  embargoScreeningEnabled: true,
  privateEmbargoEnabled: false,
  serverScreeningEnabled: true,
  genericExportLdEnabled: false,
  audited: false,
  emailAlertEnabled: false,
  generalAuditLogEnabled: false,
};

function runContext() {
  const context = {
    accountId: "acct_1",
    userId: "user_1",
    permissions: [],
    roleIds: [],
    roleNames: [],
    isPlatformAdmin: false,
  } as unknown as AccountContext;

  return {
    actor: {
      accountId: context.accountId,
      userId: context.userId,
      requestId: "request_1",
      context,
    },
    ledger: new CopilotLedger(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccountEmbargoConfig.mockResolvedValue(enabledConfig);
});

describe("Copilot country-pair embargo screening", () => {
  it("screens US to Iran without searching for a shipment", async () => {
    doEmbargoCheck.mockResolvedValue({
      result: "HIT",
      complianceCountry: "US",
      screenedCountry: "IR",
      screeningLevel: "TRANSACTION",
      type: "D",
      matcher: "US",
      reason: "DIRECT_COUNTRY_PAIR_EMBARGOED",
      ruleId: "rule_ir",
      evidence: { nationalSanction: true, euSanction: false, unSanction: false },
      context: {},
    });

    const result = await getCountryEmbargoScreeningTool.execute(
      runContext(),
      {
        shipFromCountry: "US",
        shipToCountry: "Iran",
      } as never
    ) as { ok: true; data: Record<string, unknown> };

    expect(doEmbargoCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct_1",
        complianceCountry: "US",
        targetCountry: "Iran",
        screeningLevel: "TRANSACTION",
        type: "D",
      })
    );
    expect(result.data).toMatchObject({
      status: "HIT",
      screeningPerformed: true,
      isEmbargoed: true,
      shipFromCountry: "US",
      shipToCountry: "IR",
      scope: "COUNTRY_PAIR_ONLY",
    });
    expect(JSON.stringify(result.data)).not.toContain("shipmentId");
  });

  it("reports disabled screening as SKIPPED, never CLEAR", async () => {
    getAccountEmbargoConfig.mockResolvedValue({
      ...enabledConfig,
      embargoScreeningEnabled: false,
    });

    const result = await getCountryEmbargoScreeningTool.execute(
      runContext(),
      {
        shipFromCountry: "US",
        shipToCountry: "Iran",
      } as never
    ) as { ok: true; data: Record<string, unknown> };

    expect(result.data).toMatchObject({
      status: "SKIPPED",
      screeningPerformed: false,
      isEmbargoed: null,
    });
    expect(doEmbargoCheck).not.toHaveBeenCalled();
  });

  it("registers and explicitly routes country-pair requests to the embargo tool", () => {
    expect(COPILOT_TOOL_NAMES).toContain("getCountryEmbargoScreening");

    const prompt = buildCopilotSystemPrompt({ resolvedContext: null, today: "2026-08-15" });
    expect(prompt).toContain("call getCountryEmbargoScreening");
    expect(prompt).toContain("Do not call searchShipments");
    expect(COPILOT_PROMPT_VERSION).toBe("2026-08-15.1");
  });
});
