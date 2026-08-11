import { Building2, Info } from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";
import { AccountAdminForm } from "./AccountAdminForm";

export interface AccountSummary {
  id: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
}

interface AccountProfilePanelProps {
  accountName: string;
  account: AccountSummary;
  userRole: string;
  onSaved?: () => void;
  compact?: boolean;
}

export function AccountProfilePanel({ accountName, account, userRole, onSaved, compact }: AccountProfilePanelProps) {
  return (
    <div className={compact ? "space-y-5" : "space-y-8 max-w-5xl mx-auto"}>
      <PanelHeading
        icon={Building2}
        badge="Customer Account Settings"
        title="Account Profile & Configuration"
        subtitle={`Manage operational settings and identity for ${accountName}.`}
        compact={compact}
      />

      {!compact && (
        <div className="p-4 bg-white border border-border rounded-2xl text-xs text-ink-muted flex items-center space-x-3 shadow-xs">
          <Info className="w-5 h-5 text-brand shrink-0" />
          <span>
            <strong className="text-ink">Audit Compliance Notice:</strong> Any modification to account attributes or operational status is immutably logged to the account audit trail.
          </span>
        </div>
      )}

      <AccountAdminForm account={account} userRole={userRole} onSaved={onSaved} />
    </div>
  );
}
