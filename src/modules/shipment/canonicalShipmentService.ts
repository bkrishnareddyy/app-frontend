import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const canonicalInclude = {
  client: true,
  importerOfRecord: {
    include: { bond: true, powersOfAttorney: true },
  },
  shipmentParties: {
    include: {
      legalEntity: {
        include: { customsProfiles: true },
      },
    },
  },
  documents: {
    include: { parseVersions: true },
    orderBy: { createdAt: "desc" },
  },
  // Ordered explicitly: without it Postgres returns rows in whatever order it
  // finds them, which shifts as the reconciler fills fields in on existing rows,
  // so an invoice's lines came back scrambled. Line numbering is the operator's
  // reference back to the paper document and has to match it.
  lineItems: { orderBy: { lineNumber: "asc" as const } },
  agentDecisions: true,
  changeEvents: {
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  },
  exceptionItems: {
    where: { status: { not: "Resolved" } },
    orderBy: { createdAt: "desc" },
  },
  eventLogs: {
    orderBy: { createdAt: "desc" },
    take: 20,
  },
  agentExecutionRecords: {
    orderBy: { startedAt: "desc" },
    take: 100,
  },
} satisfies Prisma.ShipmentInclude;

export type CanonicalShipment = Prisma.ShipmentGetPayload<{ include: typeof canonicalInclude }>;

/** The subset of a shipment the metric calculation actually reads. */
export interface MetricsInput {
  shipmentNumber?: string | null;
  importerOfRecordId?: string | null;
  clientId?: string | null;
  entryType?: string | null;
  portOfEntry?: string | null;
  countryOfExport?: string | null;
  countryOfOrigin?: string | null;
  carrierName?: string | null;
  incoterm?: string | null;
  lineItems?: { htsConfidence?: number | null }[];
  documents?: unknown[];
  exceptionItems?: { severity?: string | null }[];
}

export interface MultiDimensionalMetrics {
  filingReadinessScore: number; // 0-100%
  completenessScore: number;     // 0-100%
  complianceRiskScore: number;   // 0-100 (0=Lowest, 100=Highest)
  complianceRiskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  classificationConfidenceScore: number; // 0-100%
  // False when no document is currently attached to the shipment -- the
  // stored per-line-item htsConfidence never gets invalidated when its
  // source document is detached, so this flag is what tells the UI not to
  // trust that stale number as a live, currently-substantiated claim.
  classificationVerified: boolean;
  isReadyForFiling: boolean;
  blockerCount: number;
  warningCount: number;
}

export interface FactProvenance {
  field: string;
  value: string | number | null;
  status: "VERIFIED" | "CONFLICT" | "UNVERIFIED" | "MISSING";
  confidence: number;
  sources: {
    sourceType: "USER" | "COMMERCIAL_INVOICE" | "BILL_OF_LADING" | "AGENT" | "REGULATION";
    value: string | number | null;
    confidence: number;
    timestamp?: string;
  }[];
}

export class CanonicalShipmentService {
  /**
   * Reconstructs the complete canonical shipment state from durable database records
   */
  static async getCanonicalState(shipmentId: string) {
    // AgentExecutionLog (written by the full 10-agent ComplianceWorkflowEngine
    // pipeline that actually runs on document upload) has no Prisma relation
    // to Shipment -- it only relates to Account, with shipmentId as a bare
    // field -- so it can't be pulled in via the include{} above and needs its
    // own query.
    const [shipment, agentExecutionLogs] = await Promise.all([
      db.shipment.findUnique({
        where: { id: shipmentId },
        include: canonicalInclude,
      }),
      db.agentExecutionLog.findMany({
        where: { shipmentId },
        orderBy: { timestamp: "desc" },
        take: 200,
      }),
    ]);

    if (!shipment) {
      throw new Error(`Shipment with ID ${shipmentId} not found`);
    }

    // 1. Calculate multi-dimensional metrics
    const metrics = this.calculateMetrics(shipment);

    // 2. Build provenance for key shipment facts
    const facts = this.buildFactProvenance(shipment);

    return {
      shipment,
      metrics,
      agentExecutionLogs,
      facts,
    };
  }

