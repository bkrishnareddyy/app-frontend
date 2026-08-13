import { describe, it, expect } from "vitest";
import {
  computeDeadlines,
  missingAnchors,
  addCalendarDays,
  addWorkingDays,
  addHours,
  subtractHours,
  type DeadlineContext,
} from "@/modules/deadlines/deadlineRules";
import { DeadlineType, DeadlineAnchor } from "@prisma/client";

// ── Helpers ────────────────────────────────────────────────────────────────

function ctx(overrides: Partial<DeadlineContext> = {}): DeadlineContext {
  return {
    transportMode: "Ocean",
    ladingDate: null,
    arrivalDate: null,
    estimatedArrival: null,
    releaseDate: null,
    paymentMethod: null,
    ...overrides,
  };
}

function utc(iso: string): Date {
  return new Date(iso);
}

/** Number of ms difference, rounded to nearest minute (avoids DST micro-diffs). */
function hoursDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 3_600_000);
}

// ── Working-day math ──────────────────────────────────────────────────────

describe("addWorkingDays", () => {
  it("skips Saturday and Sunday", () => {
    // 2026-01-09 is a Friday
    const fri = utc("2026-01-09T12:00:00Z");
    const result = addWorkingDays(fri, 1);
    // Next working day is Monday 2026-01-12
    expect(result.toISOString().slice(0, 10)).toBe("2026-01-12");
  });

  it("skips a federal holiday mid-week (MLK Day, 3rd Mon Jan)", () => {
    // 2026-01-19 is Martin Luther King Jr. Day
    const fri = utc("2026-01-16T12:00:00Z"); // Friday before MLK
    const result = addWorkingDays(fri, 1);
    // Mon Jan 19 is a holiday → skip to Tue Jan 20
    expect(result.toISOString().slice(0, 10)).toBe("2026-01-20");
  });

  it("handles 10 working days across a holiday week (Thanksgiving)", () => {
    // 2026-11-23 is the Monday before Thanksgiving (Thu Nov 26)
    // 1=Nov24, 2=Nov25, [Nov26 Thanksgiving→skip], 3=Nov27, [weekend],
    // 4=Nov30, 5=Dec1, 6=Dec2, 7=Dec3, 8=Dec4, [weekend], 9=Dec7, 10=Dec8
    const anchor = utc("2026-11-23T12:00:00Z");
    const result = addWorkingDays(anchor, 10);
    expect(result.toISOString().slice(0, 10)).toBe("2026-12-08");
  });

  it("handles 10 working days across a year boundary (New Year's)", () => {
    // 2026-12-18 (Friday) + 10 working days
    // Dec 21 Mon, Dec 22 Tue, Dec 23 Wed, Dec 24 Thu, Dec 25 Fri (Christmas) →skip
    // Dec 28 Mon, Dec 29 Tue, Dec 30 Wed, Dec 31 Thu, Jan 1 Fri (New Year) →skip
    // Jan 4 Mon (10th), Jan 5 Tue... wait let me count more carefully.
    // After Dec 18 (anchor), add:
    // 1=Dec21, 2=Dec22, 3=Dec23, 4=Dec24, [Dec25 holiday], 5=Dec28, 6=Dec29, 7=Dec30, 8=Dec31, [Jan1 holiday], 9=Jan4, 10=Jan5
    const anchor = utc("2026-12-18T12:00:00Z");
    const result = addWorkingDays(anchor, 10);
    expect(result.toISOString().slice(0, 10)).toBe("2027-01-05");
  });

  it("addCalendarDays does not skip weekends or holidays", () => {
    // 15 calendar days after 2026-01-01 is 2026-01-16
    const anchor = utc("2026-01-01T12:00:00Z");
    const result = addCalendarDays(anchor, 15);
    expect(result.toISOString().slice(0, 10)).toBe("2026-01-16");
  });
});

