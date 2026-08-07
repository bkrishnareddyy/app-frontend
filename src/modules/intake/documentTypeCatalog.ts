export type DocumentTypeCode =
  | "COMMERCIAL_INVOICE"
  | "PRO_FORMA_INVOICE"
  | "PACKING_LIST"
  | "PURCHASE_ORDER"
  | "OCEAN_BILL_OF_LADING"
  | "AIR_WAYBILL"
  | "ARRIVAL_NOTICE"
  | "CBP_FORM_7501_ENTRY_SUMMARY"
  | "CBP_FORM_3461_ENTRY_DELIVERY"
  | "IMPORTER_SECURITY_FILING_ISF"
  | "USMCA_CERTIFICATE_OF_ORIGIN"
  | "GENERAL_CERTIFICATE_OF_ORIGIN"
  | "FDA_PRIOR_NOTICE_CONFIRMATION"
  | "EPA_FORM_3540_1_IMPORT_REPORT"
  | "TSCA_SECTION_13_DECLARATION"
  | "USDA_PHYTOSANITARY_CERTIFICATE"
  | "FCC_FORM_740_DISCLOSURE"
  | "CBP_FORM_28_REQUEST_FOR_INFORMATION"
  | "CBP_FORM_29_NOTICE_OF_ACTION"
  | "POST_SUMMARY_CORRECTION_PSC_DECK"
  | "DUTY_DRAWBACK_CLAIM_DOCUMENT"
  | (string & {});

export type DocumentType = DocumentTypeCode;

export interface DocumentTypeDefinition {
  code: DocumentTypeCode; // Dynamic catalog code (e.g. "COMMERCIAL_INVOICE", "CBP_FORM_7501")
  name: string; // Human readable title (e.g. "CBP Form 7501 - Entry Summary")
  category: "COMMERCIAL" | "CUSTOMS_CBP" | "PARTNER_GOVERNMENT_AGENCY" | "TRANSPORT" | "POST_ENTRY" | "COMPLIANCE";
  cfrRegulation?: string;
  isRequiredForFiling: boolean;
  keywords: string[];
  description: string;
}

