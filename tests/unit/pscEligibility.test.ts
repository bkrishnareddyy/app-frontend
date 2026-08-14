import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkPscEligibility } from "../../src/lib/refunds/pscEligibility";
import { db } from "../../src/lib/db";
import { Decimal } from "../../src/lib/tariff/decimal";

vi.mock("../../src/lib/db", () => {
  return {
    db: {
      customsFiling: {
        findFirst: vi.fn(),
      },
    },
  };
});

describe("Capability D — Post-Summary Correction (PSC) Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves PSC eligibility for Accepted filing with positive duty paid and open window", async () => {
    const mockFiling = {
      id: "filing_accepted",
      filingStatus: "Accepted",
      totalDuties: new Decimal(1200.50),
      shipment: {
        lineItems: [{ id: "li_1", drawbackMatches: [] }],
        complianceDeadlines: [
          { type: "PSC_WINDOW", dueAt: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000) },
        ],
      },
    };

    vi.mocked(db.customsFiling.findFirst).mockResolvedValue(mockFiling as any);

    const result = await checkPscEligibility("acc_1", "filing_accepted");
    expect(result.eligible).toBe(true);
    expect(result.reason).toContain("fully eligible");
  });

  it("denies PSC eligibility when PSC_WINDOW compliance deadline has expired", async () => {
    const mockFiling = {
      id: "filing_expired",
      filingStatus: "Accepted",
      totalDuties: new Decimal(1200.50),
      shipment: {
        lineItems: [{ id: "li_1", drawbackMatches: [] }],
        complianceDeadlines: [
          { type: "PSC_WINDOW", dueAt: new Date("2020-01-01") }, // Past date
        ],
      },
    };

    vi.mocked(db.customsFiling.findFirst).mockResolvedValue(mockFiling as any);

    const result = await checkPscEligibility("acc_1", "filing_expired");
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("denies PSC eligibility when line items have active drawback claims", async () => {
    const mockFiling = {
      id: "filing_drawback",
      filingStatus: "Accepted",
      totalDuties: new Decimal(1200.50),
      shipment: {
        lineItems: [{ id: "li_1", drawbackMatches: [{ id: "match_1" }] }],
        complianceDeadlines: [],
      },
    };

    vi.mocked(db.customsFiling.findFirst).mockResolvedValue(mockFiling as any);

    const result = await checkPscEligibility("acc_1", "filing_drawback");
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("active drawback claims");
  });

  it("calculates Decimal duty impact accurately (original vs corrected)", () => {
    const originalDuty = new Decimal(1500.75);
    const correctedDuty = new Decimal(500.25);
    const refundAmount = Decimal.max(0, originalDuty.minus(correctedDuty));

    expect(refundAmount.toNumber()).toBe(1000.50);
  });
});
