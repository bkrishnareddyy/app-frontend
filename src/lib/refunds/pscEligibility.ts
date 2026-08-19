import { db } from "../db";

export interface PscEligibilityResult {
  eligible: boolean;
  reason: string;
}

/**
 * Validates eligibility for Post-Summary Correction (Task D-2)
 */
export async function checkPscEligibility(accountId: string, filingId: string): Promise<PscEligibilityResult> {
  const filing = await db.customsFiling.findFirst({
    where: { id: filingId, accountId },
    include: {
      shipment: {
        include: {
          lineItems: {
            include: { drawbackMatches: true },
          },
          complianceDeadlines: {
            where: { type: "PSC_WINDOW" },
          },
        },
      },
    },
  });

  if (!filing) {
    return { eligible: false, reason: "Customs filing not found." };
  }

  const validStatuses = ["Accepted", "Released", "Liquidated", "Closed"];
  if (!validStatuses.includes(filing.filingStatus)) {
    return { eligible: false, reason: `Filing is in ${filing.filingStatus} status. PSC requires Accepted or Liquidated status.` };
  }

  if (filing.filingStatus === "Closed") {
    return { eligible: false, reason: "Entry is closed and fully liquidated. PSC window is closed." };
  }

  const pscDeadline = filing.shipment?.complianceDeadlines?.[0];
  if (pscDeadline?.dueAt && pscDeadline.dueAt < new Date()) {
    return { eligible: false, reason: "PSC filing window has expired (exceeded statutory 270-day limit under 19 U.S.C. § 1484a)." };
  }

  const hasDrawback = (filing.shipment?.lineItems ?? []).some((item) => item.drawbackMatches.length > 0);
  if (hasDrawback) {
    return { eligible: false, reason: "Entry contains line items that have active drawback claims." };
  }

  if (!filing.totalDuties || Number(filing.totalDuties) <= 0) {
    return { eligible: false, reason: "Entry has no recorded duty paid. PSC requires positive duty impact." };
  }

  return { eligible: true, reason: "Entry is fully eligible for Post-Summary Correction." };
}
