import type { ReviewDecision } from "@/components/DocumentReviewPanel";

export interface DecisionRow extends ReviewDecision {
  shipmentId: string;
  createdAt: string | Date;
  agentName: string;
  documentId?: string | null;
  shipment?: { shipmentNumber?: string | null } | null;
  /** AI confidence score (0–100). Present on classification and extraction decisions. */
  confidence?: number | null;
  /** Set when a human reviewer has acted on this decision. */
  reviewedByUser?: { firstName?: string | null; lastName?: string | null; email: string } | null;
}

export interface DecisionDocument {
  id: string;
  shipmentId: string | null;
  fileName: string;
  createdAt: string | Date;
  fileUrl?: string | null;
}

export interface DecisionGroup {
  id: string;
  shipmentId: string;
  shipmentNumber: string;
  documentName: string;
  documentId?: string;
  decisions: DecisionRow[];
  status: "Needs Review" | "Approved";
  latestCreatedAt: string | Date;
}

// Document Intake, Document Intelligence, Product Intelligence, and HTS
// Classification each run because of one specific document event.
// Origin, Valuation, Compliance, and Filing Readiness are shipment-scoped
// and rerun on every edit — grouping them per-run fabricates a new card
// every time even though there is only ever one current answer per agent.
export const SHIPMENT_SCOPED_AGENTS = new Set([
  "Origin Agent",
  "Valuation Agent",
  "Compliance Agent",
  "Filing Readiness Agent",
]);

// Legacy-only: decisions written before AgentDecision.documentId existed
// still have documentId: null despite being document-scoped.
const LEGACY_CLUSTER_GAP_MS = 15 * 60 * 1000;

export function groupDecisions(decisions: DecisionRow[], allDocuments: DecisionDocument[]): DecisionGroup[] {
  const documentScoped = decisions.filter((d) => !SHIPMENT_SCOPED_AGENTS.has(d.agentName));
  const shipmentScoped = decisions.filter((d) => SHIPMENT_SCOPED_AGENTS.has(d.agentName));

  const latestShipmentScoped = new Map<string, DecisionRow>();
  for (const dec of shipmentScoped) {
    const key = `${dec.shipmentId}::${dec.agentName}`;
    const existing = latestShipmentScoped.get(key);
    if (!existing || new Date(dec.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latestShipmentScoped.set(key, dec);
    }
  }
  const shipmentScopedByShipment = new Map<string, DecisionRow[]>();
  for (const dec of latestShipmentScoped.values()) {
    const list = shipmentScopedByShipment.get(dec.shipmentId) ?? [];
    list.push(dec);
    shipmentScopedByShipment.set(dec.shipmentId, list);
  }

  const byDocumentId = new Map<string, DecisionRow[]>();
  const withRealDocId = documentScoped.filter(
    (d): d is DecisionRow & { documentId: string } => Boolean(d.documentId)
  );
  const legacyWithoutDocId = documentScoped.filter((d) => !d.documentId);

  for (const dec of withRealDocId) {
    const list = byDocumentId.get(dec.documentId) ?? [];
    list.push(dec);
    byDocumentId.set(dec.documentId, list);
  }

  const sortedLegacy = [...legacyWithoutDocId].sort((a, b) => {
    if (a.shipmentId !== b.shipmentId) return a.shipmentId < b.shipmentId ? -1 : 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  let currentCluster: DecisionRow[] = [];
  const flushLegacyCluster = () => {
    if (currentCluster.length === 0) return;
    const shipmentId = currentCluster[0].shipmentId;
    const clusterStart = new Date(currentCluster[0].createdAt).getTime();
    const clusterEnd = new Date(currentCluster[currentCluster.length - 1].createdAt).getTime();
    const midpoint = (clusterStart + clusterEnd) / 2;
    const shipmentDocs = allDocuments.filter((d) => d.shipmentId === shipmentId);
    let bestDoc = shipmentDocs[0];
    let bestDelta = Infinity;
    for (const d of shipmentDocs) {
      const delta = Math.abs(new Date(d.createdAt).getTime() - midpoint);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestDoc = d;
      }
    }
    if (bestDoc) {
      const list = byDocumentId.get(bestDoc.id) ?? [];
      list.push(...currentCluster);
      byDocumentId.set(bestDoc.id, list);
    }
    currentCluster = [];
  };
  for (const dec of sortedLegacy) {
    if (currentCluster.length === 0) {
      currentCluster.push(dec);
      continue;
    }
    const last = currentCluster[currentCluster.length - 1];
    const sameShipment = dec.shipmentId === last.shipmentId;
    const gap = new Date(dec.createdAt).getTime() - new Date(last.createdAt).getTime();
    if (sameShipment && gap <= LEGACY_CLUSTER_GAP_MS) {
      currentCluster.push(dec);
    } else {
      flushLegacyCluster();
      currentCluster.push(dec);
    }
  }
  flushLegacyCluster();

  const groups: DecisionGroup[] = [];
  for (const [documentId, docDecisions] of byDocumentId) {
    const doc = allDocuments.find((d) => d.id === documentId);
    if (!doc) continue;
    const shipmentId = docDecisions[0].shipmentId;
    const shipmentNumber = docDecisions[0].shipment?.shipmentNumber || shipmentId;
    const combinedDecisions = [...docDecisions, ...(shipmentScopedByShipment.get(shipmentId) ?? [])];
    const uniqueDecisionsMap = new Map<string, DecisionRow>();
    for (const d of combinedDecisions) {
      if (!uniqueDecisionsMap.has(d.id)) {
        uniqueDecisionsMap.set(d.id, d);
      }
    }
    const allDecisionsForGroup = Array.from(uniqueDecisionsMap.values());
    const allApproved = allDecisionsForGroup.every((d) => d.status === "Approved");
    const latestCreatedAt = allDecisionsForGroup.reduce(
      (latest, d) => (new Date(d.createdAt).getTime() > new Date(latest).getTime() ? d.createdAt : latest),
      allDecisionsForGroup[0].createdAt
    );

    groups.push({
      id: docDecisions[0].id,
      shipmentId,
      shipmentNumber,
      documentName: doc.fileName || "Uploaded document",
      documentId: doc.id,
      decisions: allDecisionsForGroup,
      status: allApproved ? "Approved" : "Needs Review",
      latestCreatedAt,
    });
  }

  groups.sort((a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime());
  return groups;
}
