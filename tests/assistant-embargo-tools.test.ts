import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AccountContext } from "@/lib/auth";

// screen_shipment_embargo / get_embargo_screening_details: a read/explain layer
// over the deterministic Country Embargo Screening engine's persisted evidence
// (AgentDecision.evidenceItems.countryEmbargoScreening) -- never an LLM guess,
// never a duplicate of the screening logic itself.

const dbMock = {
  shipment: { findFirst: vi.fn() },
  agentDecision: { findFirst: vi.fn() },
};
const processEvent = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/agents/pipelineOrchestrator", () => ({
  PipelineOrchestrator: { processEvent },
}));

const { getToolByName } = await import("@/modules/assistant/tools");

const screenShipmentEmbargo = getToolByName("screen_shipment_embargo")!;
const getEmbargoScreeningDetails = getToolByName("get_embargo_screening_details")!;

const ACCOUNT_A = "acct_A";
const ACCOUNT_B = "acct_B";

function ctx(overrides: Partial<AccountContext> = {}): AccountContext {
  return {
    accountId: ACCOUNT_A,
    userId: "usr_1",
    roleIds: [],
    roleNames: [],
    permissions: [],
    isPlatformAdmin: false,
    ...overrides,
  } as unknown as AccountContext;
}

function decisionWith(screening: Record<string, unknown>, createdAt = new Date("2026-08-01T00:00:00Z")) {
  return {
    id: "dec_1",
    createdAt,
    evidenceItems: { countryEmbargoScreening: screening },
  };
}

const CLEAR_SCREENING = {
  status: "CLEAR",
  hits: [],
  checks: [
    {
      result: "CLEAR",
      complianceCountry: "US",
      screenedCountry: "DE",
      screeningLevel: "TRANSACTION",
      type: "D",
      matcher: "STANDARD",
      reason: "DIRECT_COUNTRY_PAIR_CLEAR",
      context: {},
    },
  ],
  skippedChecks: [],
  errors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.shipment.findFirst.mockImplementation(async ({ where }: any) => {
    if (where.accountId !== ACCOUNT_A) return null;
    if (where.OR.some((c: any) => c.id === "ship_1" || c.shipmentNumber === "SHP-1001")) {
      return { id: "ship_1", shipmentNumber: "SHP-1001" };
    }
    return null;
  });
});

describe("screen_shipment_embargo", () => {
  it("answers 'is shipment SHP-1001 embargoed' by reusing the existing result, without rescreening", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(CLEAR_SCREENING));

    const result = (await screenShipmentEmbargo.execute(ctx(), { shipmentId: "SHP-1001" })) as any;

    expect(result.status).toBe("CLEAR");
    expect(result.rescreened).toBe(false);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("does not trigger a fresh run for an explanatory question even when forceRescreen is omitted", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(CLEAR_SCREENING));
    await screenShipmentEmbargo.execute(ctx(), { shipmentId: "ship_1" });
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("triggers a fresh Compliance Audit Agent run when forceRescreen is set and the user holds shipments.manage", async () => {
    dbMock.agentDecision.findFirst
      .mockResolvedValueOnce(decisionWith(CLEAR_SCREENING, new Date("2026-08-01T00:00:00Z")))
      .mockResolvedValueOnce(decisionWith({ ...CLEAR_SCREENING, status: "HIT" }, new Date("2026-08-14T00:00:00Z")));
    processEvent.mockResolvedValue({});

    const result = (await screenShipmentEmbargo.execute(
      ctx({ permissions: ["shipments.manage"] }),
      { shipmentId: "ship_1", forceRescreen: true }
    )) as any;

    expect(processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: "ship_1", accountId: ACCOUNT_A, triggerEvent: "RECONCILIATION_REQUESTED" })
    );
    expect(result.rescreened).toBe(true);
    expect(result.status).toBe("HIT");
  });

  it("does not rerun screening on an explicit rescreen request when the user lacks shipments.manage, and says so", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(CLEAR_SCREENING));

    const result = (await screenShipmentEmbargo.execute(ctx({ permissions: [] }), {
      shipmentId: "ship_1",
      forceRescreen: true,
    })) as any;

    expect(processEvent).not.toHaveBeenCalled();
    expect(result.rescreened).toBe(false);
    expect(result.rescreenDenied).toBe(true);
  });

  it("reports NOT_SCREENED, never a fabricated CLEAR, when nothing has been screened yet and the user cannot trigger a run", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(null);

    const result = (await screenShipmentEmbargo.execute(ctx({ permissions: [] }), { shipmentId: "ship_1" })) as any;

    expect(result.status).toBe("NOT_SCREENED");
    expect(result.screeningPerformed).toBe(false);
  });

  it("distinguishes engine ERROR from CLEAR -- never presents an error run as compliant", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(
      decisionWith({
        status: "ERROR",
        hits: [],
        checks: [],
        skippedChecks: [],
        errors: [{ code: "COUNTRY_NOT_RESOLVED", message: "TRANSACTION/D check for XX could not be completed." }],
      })
    );

    const result = (await screenShipmentEmbargo.execute(ctx(), { shipmentId: "ship_1" })) as any;

    expect(result.status).toBe("ERROR");
    expect(result.errorCount).toBe(1);
  });

  it("downgrades a CLEAR engine status to PARTIAL when checks were skipped, and discloses the skip", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(
      decisionWith({
        ...CLEAR_SCREENING,
        skippedChecks: [{ reason: "MISSING_PARTY_COUNTRY", screeningLevel: "PARTY", partyId: "le_9" }],
      })
    );

    const result = (await screenShipmentEmbargo.execute(ctx(), { shipmentId: "ship_1" })) as any;

    expect(result.engineStatus).toBe("CLEAR");
    expect(result.status).toBe("PARTIAL");
    expect(result.skippedChecks).toHaveLength(1);
  });

  it("never lets Account A retrieve Account B's shipment screening result, even supplying Account B's own shipment number", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(null); // scoped query filters out cross-tenant match
    const result = (await screenShipmentEmbargo.execute(ctx({ accountId: ACCOUNT_A }), {
      shipmentId: "SHP-OWNED-BY-B",
    })) as any;

    expect(result.error).toBe("Shipment not found.");
    expect(dbMock.agentDecision.findFirst).not.toHaveBeenCalled();
  });
});

