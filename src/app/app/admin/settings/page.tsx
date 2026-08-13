import { getAccountContext } from "@/lib/auth";
import { getSettingsAuditData } from "@/lib/admin/auditData";
import { db } from "@/lib/db";
import { SettingsAuditPanel } from "./SettingsAuditPanel";
import { DocumentEmailPanel } from "./DocumentEmailPanel";
import { AgentPoliciesPanel } from "./AgentPoliciesPanel";

export default async function AdminSettingsPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  const [data, routes, memberships, agentPolicies, policyHistory] = await Promise.all([
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
    db.agentPolicyConfig.findMany({
      where: { accountId: context.accountId },
      orderBy: { agentName: "asc" },
    }),
    db.auditLog.findMany({
      where: {
        accountId: context.accountId,
        entity: "AgentPolicyConfig",
        action: { in: ["AGENT_POLICY_CREATED", "AGENT_POLICY_UPDATED"] },
      },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
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
      <AgentPoliciesPanel
        initialPolicies={agentPolicies.map((p) => ({
          id: p.id,
          agentName: p.agentName,
          autoThreshold: p.autoThreshold,
          confirmThreshold: p.confirmThreshold,
          requirePartMasterMatch: p.requirePartMasterMatch,
          updatedAt: p.updatedAt.toISOString(),
        }))}
        history={policyHistory.map((h) => ({
          id: h.id,
          action: h.action,
          metadata: (h.metadata ?? {}) as Record<string, unknown>,
          changedBy: h.user
            ? `${h.user.firstName ?? ""} ${h.user.lastName ?? ""}`.trim() || h.user.email
            : "System",
          createdAt: h.createdAt.toISOString(),
        }))}
      />
      <SettingsAuditPanel accountName={context.accountName} {...data} />
    </div>
  );
}
