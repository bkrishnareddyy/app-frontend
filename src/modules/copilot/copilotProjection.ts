/**
 * How a Qubere record is shaped before a model ever sees it.
 *
 * Two rules run through everything here.
 *
 * The first is data minimization: a tool returns the fields needed to answer
 * operational questions and nothing else. No raw document text, no file URLs,
 * no checksums, no internal user ids beyond what an answer needs to name a
 * person, and no columns the model has no business reasoning about.
 *
 * The second is honesty about absence. A missing value is emitted as `null`
 * rather than as an empty string or an invented default, so the model has a
 * value it can report as unavailable instead of a blank it might fill in. The
 * same distinction `src/lib/honest.ts` draws for the UI.
 */

/** Trimmed, truncated, and null when there is genuinely nothing there. */
export function text(value: string | null | undefined, max = 240): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Dates as ISO strings; a model reasons about them better than about epochs. */
export function isoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  const time = value.getTime();
  return Number.isNaN(time) ? null : value.toISOString();
}

export function isoDay(value: Date | null | undefined): string | null {
  return isoDate(value)?.slice(0, 10) ?? null;
}

/** Prisma Decimal, a number, or nothing. Never NaN, never a formatted string. */
export function numeric(value: { toString(): string } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Caps a list and says so, rather than silently returning a prefix. A model
 * told "10 of 41" will not describe the ten as if they were all of them.
 */
export function capped<T, R>(
  rows: readonly T[],
  limit: number,
  project: (row: T) => R
): { items: R[]; returned: number; truncated: boolean } {
  const slice = rows.slice(0, limit);
  return {
    items: slice.map(project),
    returned: slice.length,
    truncated: rows.length > limit,
  };
}
