export interface ParsedDutyRate {
  rawRateText: string;
  rateType: "Free" | "AdValorem" | "Specific" | "Compound" | "Unparsed";
  adValoremPercent: number | null;
  specificAmount: number | null;
  specificUnit: string | null;
  currency: string;
  isFree: boolean;
  parseStatus: "PARSED" | "UNPARSED_FALLBACK";
  programCode?: string | null;
}

export class RateParser {
  /**
   * Parse a raw HTS duty rate string (e.g. "Free", "2.8%", "1.5¢/kg", "2.8% + 15¢/kg") into a structured duty rate object.
   */
  static parse(rawRateText: string, rateColumn: string = "General", programCode?: string | null): ParsedDutyRate {
    const trimmed = (rawRateText || "").trim();

    if (!trimmed || trimmed.toLowerCase() === "free" || trimmed.toLowerCase().startsWith("free ")) {
      return {
        rawRateText: trimmed || "Free",
        rateType: "Free",
        adValoremPercent: 0,
        specificAmount: 0,
        specificUnit: null,
        currency: "USD",
        isFree: true,
        parseStatus: "PARSED",
        programCode: programCode || null,
      };
    }

    // Match simple Ad Valorem percentage, e.g. "2.8%" or "15%"
    const adValoremMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*%$/);
    if (adValoremMatch) {
      const percent = parseFloat(adValoremMatch[1]);
      return {
        rawRateText: trimmed,
        rateType: "AdValorem",
        adValoremPercent: percent,
        specificAmount: null,
        specificUnit: null,
        currency: "USD",
        isFree: percent === 0,
        parseStatus: "PARSED",
        programCode: programCode || null,
      };
    }

    // Match specific rate, e.g. "1.5¢/kg" or "$0.02/kg" or "45¢/liter"
    const specificMatch = trimmed.match(/^(\$?|¢?)([0-9]+(?:\.[0-9]+)?)\s*(¢|\$)?\s*\/\s*([a-zA-Z0-9\.\_\-]+)$/);
    if (specificMatch) {
      let amount = parseFloat(specificMatch[2]);
      const prefix = specificMatch[1];
      const suffix = specificMatch[3];
      if (prefix === "¢" || suffix === "¢") {
        amount = amount / 100; // convert cents to dollars
      }
      const unit = specificMatch[4];
      return {
        rawRateText: trimmed,
        rateType: "Specific",
        adValoremPercent: null,
        specificAmount: amount,
        specificUnit: unit,
        currency: "USD",
        isFree: amount === 0,
        parseStatus: "PARSED",
        programCode: programCode || null,
      };
    }

    // Match compound rate, e.g. "2.8% + 15¢/kg" or "5.5% + $0.05/kg"
    const compoundMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*%\s*\+\s*(\$?|¢?)([0-9]+(?:\.[0-9]+)?)\s*(¢|\$)?\s*\/\s*([a-zA-Z0-9\.\_\-]+)$/);
    if (compoundMatch) {
      const percent = parseFloat(compoundMatch[1]);
      let amount = parseFloat(compoundMatch[3]);
      const prefix = compoundMatch[2];
      const suffix = compoundMatch[4];
      if (prefix === "¢" || suffix === "¢") {
        amount = amount / 100;
      }
      const unit = compoundMatch[5];
      return {
        rawRateText: trimmed,
        rateType: "Compound",
        adValoremPercent: percent,
        specificAmount: amount,
        specificUnit: unit,
        currency: "USD",
        isFree: false,
        parseStatus: "PARSED",
        programCode: programCode || null,
      };
    }

    // Fallback for complex expressions
    return {
      rawRateText: trimmed,
      rateType: "Unparsed",
      adValoremPercent: null,
      specificAmount: null,
      specificUnit: null,
      currency: "USD",
      isFree: false,
      parseStatus: "UNPARSED_FALLBACK",
      programCode: programCode || null,
    };
  }
}
