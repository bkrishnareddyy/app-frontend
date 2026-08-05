import { OCRAgent } from "../ocr/ocrAgent";
import { LineItemExtractionAgent } from "../extraction/extractionAgent";
import { HTSClassificationAgent } from "../hts/htsAgent";
import { ECCNAgent } from "../eccn/eccnAgent";
import { ScreeningAgent } from "../screening/screeningAgent";

export interface OrchestrationResult {
  jobId: string;
  documentId: string;
  status: "COMPLETED" | "FAILED";
  extractedLineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    htsClassification: {
      htsCode: string;
      dutyRate: string;
      confidenceScore: number;
    };
    eccn: {
      eccnCode: string;
      licenseRequired: boolean;
    };
  }>;
  screeningPassed: boolean;
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
    const lineItems = await LineItemExtractionAgent.extractLineItems(ocrResult.rawText);

    // Step 3 & 4: HTS + ECCN + Screening per Line Item
    const processedItems = [];
    for (const item of lineItems) {
      const hts = await HTSClassificationAgent.classifyProduct(item.description, item.countryOfOrigin);
      const eccn = await ECCNAgent.evaluateExportControls(item.description, hts.htsCode);

      processedItems.push({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        htsClassification: {
          htsCode: hts.htsCode,
          dutyRate: hts.dutyRate,
          confidenceScore: hts.confidenceScore,
        },
        eccn: {
          eccnCode: eccn.eccnCode,
          licenseRequired: eccn.licenseRequired,
        },
      });
    }

    const partyScreening = await ScreeningAgent.screenParty("Tokyo Precision Components Ltd.", "JP");

    return {
      jobId,
      documentId,
      status: "COMPLETED",
      extractedLineItems: processedItems,
      screeningPassed: partyScreening.isPassed,
    };
  }
}