describe("get_embargo_screening_details", () => {
  const HIT_SCREENING = {
    status: "HIT",
    hits: [
      {
        screeningLevel: "LINE",
        type: "D",
        complianceCountry: "US",
        country: "IR",
        matcher: "STANDARD",
        reason: "DIRECT_COUNTRY_PAIR_EMBARGOED",
        lineItemId: "li_1",
      },
    ],
    checks: [
      { result: "CLEAR", complianceCountry: "US", screenedCountry: "DE", screeningLevel: "TRANSACTION", type: "D", matcher: "STANDARD", context: {} },
      { result: "HIT", complianceCountry: "US", screenedCountry: "IR", screeningLevel: "LINE", type: "D", matcher: "STANDARD", context: { lineItemId: "li_1" } },
      { result: "CLEAR", complianceCountry: "US", screenedCountry: "CN", screeningLevel: "LINE", type: "O", matcher: "STANDARD", context: { lineItemId: "li_1" } },
    ],
    skippedChecks: [],
    errors: [],
  };

  it("never triggers a rescreen -- pure read over persisted evidence", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(HIT_SCREENING));
    await getEmbargoScreeningDetails.execute(ctx(), { shipmentId: "ship_1" });
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("distinguishes destination (D) from origin (O) checks", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(HIT_SCREENING));
    const result = (await getEmbargoScreeningDetails.execute(ctx(), { shipmentId: "ship_1", type: "O" })) as any;
    expect(result.matchingChecks).toHaveLength(1);
    expect(result.matchingChecks[0].screenedCountry).toBe("CN");
  });

  it("filters to a specific line item", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(HIT_SCREENING));
    const result = (await getEmbargoScreeningDetails.execute(ctx(), { shipmentId: "ship_1", lineItemId: "li_1" })) as any;
    expect(result.matchingChecks).toHaveLength(2);
  });

  it("returns passed (CLEAR) checks without inventing findings from them", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(HIT_SCREENING));
    const result = (await getEmbargoScreeningDetails.execute(ctx(), { shipmentId: "ship_1", result: "CLEAR" })) as any;
    expect(result.matchingChecks).toHaveLength(2);
    expect(result.matchingChecks.every((c: any) => c.result === "CLEAR")).toBe(true);
    expect(result.findingCount).toBe(1); // still reflects the one real hit, unaffected by this filter
  });

  it("reports audit counts (checks performed/passed/failed) distinct from finding count", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(HIT_SCREENING));
    const result = (await getEmbargoScreeningDetails.execute(ctx(), { shipmentId: "ship_1" })) as any;
    expect(result.auditSummary).toEqual({ totalChecksPerformed: 3, passed: 2, failed: 1, skipped: 0, errored: 0 });
    expect(result.findingCount).toBe(1);
  });

  it("answers 'were all parties screened' honestly when no parties were available", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(CLEAR_SCREENING));
    const result = (await getEmbargoScreeningDetails.execute(ctx(), { shipmentId: "ship_1" })) as any;
    expect(result.partiesScreenedCount).toBe(0);
    expect(result.partyScreeningNote).toMatch(/no transaction parties/i);
  });

  it("answers 'were all parties screened' honestly when parties were screened", async () => {
    const screening = {
      ...CLEAR_SCREENING,
      checks: [
        ...CLEAR_SCREENING.checks,
        { result: "CLEAR", complianceCountry: "US", screenedCountry: "DE", screeningLevel: "PARTY", type: "D", matcher: "STANDARD", context: { partyId: "le_1" } },
      ],
    };
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(screening));
    const result = (await getEmbargoScreeningDetails.execute(ctx(), { shipmentId: "ship_1" })) as any;
    expect(result.partiesScreenedCount).toBe(1);
    expect(result.partyScreeningNote).toBeNull();
  });

  it("never says SKIPPED status is 'no embargo found' -- reports SKIPPED plainly", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(
      decisionWith({ status: "SKIPPED", hits: [], checks: [], skippedChecks: [{ reason: "EMBARGO_SCREENING_DISABLED" }], errors: [] })
    );
    const result = (await getEmbargoScreeningDetails.execute(ctx(), { shipmentId: "ship_1" })) as any;
    expect(result.status).toBe("SKIPPED");
    expect(result.skippedChecks).toEqual([{ reason: "EMBARGO_SCREENING_DISABLED" }]);
  });

  it("reports screeningPerformed: false rather than fabricating a result when nothing has run yet", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(null);
    const result = (await getEmbargoScreeningDetails.execute(ctx(), { shipmentId: "ship_1" })) as any;
    expect(result.screeningPerformed).toBe(false);
  });

  it("never lets Account A retrieve Account B's shipment screening details, even supplying Account B's shipment identifier", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(null);
    const result = (await getEmbargoScreeningDetails.execute(ctx({ accountId: ACCOUNT_A }), {
      shipmentId: "ship-owned-by-B",
    })) as any;
    expect(result.error).toBe("Shipment not found.");
    expect(dbMock.agentDecision.findFirst).not.toHaveBeenCalled();
  });
});
