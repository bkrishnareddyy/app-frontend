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

export const SYSTEM_ROLES = ["OWNER", "ADMIN", "BROKER", "SPECIALIST", "REVIEWER", "MEMBER", "VIEWER"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export interface PermissionDefinition {
  name: string;
  /** What holding it lets a person do, in the words the admin screen shows. */
  description: string;
  /** Grouping for display only. */
  category: "Account" | "Documents" | "Decisions" | "Filing" | "Compliance" | "Intelligence" | "Products" | "Parties";
  /** Roles that receive it when the catalogue is synced. */
  defaultRoles: readonly SystemRole[];
}

const ALL_BUT_VIEWER: readonly SystemRole[] = ["OWNER", "ADMIN", "BROKER", "SPECIALIST", "MEMBER"];
const ADMIN_ONLY: readonly SystemRole[] = ["OWNER", "ADMIN"];

export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = [
  // ─── Account ────────────────────────────────────────────────────────────
  {
    name: "account.manage",
    description: "Change account settings and company details.",
    category: "Account",
    defaultRoles: ["OWNER"],
  },
  {
    name: "roles.manage",
    description: "Create and edit custom roles and their permission sets.",
    category: "Account",
    defaultRoles: ["OWNER"],
  },
  {
    name: "users.read",
    description: "View team members and their roles.",
    category: "Account",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
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
  // ─── Documents ──────────────────────────────────────────────────────────
  {
    name: "documents.read",
    description: "View uploaded documents and their extracted data.",
    category: "Documents",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "documents.create",
    description: "Upload documents and submit them for processing.",
    category: "Documents",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "documents.delete",
    description: "Permanently remove a document and its extractions.",
    category: "Documents",
    defaultRoles: ADMIN_ONLY,
  },
  // ─── Shipments ──────────────────────────────────────────────────────────
  {
    name: "shipments.read",
    description: "View shipments and their details.",
    category: "Documents",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "shipments.create",
    description: "Create new shipments.",
    category: "Documents",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "shipments.manage",
    description: "Edit shipment data, reassign brokers, and change status.",
    category: "Documents",
    defaultRoles: ALL_BUT_VIEWER,
  },
  // ─── Classification ─────────────────────────────────────────────────────
  {
    name: "classification.read",
    description: "View classification cases and their proposals.",
    category: "Decisions",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "classification.create",
    description: "Open new classification cases and trigger classification runs.",
    category: "Decisions",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "classification.approve",
    description: "Approve a proposed HTS classification, making it the position of record.",
    category: "Decisions",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "classification.override",
    description: "Replace a proposed classification with a different code.",
    category: "Decisions",
    defaultRoles: ADMIN_ONLY,
  },
  // ─── Decisions ──────────────────────────────────────────────────────────
  {
    name: "decisions.review",
    description: "View agent decisions requiring human review.",
    category: "Decisions",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
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
  // ─── Exceptions / Risk ──────────────────────────────────────────────────
  {
    name: "exceptions.read",
    description: "View open exceptions and their details.",
    category: "Compliance",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "exceptions.resolve",
    description: "Mark an exception as resolved after the underlying issue is fixed.",
    category: "Compliance",
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
    name: "risk.accept",
    description: "Accept and acknowledge a compliance risk on behalf of the account.",
    category: "Compliance",
    defaultRoles: ADMIN_ONLY,
  },
  // ─── Filing ─────────────────────────────────────────────────────────────
  {
    name: "filing.read",
    description: "View customs filings and their statuses.",
    category: "Filing",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "filings.create",
    description: "Create new customs filing records.",
    category: "Filing",
    defaultRoles: ALL_BUT_VIEWER,
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
  // ─── Drawback ───────────────────────────────────────────────────────────
  {
    name: "drawback.read",
    description: "View drawback lots and claim history.",
    category: "Filing",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "drawback.claim",
    description: "Create and file drawback claims.",
    category: "Filing",
    defaultRoles: ALL_BUT_VIEWER,
  },
  // ─── Refunds ────────────────────────────────────────────────────────────
  {
    name: "refunds.read",
    description: "View duty refund opportunities and PSC records.",
    category: "Filing",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "refunds.manage",
    description: "Create and manage duty refund claims.",
    category: "Filing",
    defaultRoles: ADMIN_ONLY,
  },
  // ─── Audits ─────────────────────────────────────────────────────────────
  {
    name: "audits.read",
    description: "View compliance audit records and findings.",
    category: "Compliance",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "audits.run",
    description: "Trigger a new compliance audit against shipments or filings.",
    category: "Compliance",
    defaultRoles: ALL_BUT_VIEWER,
  },
  // ─── Regulatory ─────────────────────────────────────────────────────────
  {
    name: "regulatory.read",
    description: "View regulatory updates and their impact analyses.",
    category: "Compliance",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "regulatory.review",
    description: "Mark a regulatory update as reviewed and assign follow-up actions.",
    category: "Compliance",
    defaultRoles: ADMIN_ONLY,
  },
  // ─── Intelligence ───────────────────────────────────────────────────────
  {
    name: "intel.read",
    description: "Query trade intelligence and advisory sources.",
    category: "Intelligence",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "ai.use",
    description: "Use AI-assisted features including the assistant chat and analysis tools.",
    category: "Intelligence",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  // ─── Products ───────────────────────────────────────────────────────────
  {
    name: "products.read",
    description: "View products in the item master.",
    category: "Products",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "products.manage",
    description: "Perform all product operations: create, edit, import, and classify.",
    category: "Products",
    defaultRoles: ADMIN_ONLY,
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
  // ─── Parties ────────────────────────────────────────────────────────────
  {
    name: "parties.read",
    description: "View parties in the party master.",
    category: "Parties",
    defaultRoles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  },
  {
    name: "parties.manage",
    description: "Perform all party operations: create, edit, import, and approve.",
    category: "Parties",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "parties.create",
    description: "Add a party to the party master.",
    category: "Parties",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "parties.edit",
    description: "Change a party's names, identifiers, registrations, addresses, contacts, roles and relationships.",
    category: "Parties",
    defaultRoles: ALL_BUT_VIEWER,
  },
  {
    name: "parties.import",
    description: "Import parties in bulk from a spreadsheet.",
    category: "Parties",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "parties.review.approve",
    description: "Approve a party's master data, making it the reviewed record of who this party is.",
    category: "Parties",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "parties.registration.verify",
    description: "Mark a party's registration as verified against its evidence.",
    category: "Parties",
    defaultRoles: ADMIN_ONLY,
  },
  {
    name: "parties.revalidation.resolve",
    description: "Close a party revalidation flag after looking again. This is not a screening result.",
    category: "Parties",
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
