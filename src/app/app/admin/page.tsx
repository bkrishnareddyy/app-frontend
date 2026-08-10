import { getAccountContext } from "@/lib/auth";
import { AccountAdminForm } from "./AccountAdminForm";
import { Building2, Info } from "lucide-react";

export default async function AdminAccountPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#0071E3] text-xs font-semibold mb-3">
          <Building2 className="w-3.5 h-3.5" />
          <span>Customer Account Settings</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[#1D1D1F] tracking-tight">Account Profile & Configuration</h1>
        <p className="text-[#86868B] text-sm mt-1">
          Manage operational settings and identity for {context.accountName}.
        </p>
      </div>

      <div className="p-4 bg-white border border-[#E5E5EA] rounded-2xl text-xs text-[#86868B] flex items-center space-x-3 shadow-xs">
        <Info className="w-5 h-5 text-[#0071E3] shrink-0" />
        <span>
          <strong className="text-[#1D1D1F]">Audit Compliance Notice:</strong> Any modification to account attributes or operational status is immutably logged to the account audit trail.
        </span>
      </div>

      <AccountAdminForm
        account={{
          id: context.account.id,
          name: context.account.name,
          type: context.account.type,
          status: context.account.status,
          createdAt: context.account.createdAt.toISOString(),
        }}
        userRole={context.roleNames.join(", ")}
      />
    </div>
  );
}
