import { describe, expect, it } from "vitest";
import {
  SAVED_VIEW_LIMIT,
  SAVED_VIEW_NAME_MAX,
  type SavedView,
  isActiveView,
  parseSavedViews,
  removeSavedView,
  savedViewHref,
  savedViewStorageKey,
  upsertSavedView,
} from "@/modules/tables/savedViews";

const view = (name: string, query: string): SavedView => ({ name, query });

describe("savedViewStorageKey", () => {
  it("namespaces per table", () => {
    expect(savedViewStorageKey("shipments")).not.toBe(savedViewStorageKey("documents"));
  });
});

describe("parseSavedViews", () => {
  it("returns nothing when the browser has stored nothing", () => {
    expect(parseSavedViews(null)).toEqual([]);
  });

  it("survives corrupt storage instead of throwing", () => {
    // localStorage is user-writable, so a bad value must not break the table.
    expect(parseSavedViews("{not json")).toEqual([]);
    expect(parseSavedViews('{"name":"x"}')).toEqual([]);
    expect(parseSavedViews("null")).toEqual([]);
  });

  it("drops entries that are not a name and query pair", () => {
    const raw = JSON.stringify([{ name: "ok", query: "q=a" }, { name: 7, query: "q=b" }, null]);
    expect(parseSavedViews(raw)).toEqual([{ name: "ok", query: "q=a" }]);
  });

  it("re-serializes the stored query so it cannot carry anything but parameters", () => {
    const raw = JSON.stringify([{ name: "ok", query: "?q=a&status=On Hold" }]);
    expect(parseSavedViews(raw)[0].query).toBe("q=a&status=On+Hold");
  });

  it("caps the number of stored views", () => {
    const raw = JSON.stringify(
      Array.from({ length: SAVED_VIEW_LIMIT + 10 }, (_, i) => view(`v${i}`, `page=${i}`))
    );
    expect(parseSavedViews(raw)).toHaveLength(SAVED_VIEW_LIMIT);
  });
});

describe("upsertSavedView", () => {
  it("adds a view at the front", () => {
    expect(upsertSavedView([view("a", "q=1")], "b", "q=2")).toEqual([
      { name: "b", query: "q=2" },
      { name: "a", query: "q=1" },
    ]);
  });

  it("replaces a view with the same name rather than duplicating it", () => {
    const next = upsertSavedView([view("a", "q=1"), view("b", "q=2")], "a", "q=99");
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({ name: "a", query: "q=99" });
  });

  it("trims the name and ignores a blank one", () => {
    expect(upsertSavedView([], "  Hot  ", "q=1")[0].name).toBe("Hot");
    expect(upsertSavedView([view("a", "q=1")], "   ", "q=2")).toEqual([{ name: "a", query: "q=1" }]);
  });

  it("truncates an over-long name", () => {
    const name = "x".repeat(SAVED_VIEW_NAME_MAX + 40);
    expect(upsertSavedView([], name, "q=1")[0].name).toHaveLength(SAVED_VIEW_NAME_MAX);
  });

  it("honours the limit", () => {
    const existing = Array.from({ length: SAVED_VIEW_LIMIT }, (_, i) => view(`v${i}`, `page=${i}`));
    expect(upsertSavedView(existing, "new", "page=x")).toHaveLength(SAVED_VIEW_LIMIT);
  });
});

describe("removeSavedView", () => {
  it("removes only the named view", () => {
    expect(removeSavedView([view("a", "q=1"), view("b", "q=2")], "a")).toEqual([
      { name: "b", query: "q=2" },
    ]);
  });
});

describe("savedViewHref", () => {
  it("returns the bare path for an empty query", () => {
    expect(savedViewHref("/app/shipments", view("all", ""))).toBe("/app/shipments");
  });

  it("appends the stored query", () => {
    expect(savedViewHref("/app/shipments", view("hold", "status=On+Hold"))).toBe(
      "/app/shipments?status=On+Hold"
    );
  });
});

describe("isActiveView", () => {
  it("ignores parameter order", () => {
    expect(isActiveView(view("v", "status=Hold&q=a"), "q=a&status=Hold")).toBe(true);
  });

  it("is false when a parameter differs", () => {
    expect(isActiveView(view("v", "status=Hold"), "status=Ready")).toBe(false);
    expect(isActiveView(view("v", "status=Hold"), "")).toBe(false);
  });
});
