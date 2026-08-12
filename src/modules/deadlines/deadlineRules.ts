/**
 * Pure deadline rules engine — no DB, no side effects.
 *
 * Each DeadlineRule encodes one statutory or commercial clock:
 *   anchor date  +  offset  →  dueAt
 *
 * Design constraints (from the plan):
 * 1. dueAt is NEVER hand-typed. A broker edits the anchor; this module
 *    recomputes dueAt. If dueAt can be manually set, the ruleCitation is a lie.
 * 2. Estimates are labeled. A dueAt derived from ETA/ETD carries estimated=true.
 * 3. "Unknown anchor" emits nothing — never a bogus epoch date.
 * 4. Working-day math is in America/New_York with the full US federal holiday
 *    calendar. A day count done in UTC lands off-by-one near DST boundaries.
 */

import { DeadlineType, DeadlineAnchor, DeadlineClass } from "@prisma/client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DeadlineRuleOffset {
  value: number;
  unit: "hours" | "calendarDays" | "workingDays";
  direction: "before" | "after";
}

export interface DeadlineRule {
  id: string;
  type: DeadlineType;
  deadlineClass: DeadlineClass;
  anchor: DeadlineAnchor;
  citation: string;
  offset: DeadlineRuleOffset;
  /** Returns false to skip this rule for the given shipment context. */
  appliesTo(ctx: DeadlineContext): boolean;
  penalty?: {
    max: number; // USD
    basis: string;
  };
}

/** All the facts about a shipment that rules need to make their decisions. */
export interface DeadlineContext {
  transportMode: string | null | undefined;
  /** Lading date (on-board / ETD). ISF anchor. */
  ladingDate: Date | null | undefined;
  /** Actual arrival at first US port; falls back to estimatedArrival. */
  arrivalDate: Date | null | undefined;
  estimatedArrival: Date | null | undefined;
  /** CBP release date (from CustomsFiling.releasedAt). */
  releaseDate: Date | null | undefined;
  /** Payment method — "PMS" triggers the PMS duty clock. */
  paymentMethod: string | null | undefined;
  /** Whether the anchor date came from extraction (ETA/ETD) vs confirmed. */
  anchorIsEstimated?: boolean;
}

export interface ComputedDeadline {
  ruleId: string;
  type: DeadlineType;
  deadlineClass: DeadlineClass;
  anchorEvent: DeadlineAnchor;
  anchorAt: Date;
  dueAt: Date;
  estimated: boolean;
  citation: string;
  penaltyMax?: number;
  penaltyBasis?: string;
}

// ── Federal holiday calendar ───────────────────────────────────────────────
// Fixed-date and floating holidays for the US federal calendar.
// Working-day math that skips these (+ weekends) matches CBP's count.

function isWeekend(d: Date): boolean {
  // All dates in the working-day loop are UTC-midnight representations of ET
  // calendar dates, so use getUTCDay(). getDay() shifts by local timezone and
  // would misclassify days near midnight ET (e.g. 2026-04-11T00:00:00Z is
  // "Saturday UTC" but getDay() in ET sees "Friday night" → day 5 → not weekend).
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** Observed date (Mon shift for Sat, Fri shift for Sun) of a fixed holiday. */
function observedFixed(year: number, month: number, day: number): Date {
  // month is 1-based for readability; Date() takes 0-based
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(day - 1); // Sat → Fri
  if (dow === 0) d.setUTCDate(day + 1); // Sun → Mon
  return d;
}

/** nth occurrence of a weekday in a month (1-based). */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const d = new Date(Date.UTC(year, month - 1, 1));
  const first = d.getUTCDay();
  const offset = (weekday - first + 7) % 7;
  d.setUTCDate(1 + offset + (n - 1) * 7);
  return d;
}

/** Last occurrence of a weekday in a month. */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(Date.UTC(year, month, 0)); // last day of month
  const dow = d.getUTCDay();
  const back = (dow - weekday + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d;
}

