"use server";

import { getAccountContext, hasPermission } from "@/lib/auth";
import { runRateSimulation, SimulationSummary } from "@/lib/billing/rateSimulation";

export async function runRateSimulationAction(
  proposedRateCardVersionId: string,
  months: number
): Promise<SimulationSummary> {
  const ctx = await getAccountContext();
  if (!ctx) throw new Error("Unauthorized");
  const canManage = await hasPermission("billing.ratecard.manage") || await hasPermission("billing.ratecard.view");
  if (!canManage) throw new Error("Forbidden: billing.ratecard.view permission required");

  if (!Number.isInteger(months) || months < 1 || months > 24) {
    throw new Error("Historical window must be between 1 and 24 months");
  }

  return runRateSimulation({
    accountId: ctx.accountId,
    proposedRateCardVersionId,
    months,
  });
}
