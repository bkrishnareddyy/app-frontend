/**
 * Country-specific labels and configurations for filing UI
 * Supports multi-country filing system (US, NL, IE, FR, IN, etc.)
 */

export interface CountryFilingConfig {
  /** Label for entry/declaration type field */
  entryTypeLabel: string;
  
  /** Label for entry summary section */
  entrySummaryLabel: string;
  
  /** Customs authority name */
  authorityName: string;
  
  /** Form preview tab label */
  formPreviewLabel: string | null; // null = hide tab
  
  /** Post-correction/amendment tab label */
  postCorrectionLabel: string | null; // null = hide tab
  
  /** Post-correction description text */
  postCorrectionDescription: string;
  
  /** Currency code */
  currency: string;
  
  /** Whether to show Form 7501 preview (US only) */
  showForm7501: boolean;
  
  /** Whether to show PSC tab (US only) */
  showPSC: boolean;
}

export const COUNTRY_FILING_CONFIGS: Record<string, CountryFilingConfig> = {
  US: {
    entryTypeLabel: "Entry Type",
    entrySummaryLabel: "Entry Summary",
    authorityName: "CBP",
    formPreviewLabel: "7501 Preview",
    postCorrectionLabel: "Post-Summary Correction",
    postCorrectionDescription: "Submit official CBP post-summary corrections for classification, value, or rate adjustments.",
    currency: "USD",
    showForm7501: true,
    showPSC: true,
  },
  NL: {
    entryTypeLabel: "Declaration Type",
    entrySummaryLabel: "Import Declaration",
    authorityName: "Dutch Customs",
    formPreviewLabel: null, // Hide form preview for NL
    postCorrectionLabel: "Amendment Request",
    postCorrectionDescription: "Submit amendments to your customs declaration for classification, value, or rate adjustments.",
    currency: "EUR",
    showForm7501: false,
    showPSC: false, // Use amendment instead
  },
  IE: {
    entryTypeLabel: "Declaration Type",
    entrySummaryLabel: "Import Declaration",
    authorityName: "Revenue Ireland",
    formPreviewLabel: null,
    postCorrectionLabel: "Amendment Request",
    postCorrectionDescription: "Submit amendments to your AIS customs declaration for classification, value, or rate adjustments.",
    currency: "EUR",
    showForm7501: false,
    showPSC: false,
  },
  FR: {
    entryTypeLabel: "Declaration Type",
    entrySummaryLabel: "Import Declaration",
    authorityName: "French Customs",
    formPreviewLabel: null,
    postCorrectionLabel: "Amendment Request",
    postCorrectionDescription: "Submit amendments to your DELTA-G customs declaration for classification, value, or rate adjustments.",
    currency: "EUR",
    showForm7501: false,
    showPSC: false,
  },
  IN: {
    entryTypeLabel: "Import Type",
    entrySummaryLabel: "Bill of Entry",
    authorityName: "Indian Customs (ICEGATE)",
    formPreviewLabel: null,
    postCorrectionLabel: "Re-assessment Request",
    postCorrectionDescription: "Submit re-assessment request for Bill of Entry corrections for classification, value, or rate adjustments.",
    currency: "INR",
    showForm7501: false,
    showPSC: false,
  },
};

/**
 * Get filing configuration for a country
 * Defaults to US configuration if country not found
 */
export function getFilingConfig(country: string | null | undefined): CountryFilingConfig {
  const countryCode = (country || "US").toUpperCase();
  return COUNTRY_FILING_CONFIGS[countryCode] || COUNTRY_FILING_CONFIGS.US;
}

/**
 * Get currency symbol for a country
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: "$",
    EUR: "€",
    INR: "₹",
    GBP: "£",
  };
  return symbols[currency] || currency;
}

/**
 * Format currency amount for display
 */
export function formatCurrencyAmount(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return "—";
  
  const symbol = getCurrencySymbol(currency);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  
  return `${symbol}${formatted}`;
}
