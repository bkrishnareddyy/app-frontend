import { describe, it, expect } from "vitest";
import {
  buildDecisionOrderBy,
  buildDecisionWhere,
  decisionSkip,
  parseDecisionQuery,
  DECISION_PAGE_SIZE_DEFAULT,
} from "@/modules/decisions/decisionQuery";

const ACCOUNT = "acct_1";
const NOW = new Date("2026-03-10T12:00:00.000Z");

function parse(qs: string) {
  return parseDecisionQuery(new URLSearchParams(qs));
}

describe("parseDecisionQuery", () => {
  it("defaults to the newest decisions first", () => {
    const query = parse("");

    expect(query.sort).toBe("createdAt");
    expect(query.direction).toBe("desc");
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(DECISION_PAGE_SIZE_DEFAULT);
  });

  it("ignores a sort column that is not on the allowlist", () => {
    // A sort key is a Prisma orderBy field, so an unfiltered one would let a
    // caller order by - and therefore probe - any column on the model.
    const query = parse("sort=humanNotes&dir=asc");

    expect(query.sort).toBe("createdAt");
  });

  it("accepts every documented filter", () => {
    const query = parse(
      "status=Review%20Required&agent=Classification&shipmentId=shp_1&reviewer=u_2&confidence=low&age=older&q=valve"
    );

    expect(query.status).toBe("Review Required");
    expect(query.agentName).toBe("Classification");
    expect(query.shipmentId).toBe("shp_1");
    expect(query.reviewerId).toBe("u_2");
    expect(query.confidence).toBe("low");
    expect(query.age).toBe("older");
    expect(query.search).toBe("valve");
  });

  it("drops a confidence or age band it does not recognise", () => {
    const query = parse("confidence=excellent&age=eventually");

    expect(query.confidence).toBeNull();
    expect(query.age).toBeNull();
  });

  it("treats a blank filter as no filter", () => {
    const query = parse("status=%20%20&agent=");

    expect(query.status).toBeNull();
    expect(query.agentName).toBeNull();
  });
});

describe("buildDecisionWhere", () => {
  it("always scopes to the account", () => {
    expect(buildDecisionWhere(parse(""), ACCOUNT, NOW)).toEqual({ accountId: ACCOUNT });
  });

  it("does not add a filter key that was not requested", () => {
    // Prisma drops undefined filters, so an accidentally-undefined key would
    // silently widen the query rather than fail.
    const where = buildDecisionWhere(parse(""), ACCOUNT, NOW);

    expect(Object.keys(where)).toEqual(["accountId"]);
  });

  it("maps each confidence band to its own range", () => {
    expect(buildDecisionWhere(parse("confidence=high"), ACCOUNT, NOW).confidence).toEqual({ gte: 85 });
    expect(buildDecisionWhere(parse("confidence=medium"), ACCOUNT, NOW).confidence).toEqual({
      gte: 60,
      lte: 84,
    });
    expect(buildDecisionWhere(parse("confidence=low"), ACCOUNT, NOW).confidence).toEqual({ lte: 59 });
  });

  it("matches an unscored decision on null, not on zero", () => {
    // A decision the model never scored is not a zero-confidence decision.
    expect(buildDecisionWhere(parse("confidence=unscored"), ACCOUNT, NOW).confidence).toBeNull();
  });

  it("converts age bands into dated bounds", () => {
    expect(buildDecisionWhere(parse("age=today"), ACCOUNT, NOW).createdAt).toEqual({
      gte: new Date("2026-03-09T12:00:00.000Z"),
    });
    expect(buildDecisionWhere(parse("age=week"), ACCOUNT, NOW).createdAt).toEqual({
      gte: new Date("2026-03-03T12:00:00.000Z"),
    });
    expect(buildDecisionWhere(parse("age=older"), ACCOUNT, NOW).createdAt).toEqual({
      lt: new Date("2026-03-03T12:00:00.000Z"),
    });
  });

  it("searches the fields an operator would recognise a decision by", () => {
    const where = buildDecisionWhere(parse("q=8481.80"), ACCOUNT, NOW);

    expect(where.OR).toEqual([
      { agentName: { contains: "8481.80", mode: "insensitive" } },
      { decisionSummary: { contains: "8481.80", mode: "insensitive" } },
      { proposedHtsCode: { contains: "8481.80", mode: "insensitive" } },
      { currentHtsCode: { contains: "8481.80", mode: "insensitive" } },
      { shipment: { shipmentNumber: { contains: "8481.80", mode: "insensitive" } } },
    ]);
  });

  it("keeps the account scope alongside every other filter", () => {
    const where = buildDecisionWhere(parse("status=Approved&shipmentId=shp_1&q=valve"), ACCOUNT, NOW);

    expect(where.accountId).toBe(ACCOUNT);
    expect(where.status).toBe("Approved");
    expect(where.shipmentId).toBe("shp_1");
    expect(where.OR).toBeDefined();
  });
});

describe("buildDecisionOrderBy and decisionSkip", () => {
  it("orders by a plain column", () => {
    expect(buildDecisionOrderBy(parse("sort=status&dir=asc"))).toEqual({ status: "asc" });
  });

  it("nests a relation column", () => {
    expect(buildDecisionOrderBy(parse("sort=shipment.shipmentNumber&dir=asc"))).toEqual({
      shipment: { shipmentNumber: "asc" },
    });
  });

  it("skips whole pages", () => {
    expect(decisionSkip(parse(""))).toBe(0);
    expect(decisionSkip(parse("page=3"))).toBe(DECISION_PAGE_SIZE_DEFAULT * 2);
  });
});