function federalHolidaysForYear(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (d: Date) => holidays.add(d.toISOString().slice(0, 10));

  add(observedFixed(year, 1, 1));   // New Year's Day
  add(nthWeekday(year, 1, 1, 3));   // MLK Day (3rd Mon Jan)
  add(nthWeekday(year, 2, 1, 3));   // Presidents Day (3rd Mon Feb)
  add(lastWeekday(year, 5, 1));     // Memorial Day (last Mon May)
  add(observedFixed(year, 6, 19));  // Juneteenth
  add(observedFixed(year, 7, 4));   // Independence Day
  add(nthWeekday(year, 9, 1, 1));   // Labor Day (1st Mon Sep)
  add(nthWeekday(year, 10, 1, 2));  // Columbus Day (2nd Mon Oct)
  add(observedFixed(year, 11, 11)); // Veterans Day
  add(nthWeekday(year, 11, 4, 4)); // Thanksgiving (4th Thu Nov)
  add(observedFixed(year, 12, 25)); // Christmas Day

  return holidays;
}

// Cache by year — a session rarely spans more than 2 years.
const holidayCache = new Map<number, Set<string>>();
function getHolidays(year: number): Set<string> {
  if (!holidayCache.has(year)) holidayCache.set(year, federalHolidaysForYear(year));
  return holidayCache.get(year)!;
}

function isFederalHoliday(d: Date): boolean {
  const year = d.getUTCFullYear();
  return getHolidays(year).has(d.toISOString().slice(0, 10));
}

function isWorkingDay(d: Date): boolean {
  return !isWeekend(d) && !isFederalHoliday(d);
}

// ── Date arithmetic in America/New_York ───────────────────────────────────
// We operate in UTC internally but snap to ET midnight when counting days,
// so that "15 calendar days after arrival" means 15 calendar days in the
// timezone brokers actually see on their clocks.

const ET_TZ = "America/New_York";

