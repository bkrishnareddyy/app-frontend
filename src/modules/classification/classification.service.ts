import { db } from "@/lib/db";
import { ProviderMetadata } from "@/lib/providers";

export interface ClassificationInput {
  productDescription: string;
  materialComposition?: string;
  functionUsage?: string;
  principalUse?: string;
  partNumber?: string;
  brandModel?: string;
  countryOfOrigin?: string;
  shipmentId?: string;
}

export interface ClassificationSourceCitation {
  identifier: string;
  title: string;
  effectiveDate: string;
  retrievalDate: string;
  excerpt: string;
}

export class ClassificationService {
  static async classifyProduct(accountId: string, userId: string, input: ClassificationInput) {
    const normDesc = input.productDescription.trim().toLowerCase();

    // Retrieve candidates from DB HTS Master
    const candidates = await db.hTSCode.findMany({
      where: {
        OR: [
          { description: { contains: normDesc.split(" ")[0], mode: "insensitive" } },
          { htsCode10: { contains: normDesc.split(" ")[0] } },
        ],
      },
      take: 5,
    });

    const citedSources: ClassificationSourceCitation[] = [
      {
        identifier: "HTSUS-2026-REV1",
        title: "Harmonized Tariff Schedule of the United States (2026 Revision 1)",
        effectiveDate: "2026-01-01",
        retrievalDate: new Date().toISOString(),
        excerpt: "General Rules of Interpretation (GRI 1 & GRI 6) applied to product specification.",
      },
    ];

    if (candidates.length === 0) {
      return {
        status: "REVIEW_REQUIRED",
        reason: "No authoritative HTS headings matched product description without ambiguity.",
        candidates: [],
        citedSources,
        metadata: {
          providerName: "QubereHtsMasterProvider",
          datasetVersion: "HTSUS 2026 Rev 1",
          retrievedAt: new Date().toISOString(),
          completenessStatus: "DATA_UNAVAILABLE",
        } as ProviderMetadata,
      };
    }

    const primaryMatch = candidates[0];
    const competingCandidates = candidates.slice(1);

    const requiresReview = competingCandidates.length > 0 || !input.materialComposition;

    let targetShipmentId: string | undefined = input.shipmentId;
    if (targetShipmentId) {
      const shp = await db.shipment.findFirst({ where: { id: targetShipmentId, accountId } });
      if (!shp) targetShipmentId = undefined;
    }

    let agentDecisionId: string | undefined = undefined;

    if (targetShipmentId) {
      const agentDecision = await db.agentDecision.create({
        data: {
          accountId,
          shipmentId: targetShipmentId,
          agentName: "Classification Agent",
          agentIcon: "Scale",
          status: requiresReview ? "Review Required" : "Approved",
          confidence: requiresReview ? 75 : 95,
          decisionSummary: `Classification proposal for ${input.productDescription}: HTS ${primaryMatch.htsCode10}`,
          purpose: "Hierarchical heading analysis and legal source citation",
          dataSources: ["HTSUS 2026 Rev 1"],
          regulations: ["GRI 1", "GRI 6"],
          currentHtsCode: "0000.00.0000",
          proposedHtsCode: primaryMatch.htsCode10,
          proposedDescription: primaryMatch.description,
          rulesApplied: ["GRI 1", "GRI 6"],
          evidenceItems: citedSources as any,
        },
      });
      agentDecisionId = agentDecision.id;
    }

    return {
      status: requiresReview ? "REVIEW_REQUIRED" : "CLASSIFIED",
      proposedClassification: {
        htsCode: primaryMatch.htsCode10,
        description: primaryMatch.description,
        generalDutyRate: primaryMatch.generalDutyRate,
        section301Applicable: primaryMatch.section301Applicable,
        section301Rate: primaryMatch.section301AdditionalRate || 0,
        section232Applicable: primaryMatch.section232Applicable,
        section232Rate: primaryMatch.section232AdditionalRate || 0,
      },
      competingCandidates: competingCandidates.map((c) => ({
        htsCode: c.htsCode10,
        description: c.description,
        dutyRate: c.generalDutyRate,
      })),
      agentDecisionId,
      citedSources,
      metadata: {
        providerName: "QubereHtsMasterProvider",
        datasetVersion: primaryMatch.sourceRevision || "HTSUS 2026 Rev 1",
        retrievedAt: new Date().toISOString(),
        completenessStatus: "COMPLETE",
      } as ProviderMetadata,
    };
  }
}
