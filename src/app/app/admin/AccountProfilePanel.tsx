import { Building2 } from "lucide-react";
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
        title="Account Profile"
        subtitle=""
        compact={compact}
      />

      <AccountAdminForm account={account} userRole={userRole} onSaved={onSaved} />
    </div>
  );
}
