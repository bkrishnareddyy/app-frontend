export interface ExtractedLineItem {
  partNumber?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  countryOfOrigin?: string;
}

export interface LineItemExtractionResult {
  lineItems: ExtractedLineItem[];
  /** Why extraction did not run. Null when it genuinely ran. */
  unavailableReason: string | null;
}

/**
 * No extraction model is wired up in this build. This previously returned a
 * fixed hydraulic-valve line item regardless of the text supplied.
 */
export class LineItemExtractionAgent {
  static async extractLineItems(rawText: string): Promise<LineItemExtractionResult> {
    return {
      lineItems: [],
      unavailableReason: rawText.trim()
        ? "No line-item extraction model is configured, so the document text has not been parsed."
        : "No document text was available to extract line items from.",
    };
  }
}
