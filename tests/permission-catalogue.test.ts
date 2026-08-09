import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PERMISSION_CATALOGUE,
  PERMISSION_NAMES,
  catalogueCoverage,
  defaultPermissionsForRole,
  findPermission,
  roleGrantGap,
} from "@/lib/permissions";
import {
  syncPermissionCatalogue,
  type PermissionSyncStore,
} from "@/modules/admin/permissionSync";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

describe("the catalogue covers what the code actually checks", () => {
  it("names every permission string a gate is written against", () => {
    // A gate on a permission nobody catalogued is a gate nobody can satisfy,
    // because no sync will ever create the row it looks for.
    const patterns = [
      /hasPermission\(\s*["']([a-z][a-z_.]*)["']/g,
      /authorizeWrite\(\s*["']([a-z][a-z_.]*)["']/g,
      /authorizeRequest\(\s*["']([a-z][a-z_.]*)["']/g,
      /permissions\.includes\(\s*["']([a-z][a-z_.]*)["']/g,
    ];

    const gated = new Set<string>();
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const content = readFileSync(file, "utf8");
      for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) gated.add(match[1]);
      }
    }

    expect(gated.size).toBeGreaterThan(0);
    const uncatalogued = [...gated].filter((name) => !PERMISSION_NAMES.includes(name));
    expect(uncatalogued).toEqual([]);
  });

  it("names the permissions the navigation gates on", () => {
    const navSource = readFileSync(join(process.cwd(), "src/lib/navigation.ts"), "utf8");
    const navPermissions = [...navSource.matchAll(/permission:\s*["']([a-z][a-z_.]*)["']/g)].map(
      (m) => m[1]
    );

    expect(navPermissions.length).toBeGreaterThan(0);
    for (const name of navPermissions) {
      expect(PERMISSION_NAMES).toContain(name);
    }
  });

  it("gives every permission a description a person can act on", () => {
    for (const definition of PERMISSION_CATALOGUE) {
      expect(definition.description.trim().length).toBeGreaterThan(20);
      expect(definition.description.endsWith(".")).toBe(true);
    }
  });

  it("has no duplicate names", () => {
    expect(new Set(PERMISSION_NAMES).size).toBe(PERMISSION_NAMES.length);
  });

  it("does not give a viewer anything that changes a record", () => {
    const viewerHolds = defaultPermissionsForRole("VIEWER");
    for (const name of viewerHolds) {
      const definition = findPermission(name);
      expect(definition?.category).toBe("Intelligence");
    }
  });

  it("does not hand risk acceptance to every role that can write", () => {
    expect(defaultPermissionsForRole("MEMBER")).not.toContain("exceptions.waive");
    expect(defaultPermissionsForRole("MEMBER")).not.toContain("filings.submit");
    expect(defaultPermissionsForRole("ADMIN")).toContain("exceptions.waive");
  });
});

describe("catalogue coverage", () => {
  it("reports a permission the code checks but the database does not hold", () => {
    const coverage = catalogueCoverage(["account.manage"]);

    expect(coverage.seeded).toBe(1);
    expect(coverage.total).toBe(PERMISSION_NAMES.length);
    expect(coverage.missing).toContain("exceptions.waive");
    expect(coverage.missing).not.toContain("account.manage");
  });

  it("reports a stored permission that no code checks, because granting it does nothing", () => {
    const coverage = catalogueCoverage([...PERMISSION_NAMES, "legacy.thing"]);

    expect(coverage.missing).toEqual([]);
    expect(coverage.unknown).toEqual(["legacy.thing"]);
  });

  it("calls an empty database empty rather than complete", () => {
    const coverage = catalogueCoverage([]);

    expect(coverage.seeded).toBe(0);
    expect(coverage.missing).toEqual([...PERMISSION_NAMES]);
  });
});

describe("role grant gap", () => {
  it("names the defaults a role has not been granted", () => {
    const gap = roleGrantGap("ADMIN", ["users.manage"]);

    expect(gap.missing).toContain("decisions.approve");
    expect(gap.missing).not.toContain("users.manage");
  });

  it("reports a grant beyond the defaults without calling it wrong", () => {
    const gap = roleGrantGap("VIEWER", ["intel.read", "filings.submit"]);

    expect(gap.extra).toEqual(["filings.submit"]);
    expect(gap.missing).toEqual([]);
  });

  it("reads a role name whatever case it was stored in", () => {
    expect(roleGrantGap("admin", []).missing).toEqual(defaultPermissionsForRole("ADMIN"));
  });
});

describe("syncing the catalogue", () => {
  let created: { name: string; description: string }[];
  let granted: { roleId: string; permissionId: string }[];
  let descriptions: string[];

  function store(overrides: Partial<PermissionSyncStore> = {}): PermissionSyncStore {
    return {
      listPermissions: async () => [],
      createPermission: async (input) => {
        created.push(input);
        return { id: `perm_${input.name}`, name: input.name };
      },
      updatePermissionDescription: async (id) => {
        descriptions.push(id);
      },
      listSystemRoles: async () => [
        { id: "role_owner", name: "OWNER" },
        { id: "role_admin", name: "ADMIN" },
        { id: "role_member", name: "MEMBER" },
        { id: "role_viewer", name: "VIEWER" },
      ],
      listGrants: async () => [],
      grant: async (roleId, permissionId) => {
        granted.push({ roleId, permissionId });
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    created = [];
    granted = [];
    descriptions = [];
    vi.clearAllMocks();
  });

  it("creates every catalogued permission on an empty database", async () => {
    const result = await syncPermissionCatalogue(store());

    expect(result.permissionsCreated).toEqual([...PERMISSION_NAMES]);
    expect(created.map((c) => c.name)).toEqual([...PERMISSION_NAMES]);
  });

  it("grants each role exactly its defaults", async () => {
    await syncPermissionCatalogue(store());

    const adminGrants = granted
      .filter((g) => g.roleId === "role_admin")
      .map((g) => g.permissionId.replace("perm_", ""))
      .sort();
    expect(adminGrants).toEqual([...defaultPermissionsForRole("ADMIN")].sort());

    const viewerGrants = granted
      .filter((g) => g.roleId === "role_viewer")
      .map((g) => g.permissionId.replace("perm_", ""));
    expect(viewerGrants).toEqual(defaultPermissionsForRole("VIEWER"));
  });

  it("creates nothing and grants nothing on a second run", async () => {
    const existing = PERMISSION_NAMES.map((name) => ({ id: `perm_${name}`, name }));
    const result = await syncPermissionCatalogue(
      store({
        listPermissions: async () => existing,
        listGrants: async (roleId) => {
          const roleName = roleId.replace("role_", "").toUpperCase();
          return defaultPermissionsForRole(roleName).map((name) => `perm_${name}`);
        },
      })
    );

    expect(result.permissionsCreated).toEqual([]);
    expect(result.grantsAdded).toEqual([]);
    expect(granted).toEqual([]);
  });

  it("adds only the grant that is missing, not the whole set again", async () => {
    const existing = PERMISSION_NAMES.map((name) => ({ id: `perm_${name}`, name }));
    const result = await syncPermissionCatalogue(
      store({
        listPermissions: async () => existing,
        listSystemRoles: async () => [{ id: "role_admin", name: "ADMIN" }],
        listGrants: async () =>
          defaultPermissionsForRole("ADMIN")
            .slice(1)
            .map((name) => `perm_${name}`),
      })
    );

    expect(result.grantsAdded).toEqual([
      { roleName: "ADMIN", permission: defaultPermissionsForRole("ADMIN")[0] },
    ]);
  });

  it("says which roles the catalogue expects but the database does not have", async () => {
    const result = await syncPermissionCatalogue(
      store({ listSystemRoles: async () => [{ id: "role_owner", name: "OWNER" }] })
    );

    expect(result.rolesMissing).toEqual(["ADMIN", "MEMBER", "VIEWER"]);
  });

  it("leaves custom account roles alone, because a sync must not widen them", async () => {
    // listSystemRoles is the only source of roles, so a custom role can never be
    // granted anything by this path.
    const result = await syncPermissionCatalogue(
      store({ listSystemRoles: async () => [{ id: "role_admin", name: "ADMIN" }] })
    );

    expect(result.rolesConsidered).toEqual(["ADMIN"]);
    expect(granted.every((g) => g.roleId === "role_admin")).toBe(true);
  });
});
