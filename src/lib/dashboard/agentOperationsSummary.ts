import { triageDecision } from "@/modules/decisions/decisionState";

export interface AgentDecisionRow {
  agentName: string;
  shipmentId: string;
  status: string;
  triageState: string | null;
  proposedDescription: string | null;
  createdAt: Date | string;
}

export interface AgentOperationsRow {
  agentName: string;
  /** Shipments with a current (latest) decision from this agent. */
  processed: number;
  needsReview: number;
  blocked: number;
  verified: number;
}

/**
 * Per-agent operational counts, using the same "latest decision per agent per
 * shipment" rule the rest of the Command Center already relies on (see
 * page.tsx's aiReview tally) so a superseded decision never double-counts.
 *
 * `decisions` should be the same capped, tenant-scoped list the dashboard
 * already loads — this does not issue its own query.
 */
export function computeAgentOperations(decisions: AgentDecisionRow[]): AgentOperationsRow[] {
  const latestByShipmentAgent = new Map<string, AgentDecisionRow>();
  for (const d of decisions) {
    const key = `${d.shipmentId}::${d.agentName}`;
    const existing = latestByShipmentAgent.get(key);
    if (!existing || new Date(d.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latestByShipmentAgent.set(key, d);
    }
  }

  const byAgent = new Map<string, AgentOperationsRow>();
  for (const d of latestByShipmentAgent.values()) {
    if (!byAgent.has(d.agentName)) {
      byAgent.set(d.agentName, { agentName: d.agentName, processed: 0, needsReview: 0, blocked: 0, verified: 0 });
    }
    const row = byAgent.get(d.agentName)!;
    row.processed++;
    const triage = triageDecision({ status: d.status, triageState: d.triageState, proposedDescription: d.proposedDescription });
    if (triage === "blocked") row.blocked++;
    else if (triage === "review") row.needsReview++;
    else row.verified++;
  }

  return Array.from(byAgent.values()).sort((a, b) => b.processed - a.processed);
}
