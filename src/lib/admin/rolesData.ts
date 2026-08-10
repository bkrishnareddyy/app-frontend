import { db } from "@/lib/db";
import type { AccountContext } from "@/lib/auth";
import {
  PERMISSION_CATALOGUE,
  SYSTEM_ROLES,
  catalogueCoverage,
  findPermission,
  roleGrantGap,
  type CatalogueCoverage,
  type SystemRole,
} from "@/lib/permissions";

function isSystemRole(name: string): name is SystemRole {
  return (SYSTEM_ROLES as readonly string[]).includes(name.toUpperCase());
}

export interface FormattedRole {
  id: string;
  name: string;
  isSystem: boolean;
  description: string | null;
  memberCount: number;
  granted: Array<{ name: string; description: string }>;
  gapMissing: string[] | null;
}

export interface RolesPermissionsData {
  coverage: CatalogueCoverage;
  roles: FormattedRole[];
  permissionCatalogue: typeof PERMISSION_CATALOGUE;
}

export async function getRolesPermissionsData(ctx: AccountContext): Promise<RolesPermissionsData> {
  const [roles, permissionRows, membershipRoles] = await Promise.all([
    db.role.findMany({
      where: { OR: [{ accountId: ctx.accountId }, { accountId: null }] },
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    }),
    db.permission.findMany({ select: { name: true } }),
    // Counted through this account's memberships: a system role row is shared
    // across accounts, so its own relation count would include other tenants.
    db.accountMembershipRole.findMany({
      where: { accountMembership: { accountId: ctx.accountId } },
      select: { roleId: true },
    }),
  ]);

  const holders = new Map<string, number>();
  for (const row of membershipRoles) {
    holders.set(row.roleId, (holders.get(row.roleId) ?? 0) + 1);
  }

  const coverage = catalogueCoverage(permissionRows.map((p) => p.name));

  const formattedRoles: FormattedRole[] = roles.map((role) => {
    const granted = role.rolePermissions.map((rp) => rp.permission.name).sort();
    const gap = isSystemRole(role.name) ? roleGrantGap(role.name.toUpperCase(), granted) : null;

    return {
      id: role.id,
      name: role.name,
      isSystem: role.accountId === null,
      description: role.description,
      memberCount: holders.get(role.id) ?? 0,
      granted: granted.map((name) => ({
        name,
        description: findPermission(name)?.description ?? "Not in the catalogue.",
      })),
      gapMissing: gap && gap.missing.length > 0 ? gap.missing : null,
    };
  });

  return { coverage, roles: formattedRoles, permissionCatalogue: PERMISSION_CATALOGUE };
}
