import type { DecisionGroup, DecisionRow } from "@/modules/decisions/groupDecisions";
import { decisionPriority, exceptionPriority, type WorkPriority } from "@/modules/work/workQueue";
import { reviewCategory } from "@/modules/decisions/editableFields";
import { checkRequiredDocumentTypes } from "@/lib/requiredDocumentTypes";

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
  documentId?: string | null;
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
      proposedDescription: string | null;
      createdAt: string | Date;
      documentId: string | null;
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
      documentId?: string | null;
      assignedToUserId: string | null;
      assignedToUser: ExceptionRecord["assignedToUser"];
      raw: ExceptionRecord;
    };

export interface ShipmentActionGroup {
  shipmentId: string;
  shipmentNumber: string;
  clientId: string | null;
  clientName: string | null;
  assignedBrokerId: string | null;
  assignedBrokerName: string | null;
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
    {
      shipmentNumber: string;
      clientId: string | null;
      clientName: string | null;
      assignedBrokerId: string | null;
      assignedBrokerName: string | null;
      items: ActionItem[];
    }
  >();

  const ensure = (
    shipmentId: string,
    shipmentNumber: string,
    clientId: string | null,
    clientName: string | null,
    assignedBrokerId: string | null,
    assignedBrokerName: string | null
  ) => {
    if (!byShipment.has(shipmentId)) {
      byShipment.set(shipmentId, {
        shipmentNumber,
        clientId,
        clientName,
        assignedBrokerId,
        assignedBrokerName,
        items: [],
      });
    }
    const bucket = byShipment.get(shipmentId)!;
    if (!bucket.assignedBrokerId && assignedBrokerId) {
      bucket.assignedBrokerId = assignedBrokerId;
      bucket.assignedBrokerName = assignedBrokerName;
    }
    return bucket;
  };

  for (const group of decisionGroups) {
    const rawShipment = (
      group.decisions[0] as unknown as {
        shipment?: {
          assignedBrokerId?: string | null;
          assignedBroker?: { firstName?: string | null; lastName?: string | null; email?: string } | null;
          client?: { id: string; name: string } | null;
        };
      }
    )?.shipment;
    const client = rawShipment?.client ?? null;
    const assignedBrokerId = rawShipment?.assignedBrokerId ?? null;
    const assignedBroker = rawShipment?.assignedBroker ?? null;
    const assignedBrokerName = assignedBroker
      ? [assignedBroker.firstName, assignedBroker.lastName].filter(Boolean).join(" ") || assignedBroker.email
      : null;

    const bucket = ensure(
      group.shipmentId,
      group.shipmentNumber,
      client?.id ?? null,
      client?.name ?? null,
      assignedBrokerId,
      assignedBrokerName ?? null
    );
    for (const dec of group.decisions) {
      if (reviewCategory(dec) === "MECHANICAL") continue;
      if (bucket.items.some((i) => i.id === dec.id)) continue;
      bucket.items.push({
        kind: "decision",
        id: dec.id,
        agentName: dec.agentName ?? "Agent",
        decisionSummary: dec.decisionSummary ?? null,
        status: dec.status,
        proposedDescription: (dec as unknown as { proposedDescription?: string | null }).proposedDescription ?? null,
        createdAt: dec.createdAt,
        documentId: group.documentId ?? dec.documentId ?? null,
        documentName: group.documentName,
        raw: dec,
      });
    }
  }

  for (const exc of exceptions) {
    if (!exc.shipmentId || !exc.shipment) continue;
    const excShipment = exc.shipment as unknown as {
      assignedBrokerId?: string | null;
      assignedBroker?: { firstName?: string | null; lastName?: string | null; email?: string } | null;
      client?: { id: string; name: string } | null;
    };
    const client = excShipment.client ?? null;
    const assignedBrokerId = excShipment.assignedBrokerId ?? null;
    const assignedBroker = excShipment.assignedBroker ?? null;
    const assignedBrokerName = assignedBroker
      ? [assignedBroker.firstName, assignedBroker.lastName].filter(Boolean).join(" ") || assignedBroker.email
      : null;

    const bucket = ensure(
      exc.shipmentId,
      exc.shipment.shipmentNumber,
      client?.id ?? null,
      client?.name ?? null,
      assignedBrokerId,
      assignedBrokerName ?? null
    );
    if (bucket.items.some((i) => i.id === exc.id)) continue;
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
      documentId: exc.documentId ?? null,
      assignedToUserId: exc.assignedToUserId,
      assignedToUser: exc.assignedToUser,
      raw: exc,
    });
  }

  for (const [shipmentId, bucket] of byShipment) {
    const docRows = bucket.items
      .filter((i): i is Extract<ActionItem, { kind: "decision" }> => i.kind === "decision")
      .map((i) => ({
        docType: i.documentName,
        fileName: i.documentName,
        status: "Received",
      }));

    const { missingTypes } = checkRequiredDocumentTypes(docRows, false);

    for (const reqDoc of missingTypes) {
      if (bucket.items.some((i) => i.kind === "exception" && i.type.toLowerCase().includes(reqDoc.toLowerCase()))) continue;
      if (bucket.items.some((i) => i.kind === "exception" && i.description.toLowerCase().includes(reqDoc.toLowerCase()))) continue;

      const missingId = `missing-doc-${shipmentId}-${reqDoc}`;
      if (bucket.items.some((i) => i.id === missingId)) continue;

      bucket.items.push({
        kind: "exception",
        id: missingId,
        type: "missing_document",
        description: `${reqDoc} Missing: Required for customs entry filing. Upload the ${reqDoc} to clear this requirement.`,
        severity: "Medium",
        status: "OPEN",
        version: 1,
        createdAt: new Date(),
        documentName: null,
        assignedToUserId: bucket.assignedBrokerId,
        assignedToUser: null,
        raw: {
          id: missingId,
          type: "missing_document",
          severity: "Medium",
          description: `${reqDoc} Missing: Required for customs entry filing. Upload the ${reqDoc} to clear this requirement.`,
          status: "OPEN",
          version: 1,
          createdAt: new Date(),
          resolvedAt: null,
          shipmentId,
          assignedToUserId: bucket.assignedBrokerId,
          shipment: { id: shipmentId, shipmentNumber: bucket.shipmentNumber, client: bucket.clientId ? { id: bucket.clientId, name: bucket.clientName || "" } : null },
          assignedToUser: null,
        },
      });
    }
  }

  const groups: ShipmentActionGroup[] = [];
  for (const [shipmentId, { shipmentNumber, clientId, clientName, assignedBrokerId, assignedBrokerName, items }] of byShipment) {
    if (items.length === 0) continue;

    const priorities = items.map((item) =>
      item.kind === "decision"
        ? (decisionPriority(item.status, item.proposedDescription) ?? "normal")
        : exceptionPriority(item.severity)
    );

    const decisionCount = items.filter((i) => i.kind === "decision").length;
    const exceptionCount = items.filter((i) => i.kind === "exception").length;

    items.sort((a, b) => {
      const pa = a.kind === "decision" ? (decisionPriority(a.status, a.proposedDescription) ?? "normal") : exceptionPriority(a.severity);
      const pb = b.kind === "decision" ? (decisionPriority(b.status, b.proposedDescription) ?? "normal") : exceptionPriority(b.severity);
      const rankDiff = PRIORITY_RANK[pa] - PRIORITY_RANK[pb];
      if (rankDiff !== 0) return rankDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    groups.push({
      shipmentId,
      shipmentNumber,
      clientId,
      clientName,
      assignedBrokerId,
      assignedBrokerName,
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
