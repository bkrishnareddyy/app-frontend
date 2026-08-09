import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { UserManagementTable } from "./UserManagementTable";
import { Users } from "lucide-react";

export default async function AdminUsersPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  const memberships = await db.accountMembership.findMany({
    where: { accountId: context.accountId },
    include: { user: true, roles: { include: { role: true } } },
    orderBy: { createdAt: "desc" },
  });

  const formattedMembers = memberships.map((m) => ({
    membershipId: m.id,
    userId: m.user.id,
    email: m.user.email,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    roleNames: m.roles.map((mr) => mr.role.name),
  }));

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div>
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#0071E3] text-xs font-semibold mb-3">
          <Users className="w-3.5 h-3.5" />
          <span>Account Members & Access</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[#1D1D1F] tracking-tight">User Management</h1>
        <p className="text-[#86868B] text-sm mt-1">
          Manage account members, assign roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), and send invitations for {context.accountName}.
        </p>
      </div>

      <UserManagementTable
        members={formattedMembers}
        currentUserId={context.userId}
      />
    </div>
  );
}
