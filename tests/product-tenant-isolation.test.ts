import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PRODUCT_PAGE_SIZE_MAX,
  PRODUCT_SORT_COLUMNS,
  buildProductWhere,
  parseProductQuery,
  productSkip,
} from "@/modules/product/productQuery";

const query = (init: string) => parseProductQuery(new URLSearchParams(init));

const TENANT = "acct_a";

describe("buildProductWhere: the account filter", () => {
  it("scopes every query to the caller's account and to live rows", () => {
    const where = buildProductWhere(TENANT, query(""));
    expect(where.accountId).toBe(TENANT);
    expect(where.deletedAt).toBeNull();
  });

  it("cannot be widened by any query parameter", () => {
    // Every filter the URL can express, at once. accountId must survive all of it.
    const where = buildProductWhere(
      TENANT,
      query(
        "q=bracket&status=ACTIVE&reviewStatus=UNREVIEWED&jurisdiction=us&needsRevalidation=true&unclassified=true&sort=productName&dir=asc&page=3"
      )
    );
    expect(where.accountId).toBe(TENANT);
  });

  it("ignores an accountId supplied in the URL", () => {
    const where = buildProductWhere(TENANT, query("accountId=acct_b&account=acct_b&tenantId=acct_b"));
    expect(where.accountId).toBe(TENANT);
    expect(JSON.stringify(where)).not.toContain("acct_b");
  });

  it("counts only approved classifications as classified for a jurisdiction", () => {
    // A pending candidate must not make a product appear in a filter a broker
    // reads as "has a code for the US".
    const where = buildProductWhere(TENANT, query("jurisdiction=us"));
    expect(where.classifications).toEqual({ some: { jurisdiction: "US", status: "APPROVED" } });
  });

  it("treats 'unclassified' as having no approved row anywhere", () => {
    const where = buildProductWhere(TENANT, query("unclassified=true"));
    expect(where.NOT).toEqual({ classifications: { some: { status: "APPROVED" } } });
  });

  it("finds a product by an identifier typed the way it is printed", () => {
    const where = buildProductWhere(TENANT, query("q=abc-123"));
    expect(where.OR).toContainEqual({
      identifiers: { some: { normalizedValue: { contains: "ABC123" } } },
    });
  });

  it("finds a product by a tariff code typed with dots", () => {
    const where = buildProductWhere(TENANT, query("q=8471.30"));
    expect(where.OR).toContainEqual({
      classifications: { some: { normalizedCode: { startsWith: "847130" } } },
    });
  });

  it("does not turn a two-digit search into a code prefix search", () => {
    const where = buildProductWhere(TENANT, query("q=84"));
    expect(where.OR?.some((clause) => "classifications" in clause)).toBe(false);
  });

  it("scopes products by clientId when specified", () => {
    const exact = buildProductWhere(TENANT, query("clientId=cli_123"));
    expect(exact.clientId).toBe("cli_123");

    const unassigned = buildProductWhere(TENANT, query("clientId=unassigned"));
    expect(unassigned.clientId).toBeNull();

    const shared = buildProductWhere(TENANT, query("clientId=cli_123&clientScope=include_shared"));
    expect(shared.clientId).toEqual({ in: ["cli_123", null] });
  });
});

