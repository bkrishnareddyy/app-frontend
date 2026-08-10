import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { UserManagementPanel } from "./UserManagementPanel";

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

  // Roles are per-account (custom roles like PLANNER) plus system-wide ones
  // (OWNER) -- not a fixed OWNER/ADMIN/MEMBER/VIEWER set, so the assignable
  // list must be queried rather than hardcoded.
  const availableRoles = await db.role.findMany({
    where: { OR: [{ accountId: context.accountId }, { accountId: null }] },
    orderBy: { name: "asc" },
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
    <UserManagementPanel
      accountName={context.accountName}
      members={formattedMembers}
      currentUserId={context.userId}
      availableRoles={availableRoles.map((r) => r.name)}
    />
  );
}
