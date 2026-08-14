import { describe, expect, it, vi, beforeEach } from "vitest";
import { computeAnalyticsMetrics } from "@/lib/analytics/metricComputer";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    customsFiling: {
      findMany: vi.fn(),
    },
    exceptionItem: {
      findMany: vi.fn(),
    },
    extractionField: {
      findMany: vi.fn(),
    },
    postSummaryCorrection: {
      count: vi.fn(),
    },
  },
}));

describe("computeAnalyticsMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros and 100% first pass rate for empty database records", async () => {
    vi.mocked(db.customsFiling.findMany).mockResolvedValue([]);
    vi.mocked(db.exceptionItem.findMany).mockResolvedValue([]);
    vi.mocked(db.extractionField.findMany).mockResolvedValue([]);
    vi.mocked(db.postSummaryCorrection.count).mockResolvedValue(0);

    const metrics = await computeAnalyticsMetrics("acc-123");

    expect(metrics).toEqual({
      cyclTimeMedianHours: 0,
      firstPassRate: 100,
      exceptionAgeAvgHours: 0,
      exceptionAgeBuckets: { under24h: 0, days1to7: 0, days7to30: 0, over30d: 0 },
      touchRate: 0,
      dutyPerEntry: 0,
      openExceptions: 0,
      filedEntries: 0,
      pscCount: 0,
    });
  });

  it("calculates median cycle time, first pass rate, and duty per entry correctly", async () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    // Mock terminal filings
    vi.mocked(db.customsFiling.findMany)
      .mockResolvedValueOnce([
        {
          id: "f1",
          updatedAt: now,
          totalDuties: "100.50",
          shipment: { createdAt: twoHoursAgo },
        } as any,
        {
          id: "f2",
          updatedAt: now,
          totalDuties: "300.50",
          shipment: { createdAt: fourHoursAgo },
        } as any,
      ])
      // Mock submitted filings for first pass rate
      .mockResolvedValueOnce([
        { id: "f1", responses: [] } as any,
        { id: "f2", responses: [{ status: "REJECTED" }] } as any,
      ])
      // Mock terminal filings with value for dutyPerEntry
      .mockResolvedValueOnce([
        { id: "f1", totalDuties: "100.50" } as any,
        { id: "f2", totalDuties: "300.50" } as any,
      ]);

    vi.mocked(db.exceptionItem.findMany).mockResolvedValue([
      { id: "ex1", createdAt: twoHoursAgo } as any,
    ]);

    vi.mocked(db.extractionField.findMany).mockResolvedValue([
      { id: "ef1", source: "OCR" } as any,
      { id: "ef2", source: "HUMAN_CORRECTION" } as any,
    ]);

    vi.mocked(db.postSummaryCorrection.count).mockResolvedValue(2);

    const metrics = await computeAnalyticsMetrics("acc-123");

    expect(metrics.cyclTimeMedianHours).toBe(3); // (2h + 4h) / 2 = 3h
    expect(metrics.firstPassRate).toBe(50); // 1 of 2 had no rejection
    expect(metrics.touchRate).toBe(50); // 1 of 2 fields human corrected
    expect(metrics.dutyPerEntry).toBe(200.5); // (100.50 + 300.50) / 2 = 200.5
    expect(metrics.openExceptions).toBe(1);
    expect(metrics.filedEntries).toBe(2);
    expect(metrics.pscCount).toBe(2);
  });
});
