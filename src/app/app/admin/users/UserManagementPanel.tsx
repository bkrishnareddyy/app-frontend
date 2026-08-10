import { Users } from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";
import { UserManagementTable, type MemberItem } from "./UserManagementTable";

interface UserManagementPanelProps {
  accountName: string;
  members: MemberItem[];
  currentUserId: string;
  availableRoles: string[];
  onSaved?: () => void;
  compact?: boolean;
}

export function UserManagementPanel({
  accountName,
  members,
  currentUserId,
  availableRoles,
  onSaved,
  compact,
}: UserManagementPanelProps) {
  return (
    <div className={compact ? "space-y-5" : "space-y-8 max-w-6xl mx-auto"}>
      <PanelHeading
        icon={Users}
        badge="Account Members & Access"
        title="User Management"
        subtitle={`Manage members, assign roles, and send invitations for ${accountName}.`}
        compact={compact}
      />

      <UserManagementTable
        members={members}
        currentUserId={currentUserId}
        availableRoles={availableRoles}
        onSaved={onSaved}
      />
    </div>
  );
}
