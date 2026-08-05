export interface OCRParseResult {
  rawText: string;
  pageCount: number;
  layoutBlocks: Array<{
    text: string;
    boundingBox?: [number, number, number, number];
  }>;
}

export class OCRAgent {
  static async parseDocument(fileUrl: string): Promise<OCRParseResult> {
    console.log(`[OCRAgent] Processing document layout for: ${fileUrl}`);
    return {
      rawText: "COMMERCIAL INVOICE #INV-2026-001\nVendor: Tokyo Precision Components Ltd.\nItem: Hydraulic Control Valves Model V-400\nQty: 500 pcs\nUnit Price: $120.00\nTotal: $60,000.00\nOrigin: JP",
      pageCount: 1,
      layoutBlocks: [
        { text: "COMMERCIAL INVOICE #INV-2026-001" },
        { text: "Vendor: Tokyo Precision Components Ltd." },
        { text: "Item: Hydraulic Control Valves Model V-400 Qty: 500 Unit Price: $120.00 Total: $60,000.00" },
      ],
    };
  }
}