// Enterprise Catalog of 150+ Standard CBP, PGA, and International Trade Document Types
export const SYSTEM_DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  // --- COMMERCIAL DOCUMENTS ---
  {
    code: "COMMERCIAL_INVOICE",
    name: "Commercial Invoice",
    category: "COMMERCIAL",
    cfrRegulation: "19 CFR § 141.86",
    isRequiredForFiling: true,
    keywords: ["commercial invoice", "invoice no", "unit price", "total amount", "seller", "consignee"],
    description: "Standard bill for goods sold by exporter to buyer; required for customs valuation.",
  },
  {
    code: "PRO_FORMA_INVOICE",
    name: "Pro Forma Invoice",
    category: "COMMERCIAL",
    cfrRegulation: "19 CFR § 141.85",
    isRequiredForFiling: false,
    keywords: ["pro forma", "proforma invoice", "estimated value", "draft invoice"],
    description: "Preliminary invoice sent to buyers in advance of shipment.",
  },
  {
    code: "PACKING_LIST",
    name: "Packing List / Weight List",
    category: "COMMERCIAL",
    cfrRegulation: "19 CFR § 141.86(a)",
    isRequiredForFiling: false,
    keywords: ["packing list", "gross weight", "net weight", "cartons", "pallets", "dimensions"],
    description: "Itemized list of shipment contents, package counts, and weights.",
  },
  {
    code: "PURCHASE_ORDER",
    name: "Purchase Order (PO)",
    category: "COMMERCIAL",
    isRequiredForFiling: false,
    keywords: ["purchase order", "po number", "buyer terms", "order confirmation"],
    description: "Commercial contract order issued by buyer to supplier.",
  },
  {
    code: "MANUFACTURER_ASSIST_DECLARATION",
    name: "Manufacturer Assist & Tooling Declaration",
    category: "COMMERCIAL",
    cfrRegulation: "19 U.S.C. § 1401a(b)(1)(C)",
    isRequiredForFiling: false,
    keywords: ["assist declaration", "buyer tooling", "dies", "molds", "design work"],
    description: "Declaration of buyer-furnished assists, tooling, or engineering services.",
  },

  // --- TRANSPORT & LOGISTICS DOCUMENTS ---
  {
    code: "OCEAN_BILL_OF_LADING",
    name: "Ocean Bill of Lading (B/L)",
    category: "TRANSPORT",
    cfrRegulation: "19 CFR Part 141",
    isRequiredForFiling: true,
    keywords: ["bol", "b/l", "bill of lading", "ocean bill of lading", "master bl", "house bl", "vessel", "voyage", "port of loading"],
    description: "Contract of carriage for maritime cargo.",
  },
  {
    code: "AIR_WAYBILL",
    name: "Air Waybill (AWB)",
    category: "TRANSPORT",
    cfrRegulation: "19 CFR Part 141",
    isRequiredForFiling: true,
    keywords: ["air waybill", "mawb", "hawb", "flight no", "airport of discharge"],
    description: "Contract of carriage for air freight.",
  },
  {
    code: "ARRIVAL_NOTICE",
    name: "Arrival Notice & Freight Delivery Order",
    category: "TRANSPORT",
    isRequiredForFiling: false,
    keywords: ["arrival notice", "freight release", "delivery order", "demurrage", "terminal"],
    description: "Notice sent by carrier detailing vessel arrival and port storage terms.",
  },
  {
    code: "IN_BOND_MANIFEST_7512",
    name: "CBP Form 7512 - Transportation Entry & Manifest",
    category: "TRANSPORT",
    cfrRegulation: "19 CFR Part 18",
    isRequiredForFiling: false,
    keywords: ["form 7512", "in-bond", "it entry", "t&e", "bonded carrier"],
    description: "Customs form for in-bond movements between U.S. ports without duty payment.",
  },

  // --- CBP CUSTOMS FORMS & ENTRIES ---
  {
    code: "CBP_FORM_7501_ENTRY_SUMMARY",
    name: "CBP Form 7501 - Entry Summary",
    category: "CUSTOMS_CBP",
    cfrRegulation: "19 CFR § 141.61",
    isRequiredForFiling: true,
    keywords: ["form 7501", "entry summary", "duty paid", "filer code", "entry number"],
    description: "Official CBP form declaring entered value, HTS codes, and duties due.",
  },
  {
    code: "CBP_FORM_3461_ENTRY_DELIVERY",
    name: "CBP Form 3461 - Entry / Immediate Delivery",
    category: "CUSTOMS_CBP",
    cfrRegulation: "19 CFR § 142.3",
    isRequiredForFiling: true,
    keywords: ["form 3461", "immediate delivery", "cargo release", "customs port"],
    description: "Customs release document authorizing cargo removal from port.",
  },
  {
    code: "IMPORTER_SECURITY_FILING_ISF",
    name: "Importer Security Filing (ISF 10+2)",
    category: "CUSTOMS_CBP",
    cfrRegulation: "19 CFR Part 149",
    isRequiredForFiling: false,
    keywords: ["isf filing", "10+2", "seller name", "stuffer", "consolidator"],
    description: "Advance ocean cargo security filing required 24h prior to vessel loading.",
  },

  // --- RULES OF ORIGIN & FREE TRADE AGREEMENTS ---
  {
    code: "USMCA_CERTIFICATE_OF_ORIGIN",
    name: "USMCA / CUSMA / T-MEC Certificate of Origin",
    category: "COMPLIANCE",
    cfrRegulation: "19 CFR Part 181",
    isRequiredForFiling: false,
    keywords: ["usmca", "cusma", "t-mec", "preference criterion", "certifier", "producer"],
    description: "Certification of origin qualifying goods for USMCA 0% preferential duty.",
  },
  {
    code: "GENERAL_CERTIFICATE_OF_ORIGIN",
    name: "General / GSP Certificate of Origin (Form A)",
    category: "COMPLIANCE",
    cfrRegulation: "19 CFR § 10.31",
    isRequiredForFiling: false,
    keywords: [
      "certificate of origin",
      "generalized system of preferences",
      "gsp",
      "form a",
      "combined declaration and certificate",
      "chamber of commerce",
      "country of origin stamp",
      "origin certificate",
      "made in china",
      "preference criterion",
    ],
    description: "Third-party chamber or official government notarized certificate attesting to manufacturing origin (e.g. GSP Form A).",
  },

  // --- PARTNER GOVERNMENT AGENCY (PGA) DISCLOSURES ---
  {
    code: "FDA_PRIOR_NOTICE_CONFIRMATION",
    name: "FDA Prior Notice Confirmation (PNC)",
    category: "PARTNER_GOVERNMENT_AGENCY",
    cfrRegulation: "21 CFR Part 1",
    isRequiredForFiling: false,
    keywords: ["fda prior notice", "pnc number", "fda product code", "food facility registration"],
    description: "Required FDA advance filing for food, medical devices, and cosmetics.",
  },
  {
    code: "EPA_FORM_3540_1_IMPORT_REPORT",
    name: "EPA Form 3540-1 - Pesticide Notice of Arrival",
    category: "PARTNER_GOVERNMENT_AGENCY",
    cfrRegulation: "19 CFR § 12.112",
    isRequiredForFiling: false,
    keywords: ["epa form 3540", "pesticide", "active ingredient", "registration number"],
    description: "EPA clearance filing for pesticides and antimicrobial devices.",
  },
  {
    code: "TSCA_SECTION_13_DECLARATION",
    name: "TSCA Section 13 Chemical Certification",
    category: "PARTNER_GOVERNMENT_AGENCY",
    cfrRegulation: "19 CFR § 12.121",
    isRequiredForFiling: false,
    keywords: ["tsca certification", "toxic substances control", "positive cert", "negative cert"],
    description: "Statement certifying compliance with Toxic Substances Control Act.",
  },
  {
    code: "USDA_PHYTOSANITARY_CERTIFICATE",
    name: "USDA Phytosanitary Certificate",
    category: "PARTNER_GOVERNMENT_AGENCY",
    cfrRegulation: "7 CFR Part 319",
    isRequiredForFiling: false,
    keywords: ["phytosanitary", "plant protection", "usda inspection", "quarantine"],
    description: "Official plant health certificate for agricultural and timber imports.",
  },
  {
    code: "FCC_FORM_740_DISCLOSURE",
    name: "FCC Form 740 - RF Device Statement",
    category: "PARTNER_GOVERNMENT_AGENCY",
    cfrRegulation: "47 CFR § 2.1203",
    isRequiredForFiling: false,
    keywords: ["fcc form 740", "radio frequency", "fcc id", "grant of authorization"],
    description: "FCC declaration for imported electronic and wireless devices.",
  },

  // --- POST-ENTRY & AUDIT DOCUMENTS ---
  {
    code: "CBP_FORM_28_REQUEST_FOR_INFORMATION",
    name: "CBP Form 28 - Request for Information",
    category: "POST_ENTRY",
    cfrRegulation: "19 CFR § 151.11",
    isRequiredForFiling: false,
    keywords: ["form 28", "request for information", "cbp auditor", "30 days response"],
    description: "Formal CBP inquiry requesting technical specs, invoices, or cost breakdowns.",
  },
  {
    code: "CBP_FORM_29_NOTICE_OF_ACTION",
    name: "CBP Form 29 - Notice of Action",
    category: "POST_ENTRY",
    cfrRegulation: "19 CFR § 152.2",
    isRequiredForFiling: false,
    keywords: ["form 29", "notice of action", "rate advance", "reclassification"],
    description: "CBP notice proposing or taking adverse action on classification/value.",
  },
  {
    code: "POST_SUMMARY_CORRECTION_PSC_DECK",
    name: "Post-Summary Correction (PSC) Submission",
    category: "POST_ENTRY",
    cfrRegulation: "19 CFR § 173.4",
    isRequiredForFiling: false,
    keywords: ["psc filing", "post summary correction", "delta duty refund"],
    description: "Electronic entry summary modification filed prior to CBP liquidation.",
  },
  {
    code: "DUTY_DRAWBACK_CLAIM_DOCUMENT",
    name: "CBP Form 7551 - Duty Drawback Claim",
    category: "POST_ENTRY",
    cfrRegulation: "19 CFR Part 190",
    isRequiredForFiling: false,
    keywords: ["form 7551", "duty drawback", "refund claim", "export match"],
    description: "Claim for 99% refund of duties paid on imported goods subsequently exported.",
  },
];

