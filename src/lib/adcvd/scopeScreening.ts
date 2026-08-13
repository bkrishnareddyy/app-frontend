import { db } from "../db";

export interface ScopeScreeningInput {
  htsCode?: string | null;
  countryOfOrigin?: string | null;
  productDescription?: string | null;
  physicalCharacteristics?: string | null;
}

export interface AdcvdScopeResult {
  caseNumber: string;
  title: string;
  inScope: "YES" | "POSSIBLY" | "NO";
  confidence: number;
  scopeLanguageMatch: string;
  reasoning?: string;
}

function cleanHts(code?: string | null): string {
  if (!code) return "";
  return code.replace(/[^0-9]/g, "");
}

/**
 * Screens product HTS code, country of origin, and description against active AD/CVD orders.
 */
export async function screenForAdcvd(input: ScopeScreeningInput): Promise<{ orders: AdcvdScopeResult[] }> {
  const { htsCode, countryOfOrigin, productDescription } = input;
  const normalizedInputHts = cleanHts(htsCode);

  const activeOrders = await db.adcvdOrder.findMany({
    where: { status: "ACTIVE" },
  });

  const results: AdcvdScopeResult[] = [];

  for (const order of activeOrders) {
    const htsMatches = order.htsCodesInScope.some((inScopeHts) => {
      const cleanInScope = cleanHts(inScopeHts);
      return cleanInScope === normalizedInputHts || (cleanInScope.length >= 6 && normalizedInputHts.startsWith(cleanInScope.slice(0, 6)));
    });

    const countryMatches = countryOfOrigin
      ? order.respondentCountries.map((c) => c.toUpperCase()).includes(countryOfOrigin.toUpperCase())
      : false;

    let textMatches = false;
    if (productDescription && order.scopeLanguage) {
      const descLower = productDescription.toLowerCase();
      const titleLower = order.title.toLowerCase();
      textMatches = titleLower.split(" ").some((term) => term.length > 4 && descLower.includes(term));
    }

    if (htsMatches && countryMatches) {
      results.push({
        caseNumber: order.caseNumber,
        title: order.title,
        inScope: "YES",
        confidence: 95,
        scopeLanguageMatch: order.scopeLanguage,
        reasoning: `HTS code ${htsCode} and country ${countryOfOrigin} match active AD/CVD order ${order.caseNumber}.`,
      });
    } else if (htsMatches && !countryMatches) {
      results.push({
        caseNumber: order.caseNumber,
        title: order.title,
        inScope: "POSSIBLY",
        confidence: 65,
        scopeLanguageMatch: order.scopeLanguage,
        reasoning: `HTS code ${htsCode} matches active AD/CVD order scope, but country of origin (${countryOfOrigin ?? "unknown"}) requires confirmation or scope ruling.`,
      });
    } else if (textMatches) {
      results.push({
        caseNumber: order.caseNumber,
        title: order.title,
        inScope: "POSSIBLY",
        confidence: 50,
        scopeLanguageMatch: order.scopeLanguage,
        reasoning: `Product description matches terms in AD/CVD order ${order.caseNumber} scope description.`,
      });
    }
  }

  if (results.length === 0) {
    return { orders: [] };
  }

  return { orders: results };
}