describe("DST transitions", () => {
  it("addCalendarDays gives correct day count over spring-forward (Mar 8, 2026)", () => {
    // DST springs forward 2026-03-08 at 2am ET. 5 calendar days after Mar 6 should be Mar 11.
    const anchor = utc("2026-03-06T17:00:00Z"); // noon ET
    const result = addCalendarDays(anchor, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-03-11");
  });

  it("addCalendarDays gives correct day count over fall-back (Nov 1, 2026)", () => {
    // DST falls back 2026-11-01. 5 calendar days after Oct 29 should be Nov 3.
    const anchor = utc("2026-10-29T17:00:00Z");
    const result = addCalendarDays(anchor, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-11-03");
  });

  it("addWorkingDays gives correct count over spring-forward", () => {
    // 5 working days from Wed Mar 4 (skipping weekend) = Thu Mar 12
    // Mar 4 → 1=Mar5, 2=Mar6, 3=Mar9, 4=Mar10, 5=Mar11... wait DST is Mar 8 (Sun)
    // Working days: Mar 5 Thu(1), Mar 6 Fri(2), [weekend], Mar 9 Mon(3), Mar 10 Tue(4), Mar 11 Wed(5)
    const anchor = utc("2026-03-04T17:00:00Z");
    const result = addWorkingDays(anchor, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-03-11");
  });
});

// ── ISF rule ──────────────────────────────────────────────────────────────

describe("ISF_10_2 rule", () => {
  const ladingDate = utc("2026-03-10T14:00:00Z"); // 14:00 UTC = 10:00 ET

  it("computes dueAt as 24h before lading", () => {
    const deadlines = computeDeadlines(ctx({ ladingDate, transportMode: "Ocean" }));
    const isf = deadlines.find((d) => d.type === DeadlineType.ISF_10_2);
    expect(isf).toBeDefined();
    expect(hoursDiff(isf!.dueAt, ladingDate)).toBe(24);
  });

  it("is not estimated when lading date is a confirmed date", () => {
    const deadlines = computeDeadlines(ctx({ ladingDate, transportMode: "Ocean" }));
    const isf = deadlines.find((d) => d.type === DeadlineType.ISF_10_2);
    expect(isf!.estimated).toBe(false);
  });

  it("does NOT apply to Air shipments", () => {
    const deadlines = computeDeadlines(ctx({ ladingDate, transportMode: "Air" }));
    const isf = deadlines.find((d) => d.type === DeadlineType.ISF_10_2);
    expect(isf).toBeUndefined();
  });

  it("does NOT apply to Truck shipments", () => {
    const deadlines = computeDeadlines(ctx({ ladingDate, transportMode: "Truck" }));
    const isf = deadlines.find((d) => d.type === DeadlineType.ISF_10_2);
    expect(isf).toBeUndefined();
  });

  it("applies when transportMode is null (default ocean assumption)", () => {
    const deadlines = computeDeadlines(ctx({ ladingDate, transportMode: null }));
    const isf = deadlines.find((d) => d.type === DeadlineType.ISF_10_2);
    expect(isf).toBeDefined();
  });

  it("emits no deadline when lading date is missing", () => {
    const deadlines = computeDeadlines(ctx({ transportMode: "Ocean" }));
    const isf = deadlines.find((d) => d.type === DeadlineType.ISF_10_2);
    expect(isf).toBeUndefined();
  });

  it("cites the correct CFR section", () => {
    const deadlines = computeDeadlines(ctx({ ladingDate, transportMode: "Ocean" }));
    const isf = deadlines.find((d) => d.type === DeadlineType.ISF_10_2);
    expect(isf!.citation).toBe("19 CFR 149.2(a)");
  });

  it("carries the penalty amount", () => {
    const deadlines = computeDeadlines(ctx({ ladingDate, transportMode: "Ocean" }));
    const isf = deadlines.find((d) => d.type === DeadlineType.ISF_10_2);
    expect(isf!.penaltyMax).toBe(5_000);
  });
});

// ── Entry filing rule ─────────────────────────────────────────────────────

describe("ENTRY_FILING rule", () => {
  it("computes dueAt as 15 calendar days after actual arrival", () => {
    const arrivalDate = utc("2026-04-01T12:00:00Z");
    const deadlines = computeDeadlines(ctx({ arrivalDate }));
    const ef = deadlines.find((d) => d.type === DeadlineType.ENTRY_FILING);
    expect(ef).toBeDefined();
    expect(ef!.dueAt.toISOString().slice(0, 10)).toBe("2026-04-16");
    expect(ef!.estimated).toBe(false);
  });

  it("falls back to estimatedArrival and marks estimated=true", () => {
    const estimatedArrival = utc("2026-04-01T12:00:00Z");
    const deadlines = computeDeadlines(ctx({ estimatedArrival }));
    const ef = deadlines.find((d) => d.type === DeadlineType.ENTRY_FILING);
    expect(ef).toBeDefined();
    expect(ef!.estimated).toBe(true);
  });

  it("emits no deadline when neither arrivalDate nor estimatedArrival is set", () => {
    const deadlines = computeDeadlines(ctx({}));
    const ef = deadlines.find((d) => d.type === DeadlineType.ENTRY_FILING);
    expect(ef).toBeUndefined();
  });

  it("prefers actual arrivalDate over estimatedArrival", () => {
    const arrivalDate = utc("2026-04-01T12:00:00Z");
    const estimatedArrival = utc("2026-04-10T12:00:00Z");
    const deadlines = computeDeadlines(ctx({ arrivalDate, estimatedArrival }));
    const ef = deadlines.find((d) => d.type === DeadlineType.ENTRY_FILING);
    expect(ef!.anchorAt).toEqual(arrivalDate);
    expect(ef!.estimated).toBe(false);
  });

  it("cites 19 CFR 141.68(a)", () => {
    const arrivalDate = utc("2026-04-01T12:00:00Z");
    const deadlines = computeDeadlines(ctx({ arrivalDate }));
    const ef = deadlines.find((d) => d.type === DeadlineType.ENTRY_FILING);
    expect(ef!.citation).toBe("19 CFR 141.68(a)");
  });
});

// ── Entry summary rule ────────────────────────────────────────────────────

describe("ENTRY_SUMMARY rule", () => {
  const releaseDate = utc("2026-04-06T12:00:00Z"); // Monday

  it("computes dueAt as 10 working days after release", () => {
    const deadlines = computeDeadlines(ctx({ releaseDate }));
    const es = deadlines.find((d) => d.type === DeadlineType.ENTRY_SUMMARY);
    expect(es).toBeDefined();
    // 10 working days after Mon Apr 6: Apr7,8,9,10,13,14,15,16,17,20 = Apr 20
    expect(es!.dueAt.toISOString().slice(0, 10)).toBe("2026-04-20");
  });

  it("is skipped when paymentMethod is PMS", () => {
    const deadlines = computeDeadlines(ctx({ releaseDate, paymentMethod: "PMS" }));
    const es = deadlines.find((d) => d.type === DeadlineType.ENTRY_SUMMARY);
    expect(es).toBeUndefined();
  });

  it("emits no deadline when release date is missing", () => {
    const deadlines = computeDeadlines(ctx({}));
    const es = deadlines.find((d) => d.type === DeadlineType.ENTRY_SUMMARY);
    expect(es).toBeUndefined();
  });
});

// ── Duty payment rule ─────────────────────────────────────────────────────

describe("DUTY_PAYMENT rule", () => {
  const releaseDate = utc("2026-04-06T12:00:00Z");

  it("computes dueAt alongside entry summary (10 working days after release)", () => {
    const deadlines = computeDeadlines(ctx({ releaseDate }));
    const dp = deadlines.find((d) => d.type === DeadlineType.DUTY_PAYMENT);
    const es = deadlines.find((d) => d.type === DeadlineType.ENTRY_SUMMARY);
    expect(dp).toBeDefined();
    expect(dp!.dueAt.toISOString().slice(0, 10)).toBe(es!.dueAt.toISOString().slice(0, 10));
  });

  it("is skipped for PMS accounts", () => {
    const deadlines = computeDeadlines(ctx({ releaseDate, paymentMethod: "PMS" }));
    const dp = deadlines.find((d) => d.type === DeadlineType.DUTY_PAYMENT);
    expect(dp).toBeUndefined();
  });
});

// ── missingAnchors ────────────────────────────────────────────────────────

describe("missingAnchors", () => {
  it("reports ISF missing when no ladingDate and mode is ocean", () => {
    const missing = missingAnchors(ctx({ transportMode: "Ocean" }));
    expect(missing.some((m) => m.type === DeadlineType.ISF_10_2 && m.missingAnchor === DeadlineAnchor.LADING)).toBe(true);
  });

  it("does not report ISF as missing for Air", () => {
    const missing = missingAnchors(ctx({ transportMode: "Air" }));
    expect(missing.some((m) => m.type === DeadlineType.ISF_10_2)).toBe(false);
  });

  it("reports entry filing missing when no arrival date at all", () => {
    const missing = missingAnchors(ctx({}));
    expect(missing.some((m) => m.type === DeadlineType.ENTRY_FILING)).toBe(true);
  });

  it("does NOT report entry filing missing when estimatedArrival is present", () => {
    const missing = missingAnchors(ctx({ estimatedArrival: utc("2026-04-01T12:00:00Z") }));
    expect(missing.some((m) => m.type === DeadlineType.ENTRY_FILING)).toBe(false);
  });

  it("returns empty when all anchors are present", () => {
    const missing = missingAnchors(
      ctx({
        transportMode: "Ocean",
        ladingDate: utc("2026-03-10T14:00:00Z"),
        arrivalDate: utc("2026-04-01T12:00:00Z"),
        releaseDate: utc("2026-04-06T12:00:00Z"),
      })
    );
    expect(missing).toHaveLength(0);
  });
});

// ── Full context smoke test ───────────────────────────────────────────────

describe("computeDeadlines full ocean shipment", () => {
  it("returns all four v1 deadlines for a complete ocean shipment", () => {
    const deadlines = computeDeadlines(
      ctx({
        transportMode: "Ocean",
        ladingDate: utc("2026-03-10T14:00:00Z"),
        arrivalDate: utc("2026-04-01T12:00:00Z"),
        releaseDate: utc("2026-04-06T12:00:00Z"),
        paymentMethod: null,
      })
    );
    const types = deadlines.map((d) => d.type);
    expect(types).toContain(DeadlineType.ISF_10_2);
    expect(types).toContain(DeadlineType.ENTRY_FILING);
    expect(types).toContain(DeadlineType.ENTRY_SUMMARY);
    expect(types).toContain(DeadlineType.DUTY_PAYMENT);
  });

  it("returns two deadlines for Air when release date is known", () => {
    const deadlines = computeDeadlines(
      ctx({
        transportMode: "Air",
        arrivalDate: utc("2026-04-01T12:00:00Z"),
        releaseDate: utc("2026-04-06T12:00:00Z"),
      })
    );
    const types = deadlines.map((d) => d.type);
    expect(types).not.toContain(DeadlineType.ISF_10_2);
    expect(types).toContain(DeadlineType.ENTRY_FILING);
    expect(types).toContain(DeadlineType.ENTRY_SUMMARY);
  });
});
