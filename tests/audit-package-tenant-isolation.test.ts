import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Source-level guarantees for the audit-package surface.
//
// assembleReasonableCarePackage used to accept a bare shipmentId and resolve
// it with `findUnique`, so any authenticated user from any tenant could pull
// another tenant's reasonable-care package by guessing/enumerating shipment
// IDs. The unit-level fix is covered in tests/unit/reasonableCare.test.ts;
// these scans guard against a future call site reintroducing the same
// mistake by dropping the accountId argument.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const AUDIT_API_DIR = join(process.cwd(), "src/app/api/audit");
const AUDIT_LIB_DIR = join(process.cwd(), "src/lib/audit");

describe("audit-package library", () => {
  const reasonableCareSrc = readFileSync(join(AUDIT_LIB_DIR, "reasonableCarePackage.ts"), "utf8");

  it("resolves shipments with findFirst scoped by accountId, never findUnique by bare id", () => {
    expect(reasonableCareSrc).not.toMatch(/db\.shipment\.findUnique/);
    expect(reasonableCareSrc).toMatch(/db\.shipment\.findFirst\(\{\s*where:\s*\{\s*id:\s*shipmentId,\s*accountId/);
  });

  it("requires an accountId parameter before the shipmentId", () => {
    expect(reasonableCareSrc).toMatch(
      /export async function assembleReasonableCarePackage\(\s*accountId:\s*string,\s*shipmentId:\s*string/
    );
  });

  const focusedAssessmentSrc = readFileSync(join(AUDIT_LIB_DIR, "focusedAssessment.ts"), "utf8");

  it("resolves an importerOfRecordId scoped to accountId, never findUnique by bare id", () => {
    expect(focusedAssessmentSrc).not.toMatch(/db\.importerOfRecord\.findUnique/);
    expect(focusedAssessmentSrc).toMatch(
      /db\.importerOfRecord\.findFirst\(\{\s*where:\s*\{\s*id:\s*params\.importerOfRecordId,\s*accountId/
    );
  });
});

describe("audit-package API routes", () => {
  const routes = sourceFiles(AUDIT_API_DIR).filter((file) => file.endsWith("route.ts"));

  it("has routes to check", () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it("authenticates every route through the shared guard", () => {
    const unguarded = routes.filter((file) => !readFileSync(file, "utf8").includes("withAuthenticatedRoute"));
    expect(unguarded).toEqual([]);
  });

  it("never calls assembleReasonableCarePackage without an accountId argument", () => {
    const offenders: string[] = [];
    for (const file of routes) {
      const content = readFileSync(file, "utf8");
      if (!content.includes("assembleReasonableCarePackage(")) continue;
      for (const match of content.matchAll(/assembleReasonableCarePackage\(([^)]*)\)/g)) {
        const args = match[1].split(",").map((a) => a.trim());
        if (args.length < 2 || !/accountId/.test(args[0])) {
          offenders.push(`${file}: assembleReasonableCarePackage(${match[1]})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
