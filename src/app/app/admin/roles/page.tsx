import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessHref } from "@/lib/navigation";
import {
  PERMISSION_CATALOGUE,
  catalogueCoverage,
  roleGrantGap,
} from "@/lib/permissions";
import { PermissionSyncButton } from "./PermissionSyncButton";
import { ShieldCheck, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Roles and permissions, as they actually are.
 *
 * The gates in the API check Permission rows that, in a fresh account, nobody
 * ever created. The effect was that every non-owner was denied and nothing said
 * why. This page names each permission, says whether it exists, and says which
 * roles hold it.
 */
export default async function RolesAdminPage() {
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");
  if (!canAccessHref(context, "/app/admin/roles")) redirect("/app/work");

  const [permissions, roles] = await Promise.all([
    db.permission.findMany({ select: { id: true, name: true, description: true } }),
    db.role.findMany({
      where: { OR: [{ isSystem: true }, { accountId: context.accountId }] },
      select: {
        id: true,
        name: true,
        isSystem: true,
        rolePermissions: { select: { permission: { select: { name: true } } } },
        _count: { select: { membershipRoles: true } },
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    }),
  ]);

  const coverage = catalogueCoverage(permissions.map((p) => p.name));
  const grantsByRole = new Map(
    roles.map((role) => [role.id, role.rolePermissions.map((rp) => rp.permission.name)])
  );
  const holdersOf = new Map<string, string[]>();
  for (const role of roles) {
    for (const name of grantsByRole.get(role.id) ?? []) {
      holdersOf.set(name, [...(holdersOf.get(name) ?? []), role.name]);
    }
  }

  // Owners bypass every permission check, so only an owner can bootstrap.
  const canSync = context.isPlatformAdmin || context.roleNames.includes("OWNER");

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div>
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#0071E3] text-xs font-semibold mb-3">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Roles and permissions</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[#1D1D1F] tracking-tight">
          Roles and permissions
        </h1>
        <p className="text-[#86868B] text-sm mt-1">
          What each role in {context.accountName} is allowed to do, and which permissions
          the API actually checks.
        </p>
      </div>

      {coverage.missing.length > 0 && (
        <section
          aria-labelledby="catalogue-gap-heading"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-3"
        >
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-700" aria-hidden="true" />
            <h2 id="catalogue-gap-heading" className="text-sm font-bold text-amber-900">
              {coverage.missing.length} of {coverage.total} permissions do not exist yet
            </h2>
          </div>
          <p className="text-sm text-amber-900">
            The API checks these names before allowing the action they describe. No
            permission row carries them, so no role can hold them, and every request is
            refused for everyone except account owners and platform administrators, who
            bypass the check. This is why those actions appear to be denied without a
            reason.
          </p>
          <ul className="text-sm text-amber-900 font-mono flex flex-wrap gap-x-4 gap-y-1">
            {coverage.missing.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <PermissionSyncButton canSync={canSync} />
        </section>
      )}

      {coverage.missing.length === 0 && (
        <p
          role="status"
          className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900"
        >
          All {coverage.total} permissions the API checks exist in this database.
        </p>
      )}

      <section aria-labelledby="roles-heading" className="space-y-4">
        <h2
          id="roles-heading"
          className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]"
        >
          Roles ({roles.length})
        </h2>

        {roles.length === 0 ? (
          <p className="text-sm text-[#6E6E73]">No roles exist in this database.</p>
        ) : (
          <ul className="space-y-3">
            {roles.map((role) => {
              const granted = grantsByRole.get(role.id) ?? [];
              const gap = roleGrantGap(role.name, granted);
              return (
                <li
                  key={role.id}
                  className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-bold text-[#1D1D1F]">
                      {role.name}
                      <span className="ml-2 text-xs font-semibold text-[#86868B]">
                        {role.isSystem ? "System role" : "Custom role"}
                      </span>
                    </h3>
                    <p className="text-sm text-[#6E6E73]">
                      {role._count.membershipRoles}{" "}
                      {role._count.membershipRoles === 1 ? "member" : "members"} ·{" "}
                      {granted.length}{" "}
                      {granted.length === 1 ? "permission" : "permissions"} held
                    </p>
                  </div>

                  {granted.length === 0 ? (
                    <p className="text-sm text-[#6E6E73]">
                      This role holds no permissions. Members of it are refused every
                      gated action.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-mono text-[#1D1D1F]">
                      {[...granted].sort().map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  )}

                  {role.isSystem && gap.missing.length > 0 && (
                    <p className="text-sm text-amber-800">
                      Not yet granted the defaults for this role:{" "}
                      <span className="font-mono">{gap.missing.join(", ")}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="catalogue-heading" className="space-y-4">
        <h2
          id="catalogue-heading"
          className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]"
        >
          Permissions the API checks ({coverage.total})
        </h2>
        <div className="overflow-x-auto bg-white rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Every permission checked by the API, what it allows, and which roles hold it
            </caption>
            <thead className="bg-[#F5F5F7] text-left text-xs uppercase tracking-wider text-[#6E6E73]">
              <tr>
                <th scope="col" className="py-3 px-4">
                  Permission
                </th>
                <th scope="col" className="py-3 px-4">
                  What it allows
                </th>
                <th scope="col" className="py-3 px-4">
                  Held by
                </th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_CATALOGUE.map((definition) => {
                const holders = holdersOf.get(definition.name) ?? [];
                const exists = !coverage.missing.includes(definition.name);
                return (
                  <tr key={definition.name} className="border-t border-[#E5E5EA] align-top">
                    <td className="py-3 px-4 font-mono text-[#1D1D1F]">
                      {definition.name}
                      <span className="block text-xs font-sans text-[#86868B]">
                        {definition.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[#6E6E73]">{definition.description}</td>
                    <td className="py-3 px-4">
                      {!exists ? (
                        <span className="text-amber-800">
                          Not created, so no role can hold it
                        </span>
                      ) : holders.length === 0 ? (
                        <span className="text-[#86868B]">No role holds it</span>
                      ) : (
                        [...new Set(holders)].sort().join(", ")
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {coverage.unknown.length > 0 && (
          <p className="text-sm text-[#6E6E73]">
            {coverage.unknown.length} permission{coverage.unknown.length === 1 ? "" : "s"}{" "}
            exist in the database that no code checks:{" "}
            <span className="font-mono">{coverage.unknown.join(", ")}</span>. Granting one
            has no effect.
          </p>
        )}
      </section>
    </div>
  );
}
