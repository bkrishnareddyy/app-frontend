import { describe, it, expect } from "vitest";
import {
  displayPercent,
  displayNumber,
  displayCurrency,
  displayText,
  averageOfKnown,
  NOT_CALCULATED,
  NOT_PROVIDED,
} from "@/lib/honest";
import {
  dataModeBannerCopy,
  isProductionWorkspace,
  requiresDataModeBanner,
  isDemoSeedingAllowedForWorkspace,
  assertDemoSeedingAllowedForWorkspace,
} from "@/lib/dataMode";
import {
  generateShipmentNumber,
  formatShipmentNumber,
} from "@/modules/shipments/shipmentNumber";

describe("Zero is never fabricated into a positive value", () => {
  it("renders a real zero readiness score as 0%", () => {
    expect(displayPercent(0)).toBe("0%");
  });

  it("renders a real zero count as 0", () => {
    expect(displayNumber(0)).toBe("0");
  });

  it("renders a real zero duty amount as $0.00, not 'not calculated'", () => {
    expect(displayCurrency(0)).toBe("$0.00");
  });

  it("distinguishes an uncalculated value from a zero value", () => {
    expect(displayPercent(null)).toBe(NOT_CALCULATED);
    expect(displayPercent(undefined)).toBe(NOT_CALCULATED);
    expect(displayNumber(null)).toBe(NOT_CALCULATED);
    expect(displayCurrency(null)).toBe(NOT_CALCULATED);
  });

  it("renders missing text as an explicit missing state", () => {
    expect(displayText(null)).toBe(NOT_PROVIDED);
    expect(displayText("")).toBe(NOT_PROVIDED);
    expect(displayText("Maersk Line")).toBe("Maersk Line");
  });

  it("never invents an average when nothing has been scored", () => {
    expect(averageOfKnown([])).toBeNull();
    expect(averageOfKnown([null, undefined])).toBeNull();
  });

  it("averages only the values that were actually calculated", () => {
    expect(averageOfKnown([100, null, 50])).toBe(75);
    // A genuine zero must pull the average down, not be skipped.
    expect(averageOfKnown([0, 100])).toBe(50);
  });
});

describe("Empty production workspace metrics", () => {
  it("reports zero for every operational KPI when there are no records", () => {
    const shipments: Array<{ status: string; readinessScore: number | null }> = [];

    expect(shipments.length).toBe(0);
    expect(shipments.filter((s) => s.status === "In Progress").length).toBe(0);
    expect(averageOfKnown(shipments.map((s) => s.readinessScore))).toBeNull();
    expect(displayPercent(averageOfKnown(shipments.map((s) => s.readinessScore)))).toBe(
      NOT_CALCULATED
    );
  });
});

describe("Workspace data mode separation", () => {
  it("treats only PRODUCTION as a production workspace", () => {
    expect(isProductionWorkspace("PRODUCTION")).toBe(true);
    expect(isProductionWorkspace("DEMO")).toBe(false);
    expect(isProductionWorkspace("SANDBOX")).toBe(false);
  });

  it("requires a visible banner for every non-production workspace", () => {
    expect(requiresDataModeBanner("PRODUCTION")).toBe(false);
    expect(requiresDataModeBanner("DEMO")).toBe(true);
    expect(requiresDataModeBanner("SANDBOX")).toBe(true);
  });

  it("provides unmistakable banner copy for demo and sandbox", () => {
    expect(dataModeBannerCopy("PRODUCTION")).toBeNull();
    expect(dataModeBannerCopy("DEMO")?.label).toBe("Demo data");
    expect(dataModeBannerCopy("SANDBOX")?.label).toBe("Sandbox");
    expect(dataModeBannerCopy("SANDBOX")?.description).toContain("never transmitted to CBP");
  });

  it("refuses to seed demo data into a production workspace", () => {
    expect(isDemoSeedingAllowedForWorkspace("PRODUCTION")).toBe(false);
    expect(isDemoSeedingAllowedForWorkspace("DEMO")).toBe(true);
    expect(() => assertDemoSeedingAllowedForWorkspace("PRODUCTION", "acct_1")).toThrow(
      /SECURITY_VIOLATION/
    );
    expect(() => assertDemoSeedingAllowedForWorkspace("DEMO", "acct_1")).not.toThrow();
  });
});

describe("Shipment numbering is concurrency safe", () => {
  /** Stand-in for the atomic upsert-with-increment the database performs. */
  function createSequenceStore() {
    const rows = new Map<string, number>();
    return {
      shipmentSequence: {
        async upsert(args: {
          where: { accountId_year: { accountId: string; year: number } };
          create: { accountId: string; year: number; lastValue: number };
          update: { lastValue: { increment: number } };
          select: { lastValue: true };
        }) {
          const { accountId, year } = args.where.accountId_year;
          const key = `${accountId}:${year}`;
          const next = (rows.get(key) ?? 0) + args.update.lastValue.increment;
          rows.set(key, next);
          return { lastValue: next };
        },
      },
    };
  }

  it("does not hardcode the year", () => {
    expect(formatShipmentNumber(2031, 7)).toBe("SHP-2031-000007");
    expect(formatShipmentNumber(2026, 1)).toBe("SHP-2026-000001");
  });

  it("never issues a duplicate number under concurrent creates", async () => {
    const store = createSequenceStore();
    const now = new Date("2027-03-04T00:00:00Z");

    const numbers = await Promise.all(
      Array.from({ length: 100 }, () => generateShipmentNumber(store, "acct_a", now))
    );

    expect(new Set(numbers).size).toBe(100);
    expect(numbers).toContain("SHP-2027-000001");
    expect(numbers).toContain("SHP-2027-000100");
  });

  it("keeps sequences isolated per account", async () => {
    const store = createSequenceStore();
    const now = new Date("2027-03-04T00:00:00Z");

    const a = await generateShipmentNumber(store, "acct_a", now);
    const b = await generateShipmentNumber(store, "acct_b", now);

    expect(a).toBe("SHP-2027-000001");
    expect(b).toBe("SHP-2027-000001");
  });
});
