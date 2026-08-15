import { db } from "../db";

export interface ClassificationSection {
  lineItemNumber: number;
  htsCode: string;
  description: string;
  griSteps: string[];
  rulingCitations: string[];
  approver: string;
}

export interface ValuationSection {
  invoiceValue: number;
  currency: string;
  assistsTotal: number | null;
  royalties: number | null;
  commissions: number | null;
  freightDeductions: number | null;
  insuranceDeductions: number | null;
  declaredCustomsValue: number;
  relatedPartyFlag: boolean;
}

export interface OriginSection {
  claimedCountry: string;
  determinedCountry: string;
  qualifies: boolean;
  basis: string;
  tradeAgreementCode?: string | null;
  regionalValueContentPct?: number | null;
}

export interface DocumentSection {
  documentId: string;
  fileName: string;
  docType: string;
  checksum: string | null;
  status: string;
}

export interface DecisionSection {
  decisionId: string;
  agentName: string;
  status: string;
  autoApproved: boolean;
  confidence: number | null;
}

export interface ExceptionSection {
  id: string;
  category: string;
  severity: string;
  description: string;
  status: string;
}

export interface ReasonableCarePackage {
  shipmentId: string;
  entryNumber: string;
  importerOfRecord: {
    name: string;
    cbpNumber?: string | null;
  };
  generatedAt: string;
  completenessScore: number;
  sections: {
    classification: ClassificationSection[];
    valuation: ValuationSection;
    origin: OriginSection;
    documents: DocumentSection[];
    decisions: DecisionSection[];
    exceptions: ExceptionSection[];
  };
  certifications: Array<{
    role: string;
    name: string;
    date: string;
    signature?: string | null;
  }>;
}

/**
 * Pure reasonable care package assembler pulling real data from the database.
 * Scoped to `accountId` so a shipment ID from another tenant can never resolve.
 */
