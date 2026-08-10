import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type ColumnSpec,
  type SortSpec,
  buildOrderBy,
  nextDirection,
  pageCount,
  parseTableQuery,
  resetPage,
  serializeColumns,
  tableHref,
  tableSkip,
  visibleColumns,
} from "@/modules/tables/tableQuery";

type Column = "name" | "createdAt" | "shipment.shipmentNumber";

const spec: SortSpec<Column> = {
  columns: ["name", "createdAt", "shipment.shipmentNumber"],
  fallback: "createdAt",
};

const params = (init: string) => new URLSearchParams(init);
const parse = (init: string) => parseTableQuery(params(init), spec);

describe("parseTableQuery", () => {
  it("falls back to the declared column and direction", () => {
    const query = parse("");
    expect(query.sort).toBe("createdAt");
    expect(query.direction).toBe("desc");
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(query.search).toBeNull();
  });

  it("refuses a sort column outside the allowlist", () => {
    // The sort key is used as a Prisma orderBy field name, so an arbitrary
    // string would let a caller order by — and probe — any column.
    expect(parse("sort=passwordHash").sort).toBe("createdAt");
    expect(parse("sort=user.email").sort).toBe("createdAt");
    expect(parse("sort=").sort).toBe("createdAt");
  });

  it("accepts an allowlisted dotted column", () => {
    expect(parse("sort=shipment.shipmentNumber").sort).toBe("shipment.shipmentNumber");
  });

  it("honours an explicit direction and rejects anything else", () => {
    expect(parse("sort=name&dir=asc").direction).toBe("asc");
    expect(parse("sort=name&dir=ASC").direction).toBe("desc");
    expect(parse("sort=name&dir=drop+table").direction).toBe("desc");
  });

  it("uses the configured search parameter name", () => {
    expect(parseTableQuery(params("search=abc"), spec, { searchParam: "search" }).search).toBe("abc");
    expect(parse("search=abc").search).toBeNull();
  });

  it("treats a blank search as no search", () => {
    expect(parse("q=%20%20").search).toBeNull();
  });

  it("clamps the page size to the maximum", () => {
    expect(parse("pageSize=1000").pageSize).toBe(PAGE_SIZE_MAX);
    expect(parse("pageSize=0").pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(parse("pageSize=abc").pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(parse("pageSize=10").pageSize).toBe(10);
  });

  it("clamps a bad page to the first page", () => {
    expect(parse("page=-1").page).toBe(1);
    expect(parse("page=1.5").page).toBe(1);
    expect(parse("page=4").page).toBe(4);
  });
});

describe("buildOrderBy", () => {
  it("maps a flat column directly", () => {
    expect(buildOrderBy(parse("sort=name&dir=asc"))).toEqual({ name: "asc" });
  });

  it("nests a dotted column for a relation", () => {
    expect(buildOrderBy(parse("sort=shipment.shipmentNumber&dir=desc"))).toEqual({
      shipment: { shipmentNumber: "desc" },
    });
  });
});

describe("tableSkip and pageCount", () => {
  it("skips whole pages", () => {
    expect(tableSkip(parse("page=1"))).toBe(0);
    expect(tableSkip(parse("page=3&pageSize=10"))).toBe(20);
  });

  it("reports one page when there are no rows", () => {
    // Zero rows is still a page the operator is looking at, not "page 1 of 0".
    expect(pageCount(0, 25)).toBe(1);
  });

  it("rounds a partial page up", () => {
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(50, 25)).toBe(2);
  });
});

describe("nextDirection", () => {
  it("starts a new column at the supplied default", () => {
    expect(nextDirection(parse("sort=name"), "createdAt")).toBe("desc");
    expect(nextDirection(parse("sort=name"), "createdAt", "asc")).toBe("asc");
  });

  it("flips the direction of the active column", () => {
    expect(nextDirection(parse("sort=name&dir=asc"), "name")).toBe("desc");
    expect(nextDirection(parse("sort=name&dir=desc"), "name")).toBe("asc");
  });
});

describe("tableHref", () => {
  it("keeps unrelated parameters", () => {
    const href = tableHref("/app/shipments", params("q=acme&status=On+Hold"), { page: 2 });
    expect(href).toContain("q=acme");
    expect(href).toContain("status=On+Hold");
    expect(href).toContain("page=2");
  });

  it("removes a parameter set to null", () => {
    expect(tableHref("/app/shipments", params("status=On+Hold"), { status: null })).toBe(
      "/app/shipments"
    );
  });

  it("does not mutate the parameters it was given", () => {
    const current = params("page=2");
    tableHref("/app/shipments", current, { page: 5 });
    expect(current.get("page")).toBe("2");
  });

  it("resetPage clears the page alongside the patch", () => {
    const href = tableHref("/app/shipments", params("page=7"), resetPage({ status: "On Hold" }));
    expect(href).not.toContain("page=");
    expect(href).toContain("status=On+Hold");
  });
});

describe("visibleColumns", () => {
  const columns: ReadonlyArray<ColumnSpec<"a" | "b" | "c">> = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C", optional: true },
  ];

  it("shows every non-optional column by default", () => {
    expect(visibleColumns(null, columns)).toEqual(["a", "b"]);
  });

  it("honours an explicit selection in declared order", () => {
    expect(visibleColumns("c,a", columns)).toEqual(["a", "c"]);
  });

  it("drops ids that are not declared", () => {
    expect(visibleColumns("a,ssn", columns)).toEqual(["a"]);
  });

  it("never returns an empty table", () => {
    expect(visibleColumns("", columns)).toEqual(["a", "b"]);
    expect(visibleColumns("nothing-real", columns)).toEqual(["a", "b"]);
  });

  it("serializes back to null when the selection is the default", () => {
    expect(serializeColumns(["a", "b"], columns)).toBeNull();
    expect(serializeColumns(["a", "b", "c"], columns)).toBe("a,b,c");
  });
});