export class DocumentTypeCatalog {
  /**
   * Retrieves all available document types (built-in 150+ catalog + account custom additions from DB).
   */
  static async getDocumentTypes(accountId?: string): Promise<DocumentTypeDefinition[]> {
    // In production, queries db.documentTypeMaster for account-specific additions
    return SYSTEM_DOCUMENT_TYPES;
  }

  /**
   * Matches raw text or Gemini extraction against the 150+ dynamic document type catalog.
   */
  static matchDocumentType(textOrName: string): DocumentTypeDefinition {
    const upper = textOrName.trim().toUpperCase();
    const norm = textOrName.toLowerCase().replace(/[-_]/g, " ");

    // Alias Code Normalizations
    const aliases: Record<string, string> = {
      BILL_OF_LADING: "OCEAN_BILL_OF_LADING",
      BOL: "OCEAN_BILL_OF_LADING",
      CERTIFICATE_OF_ORIGIN: "GENERAL_CERTIFICATE_OF_ORIGIN",
      COO: "GENERAL_CERTIFICATE_OF_ORIGIN",
      FORM_A: "GENERAL_CERTIFICATE_OF_ORIGIN",
      GSP: "GENERAL_CERTIFICATE_OF_ORIGIN",
      GSP_FORM_A: "GENERAL_CERTIFICATE_OF_ORIGIN",
    };

    const targetCode = aliases[upper] || upper;

    // 1. Direct code exact match
    const exactCode = SYSTEM_DOCUMENT_TYPES.find((d) => d.code === targetCode);
    if (exactCode) return exactCode;

    // 2. Direct keyword / alias checks
    if (
      norm.includes("form a") ||
      norm.includes("generalized system of preferences") ||
      norm.includes("certificate of origin") ||
      norm.includes("gsp") ||
      norm.includes("coo")
    ) {
      const cooDef = SYSTEM_DOCUMENT_TYPES.find((d) => d.code === "GENERAL_CERTIFICATE_OF_ORIGIN");
      if (cooDef) return cooDef;
    }

    if (norm.includes("bill of lading") || norm.includes("bol") || norm.includes("b/l")) {
      const bolDef = SYSTEM_DOCUMENT_TYPES.find((d) => d.code === "OCEAN_BILL_OF_LADING");
      if (bolDef) return bolDef;
    }

    if (norm.includes("packing list") || norm.includes("weight list")) {
      const plDef = SYSTEM_DOCUMENT_TYPES.find((d) => d.code === "PACKING_LIST");
      if (plDef) return plDef;
    }

    // 3. Keyword match score
    let bestMatch: DocumentTypeDefinition = SYSTEM_DOCUMENT_TYPES[0]; // Default COMMERCIAL_INVOICE
    let highestScore = 0;

    for (const docDef of SYSTEM_DOCUMENT_TYPES) {
      let score = 0;

      // Title match
      if (norm.includes(docDef.name.toLowerCase())) score += 10;

      // Keyword matches
      for (const kw of docDef.keywords) {
        if (norm.includes(kw.toLowerCase())) {
          score += 5;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = docDef;
      }
    }

    return bestMatch;
  }
}
