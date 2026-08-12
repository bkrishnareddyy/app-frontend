/**
 * The permission catalogue.
 *
 * Every permission this codebase gates on is listed here, next to the role names
 * that should hold it by default. Until now the only place these strings existed
 * was inside the route that checked them, and the only place Permission rows were
 * ever created was a demo script. The result was a gate that denied everyone
 * except OWNER and platform admins, which hasPermission() bypasses — so the
 * checks looked enforced and were in practice unreachable.
 *
 * This module is data, not behaviour. It performs no database access so it can be
 * read by a page, a route, a script and a test alike.
 */

export const SYSTEM_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export interface PermissionDefinition {
  name: string;
  /** What holding it lets a person do, in the words the admin screen shows. */
  description: string;
  /** Grouping for display only. */
  category: "Account" | "Documents" | "Decisions" | "Filing" | "Compliance" | "Intelligence" | "Products";
  /** Roles that receive it when the catalogue is synced. */
  defaultRoles: readonly SystemRole[];
}

const ALL_BUT_VIEWER: readonly SystemRole[] = ["OWNER", "ADMIN", "MEMBER"];
const ADMIN_ONLY: readonly SystemRole[] = ["OWNER", "ADMIN"];

export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = [
  {
    name: "account.manage",
    description: "Change account settings and company details.",
    category: "Account",
    defaultRoles: ["OWNER"],
  },
  {
    name: "users.manage",
    description: "Invite people, change their role, and deactivate them.",
    category: "Account",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "settings.manage",
    description: "Change workspace configuration and integrations.",
    category: "Account",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "documents.create",
    description: "Upload documents and submit them for processing.",
    category: "Documents",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "decisions.approve",
    description: "Approve an agent decision, making it the record of the entry.",
    category: "Decisions",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "decisions.reject",
    description: "Reject an agent decision and send it back.",
    category: "Decisions",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "decisions.reevaluate",
    description: "Run an agent again over the same shipment.",
    category: "Decisions",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "decisions.override",
    description:
      "Replace a proposed classification with a different one. This is the broker's call, not the model's.",
    category: "Decisions",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "filings.submit",
    description: "Transmit an entry to customs.",
    category: "Filing",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "bonds.manage",
    description: "Record and amend customs bonds.",
    category: "Filing",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "drawback.claim",
    description: "Create and file drawback claims.",
    category: "Filing",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "exceptions.waive",
    description:
      "Close an exception without the underlying problem being fixed. This accepts the risk it describes.",
    category: "Compliance",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "intel.read",
    description: "Query trade intelligence and advisory sources.",
    category: "Intelligence",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "products.create",
    description: "Add a product to the item master.",
    category: "Products",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "products.edit",
    description: "Change a product's descriptions, attributes, composition, parties and country facts.",
    category: "Products",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "products.import",
    description: "Import products in bulk from a spreadsheet.",
    category: "Products",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "products.classification.approve",
    description: "Approve a product's tariff classification for a jurisdiction, making it the position of record.",
    category: "Products",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "products.origin.verify",
    description: "Mark a product's claimed country of origin as verified against its evidence.",
    category: "Products",
    defaultRoles: ADMIN_ONLY,
  },
] as const;

export const PERMISSION_NAMES: readonly string[] = PERMISSION_CATALOGUE.map((p) => p.name);

export function findPermission(name: string): PermissionDefinition | null {
  return PERMISSION_CATALOGUE.find((p) => p.name === name) ?? null;
}

/** The permission names a system role should hold once the catalogue is synced. */
export function defaultPermissionsForRole(roleName: string): string[] {
  const role = roleName.toUpperCase() as SystemRole;
  return PERMISSION_CATALOGUE.filter((p) => p.defaultRoles.includes(role)).map((p) => p.name);
}

export interface CatalogueCoverage {
  /** Catalogued permissions with no Permission row, so no role can hold them. */
  missing: string[];
  /** Permission rows that no longer appear in the catalogue. */
  unknown: string[];
  seeded: number;
  total: number;
}

/**
 * Compares the catalogue against the Permission rows that exist. Reported so an
 * administrator can see that a gate denies everyone because the permission was
 * never created, rather than because their role is wrong.
 */
export function catalogueCoverage(existingNames: readonly string[]): CatalogueCoverage {
  const existing = new Set(existingNames);
  const catalogued = new Set(PERMISSION_NAMES);
  return {
    missing: PERMISSION_NAMES.filter((name) => !existing.has(name)),
    unknown: [...existing].filter((name) => !catalogued.has(name)).sort(),
    seeded: PERMISSION_NAMES.filter((name) => existing.has(name)).length,
    total: PERMISSION_NAMES.length,
  };
}

export interface RoleGrantGap {
  roleName: string;
  /** Default permissions the role does not currently hold. */
  missing: string[];
  /** Permissions the role holds that are not in its defaults. Not an error. */
  extra: string[];
}

export function roleGrantGap(roleName: string, granted: readonly string[]): RoleGrantGap {
  const defaults = defaultPermissionsForRole(roleName);
  const held = new Set(granted);
  const defaultSet = new Set(defaults);
  return {
    roleName,
    missing: defaults.filter((name) => !held.has(name)),
    extra: [...held].filter((name) => !defaultSet.has(name)).sort(),
  };
}