  /**
   * Calculates distinct, un-collapsed readiness & compliance metrics
   */
  static calculateMetrics(shipment: MetricsInput): MultiDimensionalMetrics {
    const activeExceptions = shipment.exceptionItems ?? [];    const blockers = activeExceptions.filter(
      (e) => e.severity === "Critical" || e.severity === "High"
    );
    const warnings = activeExceptions.filter(
      (e) => e.severity === "Medium" || e.severity === "Low"
    );

    // 1. Completeness Score (Check required customs & logistics fields)
    // Only columns that exist on Shipment are counted; a field the schema cannot
    // store would otherwise cap this score below 100 forever.
    const requiredFields = [
      shipment.shipmentNumber,
      shipment.importerOfRecordId || shipment.clientId,
      shipment.entryType,
      shipment.portOfEntry,
      shipment.countryOfExport,
      shipment.countryOfOrigin,
      shipment.carrierName,
      shipment.incoterm,
    ];
    const lineItems = shipment.lineItems || [];
    const completedFields = requiredFields.filter(Boolean).length;
    const baseCompleteness = Math.round((completedFields / requiredFields.length) * 100);
    const completenessScore = lineItems.length > 0 ? Math.min(100, baseCompleteness) : Math.min(80, baseCompleteness);

    // 2. Classification Confidence Score (Average confidence of line items)
    // -- only trusted when at least one document is currently attached to
    // substantiate it. htsConfidence is a static column on the line item
    // that never gets recomputed when its source document is detached, so
    // without a document present there's nothing live backing this claim.
    const documents = shipment.documents || [];
    const classificationVerified = documents.length > 0;
    let classificationConfidenceScore = 95;
    if (lineItems.length > 0) {
      const avgConfidence =
        lineItems.reduce((acc: number, item) => acc + (item.htsConfidence ?? 85), 0) / lineItems.length;
      classificationConfidenceScore = Math.round(avgConfidence);
    }
    if (!classificationVerified) {
      classificationConfidenceScore = 0;
    }

    // 3. Compliance Risk Score (0-100, where 0 is safest)
    let riskScore = 15;
    if (blockers.length > 0) riskScore += blockers.length * 25;
    if (warnings.length > 0) riskScore += warnings.length * 10;
    if (!shipment.importerOfRecordId) riskScore += 20;

    const complianceRiskScore = Math.min(100, Math.max(5, riskScore));
    let complianceRiskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
    if (complianceRiskScore > 75) complianceRiskBand = "CRITICAL";
    else if (complianceRiskScore > 50) complianceRiskBand = "HIGH";
    else if (complianceRiskScore > 25) complianceRiskBand = "MEDIUM";

    // 4. Filing Readiness Score (0-100%)
    let readinessScore = completenessScore;
    if (blockers.length > 0) {
      readinessScore = Math.max(20, readinessScore - blockers.length * 25);
    }
    if (classificationConfidenceScore < 80) {
      readinessScore = Math.max(30, readinessScore - 15);
    }

    const filingReadinessScore = Math.min(100, readinessScore);
    const isReadyForFiling = blockers.length === 0 && filingReadinessScore >= 80;

    return {
      filingReadinessScore,
      completenessScore,
      complianceRiskScore,
      complianceRiskBand,
      classificationConfidenceScore,
      classificationVerified,
      isReadyForFiling,
      blockerCount: blockers.length,
      warningCount: warnings.length,
    };
  }

  /**
   * Builds source provenance for key facts (e.g. Country of Origin, Incoterm, Mode).
   *
   * A fact is only VERIFIED when a user set it or a parsed document supports it.
   * An absent value reports MISSING rather than a plausible default, and a stored
   * value with no surviving source reports UNVERIFIED, because a provenance panel
   * that invents its own evidence is worse than no panel at all.
   */
  private static buildFactProvenance(shipment: CanonicalShipment): FactProvenance[] {
    const changeEvents = shipment.changeEvents ?? [];
    const hasParsedDocument = (shipment.documents ?? []).some(
      (doc) => doc.status === "Received" || doc.status === "Processed"
    );

    const buildFact = (
      field: string,
      value: string | null,
      changeField: string,
      documentSource: FactProvenance["sources"][number]["sourceType"]
    ): FactProvenance => {
      const userChange = changeEvents.find((e) => e.field === changeField);
      const sources: FactProvenance["sources"] = [];

      if (userChange) {
        sources.push({
          sourceType: "USER",
          value: userChange.newValue,
          confidence: 100,
          timestamp: userChange.createdAt.toISOString(),
        });
      }
      if (value !== null && hasParsedDocument) {
        sources.push({ sourceType: documentSource, value, confidence: 0 });
      }

      let status: FactProvenance["status"] = "MISSING";
      if (value !== null) status = sources.length > 0 ? "VERIFIED" : "UNVERIFIED";

      return {
        field,
        value,
        status,
        // Confidence is only claimed for a value the user set themselves.
        confidence: userChange ? 100 : 0,
        sources,
      };
    };

    return [
      buildFact("Country of Origin", shipment.countryOfOrigin, "countryOfOrigin", "COMMERCIAL_INVOICE"),
      buildFact("Incoterm", shipment.incoterm, "incoterm", "COMMERCIAL_INVOICE"),
      buildFact("Carrier", shipment.carrierName, "carrierName", "BILL_OF_LADING"),
    ];
  }
}
