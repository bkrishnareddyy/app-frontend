import { describe, it, expect } from "vitest";
import {
  DOCUMENT_SORT_COLUMNS,
  buildDocumentOrderBy,
  parseDocumentQuery,
} from "@/modules/documents/documentQuery";

function query(params: Record<string, string>) {
  return parseDocumentQuery(new URLSearchParams(params));
}

describe("parseDocumentQuery sorting", () => {
  it("defaults to newest first", () => {
    const parsed = query({});
    expect(parsed.sort).toBe("createdAt");
    expect(parsed.direction).toBe("desc");
  });

  it("accepts every column the table offers", () => {
    for (const column of DOCUMENT_SORT_COLUMNS) {
      expect(query({ sort: column }).sort).toBe(column);
    }
  });

  it("refuses a column that is not on the allowlist", () => {
    // An arbitrary sort key reaches Prisma as a column name.
    expect(query({ sort: "extractedJson" }).sort).toBe("createdAt");
    expect(query({ sort: "account.name" }).sort).toBe("createdAt");
    expect(query({ sort: "" }).sort).toBe("createdAt");
  });

  it("starts a date column newest-first and a text column A-to-Z", () => {
    expect(query({ sort: "createdAt" }).direction).toBe("desc");
    expect(query({ sort: "fileName" }).direction).toBe("asc");
    expect(query({ sort: "status" }).direction).toBe("asc");
  });

  it("honours an explicit direction and ignores a nonsense one", () => {
    expect(query({ sort: "fileName", dir: "desc" }).direction).toBe("desc");
    expect(query({ sort: "createdAt", dir: "asc" }).direction).toBe("asc");
    expect(query({ sort: "fileName", dir: "sideways" }).direction).toBe("asc");
  });
});

describe("buildDocumentOrderBy", () => {
  it("always ends with a unique tiebreaker", () => {
    // Without one, two rows with the same value can swap between pages, so a
    // row is shown twice and another is never shown at all.
    for (const column of DOCUMENT_SORT_COLUMNS) {
      const orderBy = buildDocumentOrderBy(query({ sort: column }));
      expect(orderBy.at(-1)).toEqual({ id: "desc" });
    }
  });

  it("sorts by the requested column first", () => {
    expect(buildDocumentOrderBy(query({ sort: "fileName", dir: "asc" }))[0]).toEqual({
      fileName: "asc",
    });
    expect(buildDocumentOrderBy(query({ sort: "status", dir: "desc" }))[0]).toEqual({
      status: "desc",
    });
  });

  it("sorts a shipment number through the relation, not a column that does not exist", () => {
    expect(buildDocumentOrderBy(query({ sort: "shipmentNumber", dir: "asc" }))[0]).toEqual({
      shipment: { shipmentNumber: "asc" },
    });
  });

  it("puts an unknown confidence last in both directions", () => {
    // Postgres orders NULLs first on DESC, which would fill the top of
    // "highest confidence" with documents that were never scored.
    expect(buildDocumentOrderBy(query({ sort: "confidence", dir: "desc" }))[0]).toEqual({
      confidence: { sort: "desc", nulls: "last" },
    });
    expect(buildDocumentOrderBy(query({ sort: "confidence", dir: "asc" }))[0]).toEqual({
      confidence: { sort: "asc", nulls: "last" },
    });
  });

  it("does not repeat createdAt when createdAt is the sort", () => {
    const orderBy = buildDocumentOrderBy(query({ sort: "createdAt" }));
    expect(orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("falls back to newest within an equal value on every other column", () => {
    const orderBy = buildDocumentOrderBy(query({ sort: "docType", dir: "asc" }));
    expect(orderBy).toEqual([{ docType: "asc" }, { createdAt: "desc" }, { id: "desc" }]);
  });
});
