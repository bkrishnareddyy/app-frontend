import { OCRAgent } from "../ocr/ocrAgent";
import { LineItemExtractionAgent } from "../extraction/extractionAgent";
import { HTSClassificationAgent } from "../hts/htsAgent";
import { ECCNAgent } from "../eccn/eccnAgent";
import { ScreeningAgent, type ScreeningStatus } from "../screening/screeningAgent";

export interface OrchestrationResult {
  jobId: string;
  documentId: string;
  status: "COMPLETED" | "FAILED" | "UNAVAILABLE";
  extractedLineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    htsClassification: {
      htsCode: string | null;
      dutyRate: string | null;
      confidenceScore: number | null;
    };
    eccn: {
      eccnCode: string | null;
      licenseRequired: boolean | null;
    };
  }>;
  screening: {
    status: ScreeningStatus;
    screenedParties: string[];
    unavailableReason: string | null;
  };
  /** Set when a stage could not run, so callers do not read the empty result as a clean pass. */
  unavailableReason: string | null;
}

export class AgentOrchestrator {
  static async runTradeCompliancePipeline(
    jobId: string,
    documentId: string,
    fileUrl: string
  ): Promise<OrchestrationResult> {
    console.log(`[Orchestrator] Launching Trade Compliance Agent DAG pipeline for Job ${jobId}...`);

    // Step 1: OCR
    const ocrResult = await OCRAgent.parseDocument(fileUrl);

    // Step 2: Extraction
    const extraction = await LineItemExtractionAgent.extractLineItems(ocrResult.rawText);

    // Step 3 & 4: HTS + ECCN + Screening per Line Item
    const processedItems = [];
    for (const item of extraction.lineItems) {
      const hts = await HTSClassificationAgent.classifyProduct({
        rawDescription: item.description,
        countryOfOrigin: item.countryOfOrigin,
      });
      const topProposal = hts.proposals[0];
      const htsCode = topProposal?.htsCode ?? null;
      const eccn = await ECCNAgent.evaluateExportControls(item.description, htsCode);

      processedItems.push({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        htsClassification: {
          htsCode,
          dutyRate: null,
          confidenceScore: topProposal?.confidence ?? null,
        },
        eccn: {
          eccnCode: eccn.eccnCode,
          licenseRequired: eccn.licenseRequired,
        },
      });
    }

    // The parties on this document are not extracted yet, so there is nobody to
    // screen. This previously screened a hardcoded name and reported the result
    // as though it belonged to the shipment.
    const partyScreening = await ScreeningAgent.screenParty("");

    const unavailableReason = ocrResult.unavailableReason ?? extraction.unavailableReason ?? null;

    return {
      jobId,
      documentId,
      status: unavailableReason ? "UNAVAILABLE" : "COMPLETED",
      extractedLineItems: processedItems,
      screening: {
        status: partyScreening.status,
        screenedParties: [],
        unavailableReason: partyScreening.unavailableReason,
      },
      unavailableReason,
    };
  }
}
