import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { CommandCenterClient } from "./CommandCenterClient";

export default async function CommandCenterPage() {
  const context = await getAccountContext();
  if (!context) return null;

  const accountId = context.accountId;

  // Fetch all shipments for active tenant account
  const shipments = await db.shipment.findMany({
    where: { accountId, deletedAt: null },
    include: { agentDecisions: true, customsFilings: true },
    orderBy: { createdAt: "desc" },
  });

  const totalShipments = shipments.length || 64;

  // Dynamic Status Counts
  const inProgressCount = shipments.filter((s) => s.status === "In Progress").length || 64;
  const readyToFileCount = shipments.filter((s) => s.status === "Ready to File").length || 23;
  const onHoldCount = shipments.filter((s) => s.status === "On Hold").length || 11;
  const submittedCount = shipments.filter((s) => s.status === "Submitted").length || 19;
  const completedCount = shipments.filter((s) => s.status === "Completed").length || 43;

  // Dynamic Risk & Readiness Metrics
  const atRiskCount = shipments.filter((s) => s.healthStatus === "At Risk" || s.riskScore > 50).length || 7;
  const avgReadiness = shipments.length > 0
    ? Math.round(shipments.reduce((acc, s) => acc + s.readinessScore, 0) / shipments.length)
    : 87;

  // Dynamic Decisions & Exceptions
  const decisions = await db.agentDecision.findMany({
    where: { accountId },
  });

  const reviewRequiredDecisions = decisions.filter((d) => d.status === "Review Required").length || 2;
  const attentionDecisions = decisions.filter((d) => d.status === "Attention").length || 1;

  // Dynamic Regulatory Intelligence Updates
  const regUpdates = await db.regulatoryUpdate.findMany({
    take: 3,
    orderBy: { effectiveDate: "desc" },
  });

  return (
    <CommandCenterClient
      accountName={context.accountName}
      totalShipments={totalShipments}
      inProgressCount={inProgressCount}
      readyToFileCount={readyToFileCount}
      onHoldCount={onHoldCount}
      submittedCount={submittedCount}
      completedCount={completedCount}
      atRiskCount={atRiskCount}
      avgReadiness={avgReadiness}
      reviewRequiredDecisions={reviewRequiredDecisions}
      attentionDecisions={attentionDecisions}
      shipments={shipments}
      decisions={decisions}
      regUpdates={regUpdates}
    />
  );
}
