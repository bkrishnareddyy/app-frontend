export interface ExtractedLineItem {
  partNumber?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  countryOfOrigin?: string;
}

export class LineItemExtractionAgent {
  static async extractLineItems(rawText: string): Promise<ExtractedLineItem[]> {
    console.log(`[ExtractionAgent] Parsing line items from text payload...`);
    return [
      {
        partNumber: "V-400-HYD",
        description: "Hydraulic Control Valves Model V-400 for industrial fluid control",
        quantity: 500,
        unitPrice: 120.0,
        totalValue: 60000.0,
        countryOfOrigin: "JP",
      },
    ];
  }
}