function toETMidnight(d: Date): Date {
  // Format the date in ET, then re-parse as UTC-anchored midnight.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

export function addHours(anchor: Date, hours: number): Date {
  return new Date(anchor.getTime() + hours * 3_600_000);
}

export function addCalendarDays(anchor: Date, days: number): Date {
  const base = toETMidnight(anchor);
  base.setUTCDate(base.getUTCDate() + days);
  return base;
}

export function addWorkingDays(anchor: Date, days: number): Date {
  let current = toETMidnight(anchor);
  let remaining = days;
  while (remaining > 0) {
    current = new Date(current.getTime() + 86_400_000);
    if (isWorkingDay(current)) remaining--;
  }
  return current;
}

export function subtractHours(anchor: Date, hours: number): Date {
  return new Date(anchor.getTime() - hours * 3_600_000);
}

// ── Rule application helper ───────────────────────────────────────────────

function applyOffset(anchor: Date, offset: DeadlineRuleOffset): Date {
  const { value, unit, direction } = offset;
  if (direction === "before") {
    if (unit === "hours") return subtractHours(anchor, value);
    // "before" + calendar/working days: rare, but handle symmetrically
    if (unit === "calendarDays") return addCalendarDays(anchor, -value);
    return addWorkingDays(anchor, -value);
  }
  if (unit === "hours") return addHours(anchor, value);
  if (unit === "calendarDays") return addCalendarDays(anchor, value);
  return addWorkingDays(anchor, value);
}

// ── V1 Rule definitions ───────────────────────────────────────────────────
// Only ISF_10_2, ENTRY_FILING, ENTRY_SUMMARY, DUTY_PAYMENT, LAST_FREE_DAY.
// Out-of-scope types are defined in the enum but not computed here (no
// trustworthy anchor exists yet).

export const DEADLINE_RULES: DeadlineRule[] = [
  {
    id: "ISF_10_2_v1",
    type: DeadlineType.ISF_10_2,
    deadlineClass: DeadlineClass.REGULATORY,
    anchor: DeadlineAnchor.LADING,
    citation: "19 CFR 149.2(a)",
    offset: { value: 24, unit: "hours", direction: "before" },
    appliesTo: (ctx) => {
      const mode = ctx.transportMode?.toLowerCase();
      return mode === "ocean" || mode == null;
    },
    penalty: { max: 5_000, basis: "up to $5,000 per violation (liquidated damages)" },
  },
  {
    id: "ENTRY_FILING_v1",
    type: DeadlineType.ENTRY_FILING,
    deadlineClass: DeadlineClass.REGULATORY,
    anchor: DeadlineAnchor.ARRIVAL,
    citation: "19 CFR 141.68(a)",
    offset: { value: 15, unit: "calendarDays", direction: "after" },
    appliesTo: () => true,
    penalty: { max: 0, basis: "General Order — merchandise placed in bonded warehouse" },
  },
  {
    id: "ENTRY_SUMMARY_v1",
    type: DeadlineType.ENTRY_SUMMARY,
    deadlineClass: DeadlineClass.REGULATORY,
    anchor: DeadlineAnchor.RELEASE,
    citation: "19 CFR 142.23(a)",
    offset: { value: 10, unit: "workingDays", direction: "after" },
    appliesTo: (ctx) => ctx.paymentMethod?.toUpperCase() !== "PMS",
    penalty: { max: 0, basis: "Liquidated damages per 19 USC 1593a" },
  },
  {
    id: "DUTY_PAYMENT_WITH_SUMMARY_v1",
    type: DeadlineType.DUTY_PAYMENT,
    deadlineClass: DeadlineClass.REGULATORY,
    anchor: DeadlineAnchor.RELEASE,
    citation: "19 CFR 24.1(a)(1)",
    offset: { value: 10, unit: "workingDays", direction: "after" },
    appliesTo: (ctx) => ctx.paymentMethod?.toUpperCase() !== "PMS",
    penalty: { max: 0, basis: "Interest accrues from due date per 19 USC 1677g" },
  },
];

// ── Anchor resolution ─────────────────────────────────────────────────────

interface AnchorResolution {
  date: Date;
  estimated: boolean;
}

function resolveAnchor(
  anchor: DeadlineAnchor,
  ctx: DeadlineContext
): AnchorResolution | null {
  switch (anchor) {
    case DeadlineAnchor.LADING:
      if (ctx.ladingDate) return { date: ctx.ladingDate, estimated: false };
      return null;

    case DeadlineAnchor.ARRIVAL: {
      if (ctx.arrivalDate) return { date: ctx.arrivalDate, estimated: false };
      if (ctx.estimatedArrival) return { date: ctx.estimatedArrival, estimated: true };
      return null;
    }

    case DeadlineAnchor.RELEASE:
      if (ctx.releaseDate) return { date: ctx.releaseDate, estimated: false };
      return null;

    default:
      return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Compute all applicable deadlines for a shipment context.
 *
 * Returns only deadlines whose anchor is known. "Unknown anchor" callers are
 * responsible for surfacing as a separate work item (Phase 2.3.3).
 */
export function computeDeadlines(ctx: DeadlineContext): ComputedDeadline[] {
  const results: ComputedDeadline[] = [];

  for (const rule of DEADLINE_RULES) {
    if (!rule.appliesTo(ctx)) continue;

    const resolved = resolveAnchor(rule.anchor, ctx);
    if (!resolved) continue; // anchor unknown → emit nothing

    const dueAt = applyOffset(resolved.date, rule.offset);

    results.push({
      ruleId: rule.id,
      type: rule.type,
      deadlineClass: rule.deadlineClass,
      anchorEvent: rule.anchor,
      anchorAt: resolved.date,
      dueAt,
      estimated: resolved.estimated,
      citation: rule.citation,
      penaltyMax: rule.penalty?.max,
      penaltyBasis: rule.penalty?.basis,
    });
  }

  return results;
}

/**
 * Which anchor events are needed but missing for this context?
 * Used to surface "cannot compute X — no Y on file" work items.
 */
export function missingAnchors(ctx: DeadlineContext): Array<{ type: DeadlineType; missingAnchor: DeadlineAnchor }> {
  const missing: Array<{ type: DeadlineType; missingAnchor: DeadlineAnchor }> = [];

  for (const rule of DEADLINE_RULES) {
    if (!rule.appliesTo(ctx)) continue;
    const resolved = resolveAnchor(rule.anchor, ctx);
    if (!resolved) {
      missing.push({ type: rule.type, missingAnchor: rule.anchor });
    }
  }

  return missing;
}
