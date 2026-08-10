import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { DocumentsClient } from "./DocumentsClient";

export default async function DocumentsPage() {
  const ctx = await getAccountContext();
  if (!ctx) {
    return null;
  }

  // Only an enterprise admin can scope the console to other people's work, so the
  // roster is only read for them; everyone else never receives their colleagues' names.
  const isEnterpriseAdmin =
    ctx.accountType === "ENTERPRISE" &&
    (ctx.roleNames.includes("ADMIN") || ctx.roleNames.includes("OWNER"));

  const memberships = isEnterpriseAdmin
    ? await db.accountMembership.findMany({
        where: { accountId: ctx.accountId, status: "ACTIVE" },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      })
    : [];

  return (
    <DocumentsClient
      accountName={ctx.accountName}
      currentUserId={ctx.userId}
      teamMembers={memberships.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
      }))}
    />
  );
}
