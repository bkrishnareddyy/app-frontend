import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { DocumentsClient } from "./DocumentsClient";
import type { TeamMember } from "@/lib/team";

export default async function DocumentsPage() {
  const ctx = await getAccountContext();
  if (!ctx) {
    return null;
  }

  // Fetch active team members if user is an enterprise admin
  let teamMembers: TeamMember[] = [];
  const isEnterpriseAdmin =
    ctx.accountType === "ENTERPRISE" &&
    (ctx.roleNames.includes("ADMIN") || ctx.roleNames.includes("OWNER"));

  if (isEnterpriseAdmin) {
    const memberships = await db.accountMembership.findMany({
      where: { accountId: ctx.accountId, status: "ACTIVE" },
      include: { user: true },
    });
    teamMembers = memberships.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
    }));
  }

  return (
    <DocumentsClient
      context={{
        userId: ctx.userId,
        roleNames: ctx.roleNames,
        accountType: ctx.accountType,
        accountName: ctx.accountName,
        firstName: ctx.firstName,
        lastName: ctx.lastName,
        email: ctx.email,
      }}
      teamMembers={teamMembers}
    />
  );
}