export async function assembleReasonableCarePackage(accountId: string, shipmentId: string): Promise<ReasonableCarePackage | null> {
  const shipment = await db.shipment.findFirst({
    where: { id: shipmentId, accountId },
    include: {
      importerOfRecord: true,
      lineItems: {
        include: {
          origins: { include: { tradeAgreement: true } },
        },
      },
      documents: true,
      customsFilings: {
        include: {
          valuationAssistsRecord: true,
        },
      },
      exceptionItems: true,
      agentDecisions: true,
    },
  });

  if (!shipment) return null;

  const filing = shipment.customsFilings[0] ?? null;
  const entryNumber = filing?.entryNumber ?? `ENT-${shipment.shipmentNumber}`;

  // Assemble Classification section
  const classification: ClassificationSection[] = [];
  for (const line of shipment.lineItems) {
    let griSteps: string[] = [];
    let rulingCitations: string[] = [];
    let approver = "";

    if (line.productId) {
      const canonicalProduct = await db.canonicalProduct.findFirst({
        where: { accountId: shipment.accountId, productId: line.productId },
        select: { id: true },
      });

      if (canonicalProduct) {
        const cCase = await db.classificationCase.findFirst({
          where: {
            accountId: shipment.accountId,
            subjects: { some: { canonicalProductId: canonicalProduct.id } },
          },
          include: {
            decisions: {
              where: { decisionStatus: "APPROVED" },
              orderBy: { attestedAt: "desc" },
              take: 1,
            },
            runs: {
              orderBy: { startedAt: "desc" },
              take: 1,
              include: {
                proposals: {
                  orderBy: { rank: "asc" },
                  take: 1,
                  include: {
                    griSteps: { orderBy: { sequence: "asc" } },
                    evidenceItems: true,
                  },
                },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        });

        if (cCase) {
          const proposal = cCase.runs[0]?.proposals[0];
          if (proposal) {
            griSteps = proposal.griSteps.map((step) => `${step.griRule}: ${step.conclusion}`);
            rulingCitations = proposal.evidenceItems
              .filter((ev) => ev.evidenceType === "CROSS_RULING")
              .map((ev) => ev.citation);
          }
          const decision = cCase.decisions[0];
          if (decision) {
            const reviewer = await db.user.findUnique({
              where: { id: decision.reviewerUserId },
              select: { firstName: true, lastName: true, email: true },
            });
            if (reviewer) {
              const fullName = [reviewer.firstName, reviewer.lastName].filter(Boolean).join(" ");
              approver = fullName || reviewer.email;
            } else {
              approver = "System Approved";
            }
          }
        }
      }
    }

    classification.push({
      lineItemNumber: line.lineNumber,
      htsCode: line.htsCode,
      description: line.description,
      griSteps,
      rulingCitations,
      approver,
    });
  }

  // Assemble Valuation section (using line items total values)
  const totalValue = shipment.lineItems.reduce((sum, item) => sum + Number(item.totalValue), 0);
  const valuationRecord = filing?.valuationAssistsRecord ?? null;

  let assistsTotal = 0;
  if (valuationRecord?.potentialAssists) {
    try {
      const assists = typeof valuationRecord.potentialAssists === "string"
        ? JSON.parse(valuationRecord.potentialAssists)
        : (valuationRecord.potentialAssists as any);
      if (Array.isArray(assists)) {
        assistsTotal = assists.reduce((sum: number, assist: any) => sum + Number(assist.estimatedValue || 0), 0);
      }
    } catch (e) {
      console.error("Failed to parse potentialAssists", e);
    }
  }

  const valuation: ValuationSection = {
    invoiceValue: totalValue,
    currency: "USD",
    assistsTotal: valuationRecord ? assistsTotal : null,
    royalties: null,
    commissions: null,
    freightDeductions: null,
    insuranceDeductions: null,
    declaredCustomsValue: valuationRecord ? Number(valuationRecord.declaredValue) : totalValue,
    relatedPartyFlag: valuationRecord ? valuationRecord.relatedPartyTransaction : false,
  };

  // Assemble Origin section (first line item origin as representative)
  const firstLine = shipment.lineItems[0];
  const firstOrigin = firstLine?.origins[0] ?? null;
  const origin: OriginSection = {
    claimedCountry: firstLine?.countryOfOrigin ?? "Unknown",
    determinedCountry: firstLine?.countryOfOrigin ?? "Unknown",
    qualifies: firstOrigin ? firstOrigin.qualifies : false,
    basis: firstOrigin ? firstOrigin.criterion : "SUBSTANTIAL_TRANSFORMATION",
    tradeAgreementCode: firstOrigin?.tradeAgreement.code ?? null,
    regionalValueContentPct: firstOrigin?.regionalValueContentPct ? Number(firstOrigin.regionalValueContentPct) : null,
  };

  // Documents Section
  const documents: DocumentSection[] = shipment.documents.map((d) => ({
    documentId: d.id,
    fileName: d.fileName,
    docType: d.docType || "Unknown",
    checksum: d.checksum || null,
    status: d.checksum ? "Verified" : "Unverified",
  }));

  // Decisions Section
  const decisions: DecisionSection[] = shipment.agentDecisions.map((ad) => ({
    decisionId: ad.id,
    agentName: ad.agentName,
    status: ad.status,
    autoApproved: ad.autoApproved,
    confidence: ad.confidence ?? null,
  }));

  // Exceptions Section
  const exceptions: ExceptionSection[] = shipment.exceptionItems.map((e) => ({
    id: e.id,
    category: e.category || "GENERAL",
    severity: e.severity,
    description: e.description,
    status: e.status,
  }));

  // Calculate Completeness Score
  let filledSections = 0;
  const totalSections = 6;
  if (classification.length > 0) filledSections++;
  if (valuation.declaredCustomsValue > 0) filledSections++;
  if (origin.determinedCountry !== "Unknown") filledSections++;
  if (documents.length > 0) filledSections++;
  if (decisions.length > 0) filledSections++;
  if (exceptions.length === 0 || exceptions.some((e) => e.status === "Resolved")) filledSections++;
  const completenessScore = Math.round((filledSections / totalSections) * 100);

  return {
    shipmentId: shipment.id,
    entryNumber,
    importerOfRecord: {
      name: shipment.importerOfRecord?.name ?? shipment.importerName ?? null,
      cbpNumber: shipment.importerOfRecord?.cbpImporterNumber ?? null,
    },
    generatedAt: new Date().toISOString(),
    completenessScore,
    sections: {
      classification,
      valuation,
      origin,
      documents,
      decisions,
      exceptions,
    },
    certifications: [],
  };
}
