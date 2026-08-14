"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, TriangleAlert, Users, RefreshCw } from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";
import type { FormattedRole, RolesPermissionsData } from "@/lib/admin/rolesData";

interface RolesPermissionsPanelProps extends RolesPermissionsData {
  accountName: string;
  compact?: boolean;
}

export function SyncPermissionsButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/permissions/sync", { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        alert("Failed to sync permission catalogue");
      }
    } catch (err) {
      console.error("Error syncing permissions", err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <button
      type="button"
      disabled={syncing}
      onClick={handleSync}
      className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-border bg-white hover:bg-surface-muted text-ink text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
      title="Sync system permission catalogue and grant default role permissions"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin text-brand" : ""}`} />
      <span>{syncing ? "Syncing..." : "Sync Permissions"}</span>
    </button>
  );
}

function RoleCard({ role }: { role: FormattedRole }) {
  return (
    <section className="rounded-2xl bg-white border border-border p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-ink">{role.name}</h2>
        <span className="px-2 py-0.5 rounded-full border border-border text-[11px] font-semibold text-[#6E6E73]">
          {role.isSystem ? "System" : "Custom"}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          {role.memberCount} {role.memberCount === 1 ? "member" : "members"} in this account
        </span>
      </div>

      {role.description && <p className="text-sm text-[#6E6E73]">{role.description}</p>}

      {role.granted.length === 0 ? (
        <p className="text-sm text-ink-muted">
          This role holds no permissions. Members who only hold it can read what the app shows
          them and nothing more.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {role.granted.map((permission) => (
            <li key={permission.name} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="font-mono text-xs text-ink">{permission.name}</span>
              <span className="text-ink-muted">{permission.description}</span>
            </li>
          ))}
        </ul>
      )}

      {role.gapMissing && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Not granted the catalogue defaults for {role.name}:{" "}
            <span className="font-mono">{role.gapMissing.join(", ")}</span>
          </span>
        </div>
      )}
    </section>
  );
}

export function RolesPermissionsPanel({
  accountName,
  coverage,
  roles,
  permissionCatalogue,
  compact,
}: RolesPermissionsPanelProps) {
  return (
    <div className={compact ? "space-y-5" : "space-y-8 max-w-6xl mx-auto"}>
      {compact ? (
        <PanelHeading
          icon={ShieldCheck}
          badge="Roles & Permissions"
          title="Role Definitions"
          subtitle={`What each role in ${accountName} is allowed to do. Read-only here.`}
          compact
        />
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-brand text-xs font-semibold mb-3">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Roles & Permissions</span>
            </div>
            <h1 className="text-3xl font-extrabold text-ink tracking-tight">Role Definitions</h1>
            <p className="text-ink-muted text-sm mt-1">
              What each role in {accountName} is allowed to do. Grants are read-only here —
              assign roles to people from{" "}
              <Link href="/app/admin/users" className="font-semibold text-brand">
                User Management
              </Link>
              .
            </p>
          </div>
          <SyncPermissionsButton />
        </div>
      )}

      {coverage.missing.length > 0 && (
        <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            {coverage.missing.length} of {coverage.total} catalogued permissions have no row in the
            database.
          </p>
          <p className="mt-1">
            No role can hold them, so every gate on them denies everyone except OWNER and platform
            admins — regardless of how roles are configured. Missing:{" "}
            <span className="font-mono">{coverage.missing.join(", ")}</span>
          </p>
        </div>
      )}

      {coverage.unknown.length > 0 && (
        <div role="status" className="rounded-2xl bg-white border border-border p-4 text-sm text-[#6E6E73]">
          Permission rows that are no longer in the catalogue:{" "}
          <span className="font-mono">{coverage.unknown.join(", ")}</span>
        </div>
      )}

      <div className="space-y-4">
        {roles.map((role) => (
          <RoleCard key={role.id} role={role} />
        ))}
      </div>

      <section className="rounded-2xl bg-white border border-border p-5 space-y-3">
        <h2 className="text-lg font-bold text-ink">Permission catalogue</h2>
        <p className="text-sm text-[#6E6E73]">
          Every permission this application gates on, and the roles that receive it when the
          catalogue is synced. {coverage.seeded} of {coverage.total} exist in the database.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                <th className="py-2 pr-4">Permission</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Default roles</th>
                <th className="py-2">What it allows</th>
              </tr>
            </thead>
            <tbody>
              {permissionCatalogue.map((permission) => (
                <tr key={permission.name} className="border-t border-border align-top">
                  <td className="py-2 pr-4 font-mono text-xs text-ink whitespace-nowrap">
                    {permission.name}
                  </td>
                  <td className="py-2 pr-4 text-[#6E6E73] whitespace-nowrap">{permission.category}</td>
                  <td className="py-2 pr-4 text-[#6E6E73] whitespace-nowrap">
                    {permission.defaultRoles.join(", ")}
                  </td>
                  <td className="py-2 text-[#6E6E73]">{permission.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
