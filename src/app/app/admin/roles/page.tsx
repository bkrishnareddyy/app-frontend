import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { getRolesPermissionsData } from "@/lib/admin/rolesData";
import { RolesPermissionsPanel } from "./RolesPermissionsPanel";

export const dynamic = "force-dynamic";

export default async function AdminRolesPage() {
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  if (!(await hasPermission("users.manage"))) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3">
        <ShieldCheck className="w-8 h-8 mx-auto text-ink-muted" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-ink">Roles are not visible to you</h1>
        <p className="text-sm text-ink-muted">
          Viewing role definitions and permission grants requires the users.manage permission.
        </p>
      </div>
    );
  }

  const data = await getRolesPermissionsData(context);

  return <RolesPermissionsPanel accountName={context.accountName} {...data} />;
}
