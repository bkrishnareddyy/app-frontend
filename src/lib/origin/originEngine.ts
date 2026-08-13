import tradeAgreements from "../../../prisma/seed-data/trade-agreements.json";

export interface MaterialInput {
  id?: string;
  name: string;
  htsCode?: string | null;
  countryOfOrigin?: string | null;
  cost?: number | null;
}

export interface ManufacturingStepInput {
  step: string;
  country: string;
}

export interface ProductOriginInput {
  product: {
    id?: string;
    htsCode: string;
    description: string;
    price?: number | null;
  };
  manufacturingSteps?: ManufacturingStepInput[];
  materials?: MaterialInput[];
  claimedCountry: string;
  tradeAgreementCode?: string | null;
}

export interface OriginGap {
  requirement: string;
  missing: string;
  attributeId?: string;
}

export interface OriginResult {
  determinedCountry: string;
  basis: "SUBSTANTIAL_TRANSFORMATION" | "TARIFF_SHIFT" | "REGIONAL_VALUE_CONTENT" | "SPECIFIC_PROCESS";
  confidence: number; // 0-100
  qualifies: boolean;
  regionalValueContentPct?: number | null;
  gaps: OriginGap[];
}

function cleanHts(hts?: string | null): string {
  if (!hts) return "";
  return hts.replace(/[^0-9]/g, "");
}

function getChapter(hts?: string | null): string {
  const clean = cleanHts(hts);
  return clean.slice(0, 2);
}

function getHeading(hts?: string | null): string {
  const clean = cleanHts(hts);
  return clean.slice(0, 4);
}

/**
 * Pure origin determination engine evaluating substantial transformation,
 * tariff shift, regional value content (RVC), and evidence gaps.
 */
export function determineOrigin(input: ProductOriginInput): OriginResult {
  const { product, manufacturingSteps = [], materials = [], claimedCountry, tradeAgreementCode } = input;
  const gaps: OriginGap[] = [];

  const productHts = product.htsCode;
  const productChapter = getChapter(productHts);
  const productHeading = getHeading(productHts);

  // Check gaps in input materials
  for (const m of materials) {
    if (!m.htsCode) {
      gaps.push({
        requirement: "Tariff shift verification",
        missing: `HTS code of input material "${m.name}" unknown`,
        attributeId: m.id,
      });
    }
    if (m.cost === undefined || m.cost === null) {
      gaps.push({
        requirement: "RVC calculation",
        missing: `Material cost for "${m.name}" not entered`,
        attributeId: m.id,
      });
    }
  }

  // 1. Evaluate Trade Agreement specific rules if tradeAgreementCode provided
  if (tradeAgreementCode) {
    const agreement = tradeAgreements.find(
      (ta) => ta.code.toUpperCase() === tradeAgreementCode.toUpperCase()
    );
    if (agreement) {
      const chapterRules = (agreement.rulesByChapter as Record<string, any>)?.[productChapter] ??
        (agreement.rulesByChapter as Record<string, any>)?.[ "DEFAULT" ] ?? {
          tariffShift: "CHAPTER_CHANGE",
          defaultRvcPct: 60,
          calculationMethod: "net cost",
        };

      // Check Tariff Shift
      let tariffShiftPassed = true;
      for (const m of materials) {
        if (!m.htsCode) {
          tariffShiftPassed = false;
          continue;
        }
        const matChapter = getChapter(m.htsCode);
        const matHeading = getHeading(m.htsCode);
        if (chapterRules.tariffShift === "CHAPTER_CHANGE" && matChapter === productChapter) {
          tariffShiftPassed = false;
        } else if (chapterRules.tariffShift === "HEADING_CHANGE" && matHeading === productHeading) {
          tariffShiftPassed = false;
        }
      }

      // Check RVC
      const totalCost = product.price ?? materials.reduce((sum, m) => sum + (m.cost ?? 0), 0);
      let nonOriginatingCost = 0;
      for (const m of materials) {
        if (m.countryOfOrigin?.toUpperCase() !== claimedCountry.toUpperCase()) {
          nonOriginatingCost += m.cost ?? 0;
        }
      }

      let rvcPct: number | null = null;
      if (totalCost > 0) {
        rvcPct = Math.round((((totalCost - nonOriginatingCost) / totalCost) * 100) * 10) / 10;
      }

      const requiredRvc = chapterRules.defaultRvcPct ?? 60;
      const rvcPassed = rvcPct !== null ? rvcPct >= requiredRvc : false;

      const qualifies = tariffShiftPassed && (rvcPct === null || rvcPassed) && gaps.length === 0;
      const confidence = gaps.length > 0 ? Math.max(50, 90 - gaps.length * 15) : (qualifies ? 95 : 65);

      return {
        determinedCountry: claimedCountry,
        basis: tariffShiftPassed ? "TARIFF_SHIFT" : "REGIONAL_VALUE_CONTENT",
        confidence,
        qualifies,
        regionalValueContentPct: rvcPct,
        gaps,
      };
    }
  }

  // 2. Substantial Transformation Test (Non-FTA default)
  let substantialTransformation = true;
  let hasValidMaterialHts = false;

  for (const m of materials) {
    if (!m.htsCode) continue;
    hasValidMaterialHts = true;
    const matChapter = getChapter(m.htsCode);
    if (matChapter === productChapter) {
      substantialTransformation = false;
    }
  }

  if (!hasValidMaterialHts && manufacturingSteps.length > 0) {
    // If no material HTS but processing steps exist in claimed country
    const inClaimedCountry = manufacturingSteps.some(
      (step) => step.country.toUpperCase() === claimedCountry.toUpperCase()
    );
    if (!inClaimedCountry) substantialTransformation = false;
  }

  const confidence = gaps.length > 0 ? 70 : (substantialTransformation ? 90 : 40);

  return {
    determinedCountry: claimedCountry,
    basis: "SUBSTANTIAL_TRANSFORMATION",
    confidence,
    qualifies: substantialTransformation && gaps.length === 0,
    gaps,
  };
}
