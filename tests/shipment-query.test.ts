import { describe, expect, it } from "vitest";
import {
  SHIPMENT_PAGE_SIZE_DEFAULT,
  SHIPMENT_PAGE_SIZE_MAX,
  type ShipmentQuery,
  buildShipmentOrderBy,
  buildShipmentWhere,
  parseShipmentQuery,
  shipmentSkip,
} from "@/modules/shipments/shipmentQuery";

const params = (init: string) => new URLSearchParams(init);
const query = (overrides: Partial<ShipmentQuery> = {}): ShipmentQuery => ({
  search: null,
  status: null,
  health: null,
  client: null,
  assignee: null,
  sort: "createdAt",
  direction: "desc",
  page: 1,
  pageSize: SHIPMENT_PAGE_SIZE_DEFAULT,
  ...overrides,
});

describe("parseShipmentQuery", () => {
  it("returns no search for an absent parameter", () => {
    expect(parseShipmentQuery(params("")).search).toBeNull();
  });

  it("treats a whitespace-only query as no search", () => {
    expect(parseShipmentQuery(params("q=%20%20%20")).search).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseShipmentQuery(params("q=%20SHP-1%20")).search).toBe("SHP-1");
  });

  it("preserves internal spacing", () => {
    expect(parseShipmentQuery(params("q=ACME+Trading")).search).toBe("ACME Trading");
  });

  it("defaults to newest first", () => {
    const parsed = parseShipmentQuery(params(""));
    expect(parsed.sort).toBe("createdAt");
    expect(parsed.direction).toBe("desc");
  });

  it("accepts an allowlisted sort column", () => {
    const parsed = parseShipmentQuery(params("sort=importerName&dir=asc"));
    expect(parsed.sort).toBe("importerName");
    expect(parsed.direction).toBe("asc");
  });

  it("ignores a sort column that is not on the allowlist", () => {
    // A sort key becomes a Prisma orderBy field, so an unknown one must not pass.
    expect(parseShipmentQuery(params("sort=importerEin")).sort).toBe("createdAt");
    expect(parseShipmentQuery(params("sort=account.stripeId")).sort).toBe("createdAt");
  });

  it("ignores a direction that is not asc or desc", () => {
    expect(parseShipmentQuery(params("dir=sideways")).direction).toBe("desc");
  });

  it("caps the page size", () => {
    expect(parseShipmentQuery(params("pageSize=100000")).pageSize).toBe(SHIPMENT_PAGE_SIZE_MAX);
  });

  it("rejects a non-integer page", () => {
    expect(parseShipmentQuery(params("page=0")).page).toBe(1);
    expect(parseShipmentQuery(params("page=-3")).page).toBe(1);
    expect(parseShipmentQuery(params("page=two")).page).toBe(1);
  });
});

describe("buildShipmentWhere", () => {
  it("scopes to the account and excludes soft-deleted rows", () => {
    const where = buildShipmentWhere("acct_1", query());
    expect(where.accountId).toBe("acct_1");
    expect(where.deletedAt).toBeNull();
  });

  it("omits the OR clause entirely when there is no search", () => {
    expect(buildShipmentWhere("acct_1", query()).OR).toBeUndefined();
  });

  it("searches shipment number, importer, PO and port case-insensitively", () => {
    const where = buildShipmentWhere("acct_1", query({ search: "maersk" }));
    expect(where.OR).toHaveLength(4);
    const fields = where.OR!.map((clause) => Object.keys(clause)[0]);
    expect(fields).toEqual(["shipmentNumber", "importerName", "poReference", "portOfEntry"]);
    for (const clause of where.OR!) {
      expect(Object.values(clause)[0]).toEqual({ contains: "maersk", mode: "insensitive" });
    }
  });

  it("applies the status and health filters", () => {
    const where = buildShipmentWhere("acct_1", query({ status: "On Hold", health: "Critical" }));
    expect(where.status).toBe("On Hold");
    expect(where.healthStatus).toBe("Critical");
  });

  it("filters by client id", () => {
    expect(buildShipmentWhere("acct_1", query({ client: "cli_1" })).clientId).toBe("cli_1");
  });

  it("treats UNASSIGNED as a filter for shipments with no client", () => {
    // null is the filter here, so `in` distinguishes it from an absent filter.
    const where = buildShipmentWhere("acct_1", query({ client: "UNASSIGNED" }));
    expect("clientId" in where).toBe(true);
    expect(where.clientId).toBeNull();
  });

  it("filters by assignee, keeping unassigned shipments reachable", () => {
    expect(buildShipmentWhere("acct_1", query({ assignee: "usr_1" })).assignedBrokerId).toBe("usr_1");

    const unassigned = buildShipmentWhere("acct_1", query({ assignee: "UNASSIGNED" }));
    expect("assignedBrokerId" in unassigned).toBe(true);
    expect(unassigned.assignedBrokerId).toBeNull();

    expect("assignedBrokerId" in buildShipmentWhere("acct_1", query())).toBe(false);
  });

  it("omits a filter that was not supplied", () => {
    const where = buildShipmentWhere("acct_1", query());
    expect("status" in where).toBe(false);
    expect("healthStatus" in where).toBe(false);
    expect("clientId" in where).toBe(false);
  });

  it("cannot be widened by an accountId query parameter", () => {
    const where = buildShipmentWhere("acct_1", parseShipmentQuery(params("q=x&accountId=acct_evil")));
    expect(where.accountId).toBe("acct_1");
    expect(JSON.stringify(where)).not.toContain("acct_evil");
  });

  it("keeps the account scope even when the search text names another account", () => {
    expect(buildShipmentWhere("acct_1", query({ search: "acct_2" })).accountId).toBe("acct_1");
  });
});

describe("buildShipmentOrderBy", () => {
  it("orders by the requested column and direction", () => {
    expect(buildShipmentOrderBy(query({ sort: "status", direction: "asc" }))).toEqual({
      status: "asc",
    });
  });
});

describe("shipmentSkip", () => {
  it("starts the first page at zero", () => {
    expect(shipmentSkip(query({ page: 1, pageSize: 25 }))).toBe(0);
  });

  it("advances by a full page", () => {
    expect(shipmentSkip(query({ page: 3, pageSize: 25 }))).toBe(50);
  });
});
