export interface OCRParseResult {
  rawText: string;
  pageCount: number;
  layoutBlocks: Array<{
    text: string;
    boundingBox?: [number, number, number, number];
  }>;
  /** Why the document was not read. Null when OCR genuinely ran. */
  unavailableReason: string | null;
}

/**
 * No OCR provider is wired up in this build. This previously returned a fixed
 * commercial invoice for a Tokyo vendor regardless of which file was supplied.
 */
export class OCRAgent {
  static async parseDocument(fileUrl: string): Promise<OCRParseResult> {
    return {
      rawText: "",
      pageCount: 0,
      layoutBlocks: [],
      unavailableReason: `No OCR provider is configured, so ${fileUrl || "the document"} has not been read.`,
    };
  }
}