describe("parseProductQuery", () => {
  it("refuses a sort column outside the allowlist", () => {
    // The sort key becomes a Prisma orderBy field name, so an arbitrary string
    // would let a caller order by — and so probe — any column on the table.
    expect(query("sort=accountId").sort).toBe("updatedAt");
    expect(PRODUCT_SORT_COLUMNS).not.toContain("accountId" as never);
  });

  it("caps the page size", () => {
    expect(query("pageSize=100000").pageSize).toBe(PRODUCT_PAGE_SIZE_MAX);
  });

  it("upper-cases a jurisdiction so the filter matches how codes are stored", () => {
    expect(query("jurisdiction=us").jurisdiction).toBe("US");
  });

  it("treats any value other than 'true' as the flag being off", () => {
    expect(query("needsRevalidation=1").needsRevalidation).toBe(false);
    expect(query("unclassified=yes").unclassified).toBe(false);
  });

  it("skips whole pages, never a negative offset", () => {
    expect(productSkip(query("page=1"))).toBe(0);
    expect(productSkip(query("page=0"))).toBe(0);
    expect(productSkip(query("page=-4"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Source-level guarantees
//
// The isolation that matters most cannot be unit-tested against a fake, because
// the risk is a future query that simply forgets the filter. These scans read
// the shipped source and fail on the shape of that mistake.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const PRODUCT_API_DIR = join(process.cwd(), "src/app/api/products");
const PRODUCT_MODULE_DIR = join(process.cwd(), "src/modules/product");

describe("product API routes", () => {
  const routes = sourceFiles(PRODUCT_API_DIR).filter((file) => file.endsWith("route.ts"));

  it("has routes to check", () => {
    expect(routes.length).toBeGreaterThan(15);
  });

  it("authenticates every route through the shared guard", () => {
    const unguarded = routes.filter(
      (file) => !readFileSync(file, "utf8").includes("withAuthenticatedRoute")
    );
    expect(unguarded).toEqual([]);
  });

  it("never takes the tenant from the request", () => {
    const offenders: string[] = [];
    for (const file of routes) {
      const content = readFileSync(file, "utf8");
      if (/body\.data\.(account|tenant)Id/i.test(content)) offenders.push(file);
      if (/accountId:\s*(body|input|payload|req|params)/i.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("builds its actor from the authenticated context alone", () => {
    // productActor(ctx, requestId) is the only constructor, and it reads
    // ctx.accountId. A route that built an actor literal could pick its own.
    const offenders = routes.filter((file) => {
      const content = readFileSync(file, "utf8");
      return content.includes("canApproveClassification:") || /accountId:\s*["']/.test(content);
    });
    expect(offenders).toEqual([]);
  });
});

describe("product request schemas", () => {
  it("have no accountId or tenantId field to send", () => {
    const schemas = readFileSync(join(PRODUCT_MODULE_DIR, "productSchemas.ts"), "utf8");
    // The word appears once, in the comment explaining why it is absent.
    expect(/accountId:\s*z\./.test(schemas)).toBe(false);
    expect(/tenantId/.test(schemas)).toBe(false);
  });
});

describe("product service queries", () => {
  const files = [
    join(PRODUCT_MODULE_DIR, "productService.ts"),
    join(PRODUCT_MODULE_DIR, "productImportService.ts"),
  ];

  it("only ever sets accountId from the actor", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(/accountId:\s*([\w.]+)/g)) {
        const value = match[1];
        // "string" is the ProductActor type declaration; "accountId" is the
        // shorthand inside the one helper that takes it as a parameter.
        if (value !== "actor.accountId" && value !== "string" && value !== "accountId") {
          offenders.push(`${file}: accountId: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("filters child rows by account as well as by parent, so a foreign id cannot be reached through a product it does not belong to", () => {
    const service = readFileSync(files[0]!, "utf8");
    for (const child of ["identifierId", "attributeId", "compositionId", "partyId", "factId", "classificationId", "flagId"]) {
      const pattern = new RegExp(`where:\\s*\\{[^}]*${child}[^}]*accountId: actor\\.accountId`);
      expect({ child, scoped: pattern.test(service) }).toEqual({ child, scoped: true });
    }
  });

  it("reports a product in another account as not found rather than forbidden", () => {
    // A 403 would confirm the id exists somewhere, which is itself a leak.
    const service = readFileSync(files[0]!, "utf8");
    expect(service).toContain('"PRODUCT_NOT_FOUND", 404');
    expect(/PRODUCT_NOT_FOUND[^)]*403/.test(service)).toBe(false);
  });
});
