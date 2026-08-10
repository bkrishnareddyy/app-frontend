import { PERMISSION_CATALOGUE, type PermissionDefinition } from "@/lib/permissions";

/**
 * Creates the Permission rows the catalogue names, and grants each system role
 * its defaults. Idempotent: running it twice grants nothing the second time.
 *
 * Split from the route so it can be exercised without a database, and so the
 * seed script and the admin action cannot drift apart.
 */

export interface PermissionRow {
  id: string;
  name: string;
}

export interface RoleRow {
  id: string;
  name: string;
}

export interface PermissionSyncStore {
  listPermissions(): Promise<PermissionRow[]>;
  createPermission(input: { name: string; description: string }): Promise<PermissionRow>;
  updatePermissionDescription(id: string, description: string): Promise<void>;
  /** System roles only. Custom account roles are never touched by a sync. */
  listSystemRoles(): Promise<RoleRow[]>;
  listGrants(roleId: string): Promise<string[]>;
  grant(roleId: string, permissionId: string): Promise<void>;
}

export interface PermissionSyncResult {
  permissionsCreated: string[];
  descriptionsUpdated: string[];
  grantsAdded: { roleName: string; permission: string }[];
  rolesConsidered: string[];
  /** Roles named in the catalogue defaults that do not exist as a Role row. */
  rolesMissing: string[];
}

function defaultsFor(roleName: string): PermissionDefinition[] {
  const upper = roleName.toUpperCase();
  return PERMISSION_CATALOGUE.filter((p) =>
    (p.defaultRoles as readonly string[]).includes(upper)
  );
}

export async function syncPermissionCatalogue(
  store: PermissionSyncStore
): Promise<PermissionSyncResult> {
  const existing = await store.listPermissions();
  const byName = new Map(existing.map((row) => [row.name, row]));

  const permissionsCreated: string[] = [];
  const descriptionsUpdated: string[] = [];

  for (const definition of PERMISSION_CATALOGUE) {
    const found = byName.get(definition.name);
    if (found) {
      // The description is what the admin screen shows a person; keeping it in
      // step with the catalogue is the point of storing it at all.
      await store.updatePermissionDescription(found.id, definition.description);
      descriptionsUpdated.push(definition.name);
      continue;
    }
    const created = await store.createPermission({
      name: definition.name,
      description: definition.description,
    });
    byName.set(created.name, created);
    permissionsCreated.push(created.name);
  }

  const roles = await store.listSystemRoles();
  const roleNames = new Set(roles.map((r) => r.name.toUpperCase()));
  const grantsAdded: { roleName: string; permission: string }[] = [];

  for (const role of roles) {
    const held = new Set(await store.listGrants(role.id));
    for (const definition of defaultsFor(role.name)) {
      const permission = byName.get(definition.name);
      if (!permission || held.has(permission.id)) continue;
      await store.grant(role.id, permission.id);
      grantsAdded.push({ roleName: role.name, permission: definition.name });
    }
  }

  const namedInCatalogue = new Set<string>();
  for (const definition of PERMISSION_CATALOGUE) {
    for (const roleName of definition.defaultRoles) namedInCatalogue.add(roleName);
  }

  return {
    permissionsCreated,
    descriptionsUpdated,
    grantsAdded,
    rolesConsidered: roles.map((r) => r.name),
    rolesMissing: [...namedInCatalogue].filter((name) => !roleNames.has(name)).sort(),
  };
}

export const databasePermissionSyncStore: PermissionSyncStore = {
  async listPermissions() {
    const { db } = await import("@/lib/db");
    return db.permission.findMany({ select: { id: true, name: true } });
  },
  async createPermission(input) {
    const { db } = await import("@/lib/db");
    return db.permission.create({ data: input, select: { id: true, name: true } });
  },
  async updatePermissionDescription(id, description) {
    const { db } = await import("@/lib/db");
    await db.permission.update({ where: { id }, data: { description } });
  },
  async listSystemRoles() {
    const { db } = await import("@/lib/db");
    return db.role.findMany({ where: { isSystem: true }, select: { id: true, name: true } });
  },
  async listGrants(roleId) {
    const { db } = await import("@/lib/db");
    const rows = await db.rolePermission.findMany({
      where: { roleId },
      select: { permissionId: true },
    });
    return rows.map((r) => r.permissionId);
  },
  async grant(roleId, permissionId) {
    const { db } = await import("@/lib/db");
    await db.rolePermission.create({ data: { roleId, permissionId } });
  },
};
