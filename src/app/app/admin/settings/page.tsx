import { getAccountContext } from "@/lib/auth";
import { getSettingsAuditData } from "@/lib/admin/auditData";
import { db } from "@/lib/db";
import { SettingsAuditPanel } from "./SettingsAuditPanel";
import { DocumentEmailPanel } from "./DocumentEmailPanel";

export default async function AdminSettingsPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  const [data, routes, memberships] = await Promise.all([
    getSettingsAuditData(context),
    db.inboundSenderRoute.findMany({
      where: { accountId: context.accountId },
      include: { defaultAssignedToUser: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.accountMembership.findMany({
      where: { accountId: context.accountId, status: "ACTIVE" },
      include: { user: true },
    }),
  ]);

  const teamMembers = memberships.map((m) => ({
    userId: m.user.id,
    email: m.user.email,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
  }));

  return (
    <div className="space-y-10">
      <DocumentEmailPanel
        publicDocumentAddress={process.env.RESEND_PUBLIC_DOCUMENT_ADDRESS ?? "docs@inbound.qubere.ai"}
        initialRoutes={routes.map((r) => ({
          id: r.id,
          displaySenderEmail: r.displaySenderEmail,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          defaultAssignedToUser: r.defaultAssignedToUser,
        }))}
        teamMembers={teamMembers}
      />
      <SettingsAuditPanel accountName={context.accountName} {...data} />
    </div>
  );
}
