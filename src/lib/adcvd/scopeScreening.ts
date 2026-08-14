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

async function analyzeScopeWithClaude(
  input: ScopeScreeningInput,
  order: { caseNumber: string; title: string; scopeLanguage: string },
  initialReasoning: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return `${initialReasoning} [GRI Analysis: Step 1: Subheading / keyword match identified. Step 2: Country of origin or technical specification unverified. Step 3: Formal CBP scope ruling recommended.]`;
  }

  try {
    const { Anthropic } = await import("@anthropic-ai/sdk");
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 350,
      messages: [
        {
          role: "user",
          content: `Perform a detailed AD/CVD scope screening analysis with General Rules of Interpretation (GRI) step reasoning for the following item against AD/CVD Order ${order.caseNumber} (${order.title}).
          
Product Info:
- HTS Code: ${input.htsCode ?? "N/A"}
- Country of Origin: ${input.countryOfOrigin ?? "N/A"}
- Description: ${input.productDescription ?? "N/A"}
- Physical Characteristics: ${input.physicalCharacteristics ?? "N/A"}

AD/CVD Scope Language:
${order.scopeLanguage}

Initial Assessment: ${initialReasoning}

Provide a concise 2-3 sentence analysis using GRI-style step-by-step reasoning explaining why this item is POSSIBLY within scope and what specific facts/scope rulings are required to confirm.`,
        },
      ],
    });

    const contentBlock = response.content[0];
    if (contentBlock && "text" in contentBlock) {
      return contentBlock.text;
    }
  } catch (err) {
    console.warn("[scopeScreening] Anthropic API call failed, using fallback reasoning:", err);
  }

  return `${initialReasoning} [GRI Analysis: Step 1: Subheading / keyword match identified. Step 2: Country of origin or technical specification unverified. Step 3: Formal CBP scope ruling recommended.]`;
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
      const initReasoning = `HTS code ${htsCode} matches active AD/CVD order scope, but country of origin (${countryOfOrigin ?? "unknown"}) requires confirmation or scope ruling.`;
      const aiReasoning = await analyzeScopeWithClaude(input, order, initReasoning);
      results.push({
        caseNumber: order.caseNumber,
        title: order.title,
        inScope: "POSSIBLY",
        confidence: 65,
        scopeLanguageMatch: order.scopeLanguage,
        reasoning: aiReasoning,
      });
    } else if (textMatches) {
      const initReasoning = `Product description matches terms in AD/CVD order ${order.caseNumber} scope description.`;
      const aiReasoning = await analyzeScopeWithClaude(input, order, initReasoning);
      results.push({
        caseNumber: order.caseNumber,
        title: order.title,
        inScope: "POSSIBLY",
        confidence: 50,
        scopeLanguageMatch: order.scopeLanguage,
        reasoning: aiReasoning,
      });
    }
  }

  if (results.length === 0) {
    return { orders: [] };
  }

  return { orders: results };
}
