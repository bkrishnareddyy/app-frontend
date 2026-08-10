export interface ECCNResult {
  eccnCode: string | null;
  /** Null unless export controls were actually evaluated. */
  licenseRequired: boolean | null;
  controlReasons: string[];
  /** Why controls were not evaluated. Null when the check genuinely ran. */
  unavailableReason: string | null;
}

/**
 * No export-control data source is wired up in this build. This previously
 * returned EAR99 / no licence required for every product.
 */
export class ECCNAgent {
  static async evaluateExportControls(description: string, htsCode: string | null): Promise<ECCNResult> {
    const subject = description.trim() ? `"${description.trim()}"` : "this line item";
    return {
      eccnCode: null,
      licenseRequired: null,
      controlReasons: [],
      unavailableReason: `No export-control data source is configured, so ${subject}${htsCode ? ` (HTS ${htsCode})` : ""} has not been evaluated against the EAR.`,
    };
  }
}
