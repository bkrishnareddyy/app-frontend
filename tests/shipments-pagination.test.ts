import { describe, expect, it } from "vitest";

import { PAGE_SIZE_DEFAULT, pageCount } from "@/modules/tables/tableQuery";

/**
 * The shipments workbench paginates the *filtered* list, not the raw one: the four
 * KPI cards and the global search both read the whole set, so paginating the data
 * source would make "Total: 25" mean "25 on this page" and let a search miss every
 * match that happened not to be on the page being viewed.
 *
 * These pin the arithmetic the table renders with -- the clamp in particular, which
 * is what stops a narrowed filter leaving the operator on a page that no longer
 * exists.
 */
function view(total: number, pageSize: number, requestedPage: number) {
  const pages = pageCount(total, pageSize);
  const currentPage = Math.min(requestedPage, pages);
  return {
    pages,
    currentPage,
    firstRow: total === 0 ? 0 : (currentPage - 1) * pageSize + 1,
    lastRow: Math.min(currentPage * pageSize, total),
    sliceStart: (currentPage - 1) * pageSize,
    sliceEnd: currentPage * pageSize,
  };
}

describe("shipments pagination arithmetic", () => {
  it("defaults to a page size the table query module already defines", () => {
    // Reused rather than redeclared, so the workbench and any server-paginated
    // table cannot drift to different defaults.
    expect(PAGE_SIZE_DEFAULT).toBe(25);
  });

  it("reports the real range on a full page", () => {
    const v = view(120, 25, 2);
    expect(v.pages).toBe(5);
    expect([v.firstRow, v.lastRow]).toEqual([26, 50]);
  });

  it("reports how many rows a partial last page actually holds", () => {
    // 101 rows is 5 pages, the last holding one -- "101-125 of 101" would be a lie.
    const v = view(101, 25, 5);
    expect(v.pages).toBe(5);
    expect([v.firstRow, v.lastRow]).toEqual([101, 101]);
  });

  it("clamps a page that a narrowed filter has left out of range", () => {
    // Sitting on page 4, then filtering down to 30 rows: the table shows page 2,
    // not an empty page 4.
    const v = view(30, 25, 4);
    expect(v.currentPage).toBe(2);
    expect([v.firstRow, v.lastRow]).toEqual([26, 30]);
  });

  it("stays on a single valid page when everything is filtered away", () => {
    const v = view(0, 25, 3);
    expect(v.pages).toBe(1);
    expect(v.currentPage).toBe(1);
    expect([v.firstRow, v.lastRow]).toEqual([0, 0]);
  });

  it("never yields an empty slice while rows exist", () => {
    // The clamp guarantees this: an in-range page over a non-empty list always has
    // at least one row, so the empty state only shows when nothing matched.
    for (const total of [1, 24, 25, 26, 99, 100, 137]) {
      for (const size of [25, 50, 100]) {
        for (const requested of [1, 2, 3, 50]) {
          const v = view(total, size, requested);
          const rows = Array.from({ length: total }, (_, i) => i).slice(v.sliceStart, v.sliceEnd);
          expect(rows.length).toBeGreaterThan(0);
          expect(rows.length).toBe(v.lastRow - v.firstRow + 1);
        }
      }
    }
  });

  it("covers every row exactly once across all pages", () => {
    const total = 137;
    const size = 50;
    const seen: number[] = [];
    for (let p = 1; p <= pageCount(total, size); p++) {
      const v = view(total, size, p);
      seen.push(...Array.from({ length: total }, (_, i) => i).slice(v.sliceStart, v.sliceEnd));
    }
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
  });
});
