import type { DecisionGroup, DecisionRow } from "@/modules/decisions/groupDecisions";
import { decisionPriority, exceptionPriority, DECISION_ACTIONABLE_STATUSES, type WorkPriority } from "@/modules/work/workQueue";

export interface ExceptionRecord {
  id: string;
  type: string;
  severity: string;
  description: string;
  status: string;
  version: number;
  createdAt: string | Date;
  resolvedAt: string | Date | null;
  shipmentId: string | null;
  assignedToUserId: string | null;
  shipment: {
    id: string;
    shipmentNumber: string;
    client: { id: string; name: string } | null;
  } | null;
  assignedToUser: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
}

export type ActionItem =
  | {
      kind: "decision";
      id: string;
      agentName: string;
      decisionSummary: string | null;
      status: string;
      createdAt: string | Date;
      documentName: string | null;
      raw: DecisionRow;
    }
  | {
      kind: "exception";
      id: string;
      type: string;
      description: string;
      severity: string;
      status: string;
      version: number;
      createdAt: string | Date;
      documentName: null;
      assignedToUserId: string | null;
      assignedToUser: ExceptionRecord["assignedToUser"];
      raw: ExceptionRecord;
    };

export interface ShipmentActionGroup {
  shipmentId: string;
  shipmentNumber: string;
  clientId: string | null;
  clientName: string | null;
  priority: WorkPriority;
  decisionCount: number;
  exceptionCount: number;
  items: ActionItem[];
}

const PRIORITY_RANK: Record<WorkPriority, number> = { critical: 0, high: 1, normal: 2 };

function worstPriority(priorities: WorkPriority[]): WorkPriority {
  return priorities.reduce<WorkPriority>((best, p) => (PRIORITY_RANK[p] < PRIORITY_RANK[best] ? p : best), "normal");
}

export function buildShipmentActionGroups(
  decisionGroups: DecisionGroup[],
  exceptions: ExceptionRecord[]
): ShipmentActionGroup[] {
  const byShipment = new Map<
    string,
    { shipmentNumber: string; clientId: string | null; clientName: string | null; items: ActionItem[] }
  >();

  const ensure = (
    shipmentId: string,
    shipmentNumber: string,
    clientId: string | null,
    clientName: string | null
  ) => {
    if (!byShipment.has(shipmentId)) {
      byShipment.set(shipmentId, { shipmentNumber, clientId, clientName, items: [] });
    }
    return byShipment.get(shipmentId)!;
  };

  for (const group of decisionGroups) {
    const rawShipment = (group.decisions[0] as unknown as { shipment?: { client?: { id: string; name: string } | null } })?.shipment;
    const client = rawShipment?.client ?? null;
    const bucket = ensure(group.shipmentId, group.shipmentNumber, client?.id ?? null, client?.name ?? null);
    for (const dec of group.decisions) {
      bucket.items.push({
        kind: "decision",
        id: dec.id,
        agentName: dec.agentName ?? "Agent",
        decisionSummary: dec.decisionSummary ?? null,
        status: dec.status,
        createdAt: dec.createdAt,
        documentName: group.documentName,
        raw: dec,
      });
    }
  }

  for (const exc of exceptions) {
    if (!exc.shipmentId || !exc.shipment) continue;
    const client = exc.shipment.client ?? null;
    const bucket = ensure(exc.shipmentId, exc.shipment.shipmentNumber, client?.id ?? null, client?.name ?? null);
    bucket.items.push({
      kind: "exception",
      id: exc.id,
      type: exc.type,
      description: exc.description,
      severity: exc.severity,
      status: exc.status,
      version: exc.version,
      createdAt: exc.createdAt,
      documentName: null,
      assignedToUserId: exc.assignedToUserId,
      assignedToUser: exc.assignedToUser,
      raw: exc,
    });
  }

  const groups: ShipmentActionGroup[] = [];
  for (const [shipmentId, { shipmentNumber, clientId, clientName, items }] of byShipment) {
    if (items.length === 0) continue;

    const priorities = items.map((item) =>
      item.kind === "decision"
        ? (decisionPriority(item.status) ?? "normal")
        : exceptionPriority(item.severity)
    );

    const decisionCount = items.filter((i) => i.kind === "decision").length;
    const exceptionCount = items.filter((i) => i.kind === "exception").length;

    items.sort((a, b) => {
      const pa = a.kind === "decision" ? (decisionPriority(a.status) ?? "normal") : exceptionPriority(a.severity);
      const pb = b.kind === "decision" ? (decisionPriority(b.status) ?? "normal") : exceptionPriority(b.severity);
      const rankDiff = PRIORITY_RANK[pa] - PRIORITY_RANK[pb];
      if (rankDiff !== 0) return rankDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    groups.push({
      shipmentId,
      shipmentNumber,
      clientId,
      clientName,
      priority: worstPriority(priorities),
      decisionCount,
      exceptionCount,
      items,
    });
  }

  groups.sort((a, b) => {
    const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rankDiff !== 0) return rankDiff;
    const aOldest = Math.min(...a.items.map((i) => new Date(i.createdAt).getTime()));
    const bOldest = Math.min(...b.items.map((i) => new Date(i.createdAt).getTime()));
    return aOldest - bOldest;
  });

  return groups;
}
