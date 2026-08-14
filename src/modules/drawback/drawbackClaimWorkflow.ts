import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";

export type DrawbackClaimStatus = "Draft" | "Prepared" | "Submitted" | "Accepted" | "Rejected" | "Paid";

export const CLAIM_TRANSITIONS: Record<DrawbackClaimStatus, DrawbackClaimStatus[]> = {
  Draft: ["Prepared"],
  Prepared: ["Submitted", "Draft"],
  Submitted: ["Accepted", "Rejected"],
  Accepted: ["Paid"],
  Rejected: ["Draft"],
  Paid: [],
};

export class DrawbackClaimWorkflowError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "DrawbackClaimWorkflowError";
  }
}

export async function transitionDrawbackClaim(params: {
  claimId: string;
  targetStatus: DrawbackClaimStatus;
  accountId: string;
  userId: string;
  userPermissions?: string[];
  isBroker?: boolean;
}) {
  const { claimId, targetStatus, accountId, userId, userPermissions = [], isBroker = false } = params;

  const claim = await db.drawbackClaim.findFirst({
    where: { id: claimId, accountId },
  });

  if (!claim) {
    throw new DrawbackClaimWorkflowError("Drawback claim not found", 404);
  }

  const currentStatus = (claim.status || "Draft") as DrawbackClaimStatus;
  const allowedNext = CLAIM_TRANSITIONS[currentStatus] || [];

  if (!allowedNext.includes(targetStatus)) {
    throw new DrawbackClaimWorkflowError(
      `Invalid state transition from "${currentStatus}" to "${targetStatus}". Allowed next statuses: ${allowedNext.join(", ")}`,
      400
    );
  }

  // Task B-6: Broker-only submit rule
  if (targetStatus === "Submitted") {
    const hasBrokerPerm = isBroker || userPermissions.includes("filings.transmit") || userPermissions.includes("broker.approve");
    if (!hasBrokerPerm) {
      throw new DrawbackClaimWorkflowError(
        "Forbidden: Only licensed customs brokers are authorized to submit drawback claims to CBP.",
        403
      );
    }
  }

  const updateData: any = {
    status: targetStatus,
  };
  if (targetStatus === "Submitted") {
    updateData.filedAt = new Date();
  }
  if (targetStatus === "Paid") {
    updateData.paidAt = new Date();
  }

  const updatedClaim = await db.drawbackClaim.update({
    where: { id: claimId },
    data: updateData,
    include: { matches: true },
  });

  await createAuditLog({
    accountId,
    userId,
    action: AuditAction.DRAWBACK_CLAIM_CREATED,
    entity: "DrawbackClaim",
    entityId: claimId,
    source: "UI",
    metadata: { previousStatus: currentStatus, newStatus: targetStatus },
  });

  return updatedClaim;
}
