import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PARTY_PAGE_SIZE_MAX,
  PARTY_SORT_COLUMNS,
  buildPartyWhere,
  parsePartyQuery,
  partySkip,
} from "@/modules/party/partyQuery";

const query = (init: string) => parsePartyQuery(new URLSearchParams(init));

const TENANT = "acct_a";

describe("buildPartyWhere: the account filter", () => {
  it("scopes every query to the caller's account and to live rows", () => {
    const where = buildPartyWhere(TENANT, query(""));
    expect(where.accountId).toBe(TENANT);
    expect(where.deletedAt).toBeNull();
  });

  it("cannot be widened by any query parameter", () => {
    const where = buildPartyWhere(
      TENANT,
      query("q=acme&status=ACTIVE&reviewStatus=UNREVIEWED&roleType=SUPPLIER&needsRevalidation=true&sort=updatedAt&dir=asc&page=3")
    );
    expect(where.accountId).toBe(TENANT);
  });

  it("ignores an accountId supplied in the URL", () => {
    const where = buildPartyWhere(TENANT, query("accountId=acct_b&account=acct_b&tenantId=acct_b"));
    expect(where.accountId).toBe(TENANT);
    expect(JSON.stringify(where)).not.toContain("acct_b");
  });

  it("restricts to parties currently holding an active role of the given type", () => {
    const where = buildPartyWhere(TENANT, query("roleType=SUPPLIER"));
    expect(where.roles).toEqual({ some: { roleType: "SUPPLIER", status: "ACTIVE" } });
  });

  it("restricts to parties with at least one open revalidation flag", () => {
    const where = buildPartyWhere(TENANT, query("needsRevalidation=true"));
    expect(where.revalidationFlags).toEqual({ some: { status: "OPEN" } });
  });

  it("searches the internal code, active names, and active identifiers", () => {
    const where = buildPartyWhere(TENANT, query("q=Acme"));
    expect(where.OR).toContainEqual({ internalPartyCode: { contains: "Acme", mode: "insensitive" } });
    expect(where.OR).toContainEqual({
      names: { some: { rawName: { contains: "Acme", mode: "insensitive" }, status: "ACTIVE" } },
    });
  });

  it("finds a party by an identifier typed the way it is printed", () => {
    const where = buildPartyWhere(TENANT, query("q=de-123"));
    expect(where.OR).toContainEqual({
      identifiers: { some: { normalizedValue: { contains: "DE123" }, status: "ACTIVE" } },
    });
  });

  it("scopes parties by clientId when specified", () => {
    const exact = buildPartyWhere(TENANT, query("clientId=cli_123"));
    expect(exact.clientId).toBe("cli_123");

    const unassigned = buildPartyWhere(TENANT, query("clientId=unassigned"));
    expect(unassigned.clientId).toBeNull();

    const shared = buildPartyWhere(TENANT, query("clientId=cli_123&clientScope=include_shared"));
    expect(shared.clientId).toEqual({ in: ["cli_123", null] });
  });
});

describe("parsePartyQuery", () => {
  it("refuses a sort column outside the allowlist", () => {
    // The sort key becomes a Prisma orderBy field name, so an arbitrary string
    // would let a caller order by — and so probe — any column on the table.
    expect(query("sort=accountId").sort).toBe("updatedAt");
    expect(PARTY_SORT_COLUMNS).not.toContain("accountId" as never);
  });

  it("caps the page size", () => {
    expect(query("pageSize=100000").pageSize).toBe(PARTY_PAGE_SIZE_MAX);
  });

  it("treats any value other than 'true' as the flag being off", () => {
    expect(query("needsRevalidation=1").needsRevalidation).toBe(false);
    expect(query("needsRevalidation=yes").needsRevalidation).toBe(false);
  });

  it("skips whole pages, never a negative offset", () => {
    expect(partySkip(query("page=1"))).toBe(0);
    expect(partySkip(query("page=0"))).toBe(0);
    expect(partySkip(query("page=-4"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Source-level guarantees
//
// The isolation that matters most cannot be unit-tested against a fake,
// because the risk is a future query that simply forgets the filter. These
// scans read the shipped source and fail on the shape of that mistake.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const PARTY_API_DIR = join(process.cwd(), "src/app/api/parties");
const PARTY_MODULE_DIR = join(process.cwd(), "src/modules/party");

describe("party API routes", () => {
  const routes = sourceFiles(PARTY_API_DIR).filter((file) => file.endsWith("route.ts"));

  it("has routes to check", () => {
    expect(routes.length).toBeGreaterThan(15);
  });

  it("authenticates every route through the shared guard", () => {
    const unguarded = routes.filter((file) => !readFileSync(file, "utf8").includes("withAuthenticatedRoute"));
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

  it("never assigns accountId a literal string", () => {
    // partyActor(ctx, requestId) is the only constructor, and it reads
    // ctx.accountId. A route that built an actor literal could pick its own.
    const offenders = routes.filter((file) => /accountId:\s*["']/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("party request schemas", () => {
  it("have no accountId or tenantId field to send", () => {
    const schemas = readFileSync(join(PARTY_MODULE_DIR, "partySchemas.ts"), "utf8");
    // The word appears once, in the comment explaining why it is absent.
    expect(/accountId:\s*z\./.test(schemas)).toBe(false);
    expect(/tenantId/.test(schemas)).toBe(false);
  });
});

describe("party service queries", () => {
  const files = [join(PARTY_MODULE_DIR, "partyService.ts"), join(PARTY_MODULE_DIR, "partyImportService.ts")];

  it("only ever sets accountId from the actor", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/accountId:\s*([\w.]+)/g)) {
        const value = match[1];
        // "string" is the PartyActor type declaration; "accountId" is the
        // shorthand inside the one helper that takes it as a parameter.
        if (value !== "actor.accountId" && value !== "string" && value !== "accountId") {
          offenders.push(`${file}: accountId: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("filters child rows by account as well as by parent, so a foreign id cannot be reached through a party it does not belong to", () => {
    const service = readFileSync(files[0]!, "utf8");
    for (const child of [
      "nameId",
      "identifierId",
      "registrationId",
      "addressId",
      "contactId",
      "roleId",
      "siteId",
      "relationshipId",
      "flagId",
      "evidenceId",
    ]) {
      const pattern = new RegExp(`where:\\s*\\{[^}]*${child}[^}]*accountId: actor\\.accountId`);
      expect({ child, scoped: pattern.test(service) }).toEqual({ child, scoped: true });
    }
  });

  it("reports a party in another account as not found rather than forbidden", () => {
    // A 403 would confirm the id exists somewhere, which is itself a leak.
    const service = readFileSync(files[0]!, "utf8");
    expect(service).toContain('"PARTY_NOT_FOUND", 404');
    expect(/PARTY_NOT_FOUND[^)]*403/.test(service)).toBe(false);
  });
});
