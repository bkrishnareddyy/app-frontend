import { describe, expect, it } from "vitest";

import { PAGE_SIZE_DEFAULT, pageWindow } from "@/modules/tables/tableQuery";

/**
 * `pageWindow` is what the All Shipments and Trade Documents tables page with.
 *
 * Both paginate their *filtered* list rather than their data source: the KPI cards
 * and global search on those screens read every row, so limiting what is fetched
 * would make "Total: 25" mean "25 on this page" and let a search report no matches
 * while they sat on a page nobody was viewing.
 */
describe("pageWindow", () => {
  it("uses the page size both tables default to", () => {
    // Shared rather than redeclared per table, so the two cannot drift apart.
    expect(PAGE_SIZE_DEFAULT).toBe(25);
  });

  it("reports the real range on a full page", () => {
    const w = pageWindow(120, 25, 2);
    expect(w.pages).toBe(5);
    expect([w.firstRow, w.lastRow]).toEqual([26, 50]);
    expect([w.start, w.end]).toEqual([25, 50]);
  });

  it("reports how many rows a partial last page actually holds", () => {
    // 101 rows over 25 is five pages, the last holding one. "101-125 of 101"
    // would be a lie about the data.
    const w = pageWindow(101, 25, 5);
    expect([w.firstRow, w.lastRow]).toEqual([101, 101]);
  });

  it("clamps a page a narrowed filter has left out of range", () => {
    // On page 4, then filtering down to 30 rows: show page 2, not an empty page 4.
    const w = pageWindow(30, 25, 4);
    expect(w.page).toBe(2);
    expect([w.firstRow, w.lastRow]).toEqual([26, 30]);
  });

  it("clamps a page below the first one", () => {
    expect(pageWindow(30, 25, 0).page).toBe(1);
    expect(pageWindow(30, 25, -3).page).toBe(1);
  });

  it("stays on one valid page when everything is filtered away", () => {
    const w = pageWindow(0, 25, 3);
    expect(w.pages).toBe(1);
    expect(w.page).toBe(1);
    // Zero, not 1: there is no first row to number.
    expect([w.firstRow, w.lastRow]).toEqual([0, 0]);
  });

  it("never yields an empty slice while rows exist", () => {
    // The clamp guarantees it, which is what lets the tables treat an empty body
    // as "nothing matched" rather than a paging fault.
    for (const total of [1, 24, 25, 26, 99, 100, 137]) {
      for (const size of [25, 50, 100]) {
        for (const requested of [1, 2, 3, 50]) {
          const w = pageWindow(total, size, requested);
          const rows = Array.from({ length: total }, (_, i) => i).slice(w.start, w.end);
          expect(rows.length).toBeGreaterThan(0);
          expect(rows.length).toBe(w.lastRow - w.firstRow + 1);
        }
      }
    }
  });

  it("tiles every row exactly once across all pages", () => {
    const total = 137;
    const size = 50;
    const seen: number[] = [];
    for (let p = 1; p <= pageWindow(total, size, 1).pages; p++) {
      const w = pageWindow(total, size, p);
      seen.push(...Array.from({ length: total }, (_, i) => i).slice(w.start, w.end));
    }
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
  });
});
