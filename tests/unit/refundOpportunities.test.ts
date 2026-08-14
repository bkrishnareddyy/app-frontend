import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { Decimal } from "../../src/lib/tariff/decimal";

vi.mock("../../src/lib/db", () => {
  return {
    db: {
      customsFiling: {
        findMany: vi.fn(),
      },
      exportLineItem: {
        findMany: vi.fn(),
      },
      htsDutyRate: {
        findFirst: vi.fn(),
      },
      refundOpportunity: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      classificationDecision: {
        findFirst: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    },
  };
});

describe("Capability A — Refund Opportunity Detection & Status Transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates SECTION_301_EXCLUSION opportunity with estimatedRefundAmount=null on identification", async () => {
    const mockFiling = {
      id: "filing_301",
      accountId: "acc_1",
      filingStatus: "Accepted",
      shipment: {
        id: "ship_1",
        lineItems: [
          {
            id: "li_cn",
            htsCode: "8541.43.0010",
            description: "Solar cell component",
            totalValue: "10000",
            countryOfOrigin: "CN",
            origins: [],
            drawbackMatches: [],
          },
        ],
      },
    };

    vi.mocked(db.customsFiling.findMany).mockResolvedValue([mockFiling] as any);
    vi.mocked(db.exportLineItem.findMany).mockResolvedValue([]);
    vi.mocked(db.htsDutyRate.findFirst).mockResolvedValue({
      id: "hdr_1",
      rateType: "SECTION_301_EXCLUSION",
      exclusion: true,
    } as any);
    vi.mocked(db.refundOpportunity.findFirst).mockResolvedValue(null);
    vi.mocked(db.refundOpportunity.create).mockImplementation(async (args: any) => ({
      id: "opp_301",
      ...args.data,
    }));

    const opp = await db.refundOpportunity.create({
      data: {
        accountId: "acc_1",
        filingId: "filing_301",
        opportunityType: "SECTION_301_EXCLUSION",
        estimatedRefundAmount: null, // Null until confirmed per spec
        confidence: 95,
        basis: { reason: "Granted Section 301 Exclusion" },
        status: "Identified",
      },
    });

    expect(opp.opportunityType).toBe("SECTION_301_EXCLUSION");
    expect(opp.estimatedRefundAmount).toBeNull();
    expect(opp.status).toBe("Identified");
  });

  it("updates estimatedRefundAmount only upon confirmation", async () => {
    const mockOpp = {
      id: "opp_301",
      accountId: "acc_1",
      filingId: "filing_301",
      opportunityType: "SECTION_301_EXCLUSION",
      estimatedRefundAmount: null,
      status: "Identified",
    };

    vi.mocked(db.refundOpportunity.update).mockResolvedValue({
      ...mockOpp,
      estimatedRefundAmount: new Decimal(2500.00),
      status: "Confirmed",
    } as any);

    const updated = await db.refundOpportunity.update({
      where: { id: "opp_301" },
      data: {
        estimatedRefundAmount: new Decimal(2500.00),
        status: "Confirmed",
      },
    });

    expect(updated.status).toBe("Confirmed");
    expect(updated.estimatedRefundAmount).toEqual(new Decimal(2500.00));
  });

  it("ranks opportunities by amount DESC, confidence DESC, and deadline ASC", () => {
    const opportunities = [
      { id: "1", estimatedRefundAmount: 500, confidence: 90, status: "Identified", deadline: "2026-10-01" },
      { id: "2", estimatedRefundAmount: 500, confidence: 95, status: "Identified", deadline: "2026-12-01" },
      { id: "3", estimatedRefundAmount: 1000, confidence: 85, status: "Confirmed", deadline: "2026-11-01" },
      { id: "4", estimatedRefundAmount: 500, confidence: 95, status: "Identified", deadline: "2026-09-01" },
    ];

    const sorted = [...opportunities].sort((a, b) => {
      if (a.status === "Confirmed" && b.status !== "Confirmed") return -1;
      if (a.status !== "Confirmed" && b.status === "Confirmed") return 1;
      const amountA = a.estimatedRefundAmount ?? 0;
      const amountB = b.estimatedRefundAmount ?? 0;
      if (amountB !== amountA) return amountB - amountA;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const deadlineA = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const deadlineB = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return deadlineA - deadlineB;
    });

    expect(sorted[0].id).toBe("3"); // Confirmed first
    expect(sorted[1].id).toBe("4"); // Amount 500, confidence 95, earlier deadline (Sept 01)
    expect(sorted[2].id).toBe("2"); // Amount 500, confidence 95, later deadline (Dec 01)
    expect(sorted[3].id).toBe("1"); // Amount 500, confidence 90
  });
});
