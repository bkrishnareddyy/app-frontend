import { describe, it, expect } from "vitest";
import {
  compareLineItemToProductMaster,
  type ComparisonInput,
} from "../src/modules/agents/productIntelligence/comparison";
import { verifyProductIntelligence } from "../src/modules/agents/productIntelligence/verification";
import type { ProductSnapshot } from "../src/modules/product/productChangeDetection";

function baseSnapshot(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    productName: "Stainless Steel Fastener",
    commercialDescription: null,
    technicalDescription: "Threaded stainless steel fastener",
    customsDescription: "Threaded stainless steel fastener",
    brand: null,
    model: null,
    attributes: [],
    compositions: [{ material: "Stainless Steel", percentage: 100, componentName: null }],
    parties: [{ role: "MANUFACTURER", legalEntityId: "le_1", manufacturingSite: null }],
    countryFacts: [{ factType: "MANUFACTURE_COUNTRY", country: "CN" }],
    ...overrides,
  };
}

function baseComparisonInput(overrides: Partial<ComparisonInput> = {}): ComparisonInput {
  return {
    matchResult: { status: "EXACT_MATCH", candidates: [], rule: "UNIQUE_IDENTIFIER" },
    matchedProduct: null,
    parties: [],
    originClaim: null,
    countryOfManufacture: null,
    manufacturerPartNumber: null,
    model: null,
    enrichedDescription: "Threaded stainless steel fastener",
    materialComposition: "Stainless Steel",
    essentialCharacter: "Threaded steel fastener for structural assembly",
    endUse: "Industrial machinery component",
    ...overrides,
  };
}

describe("Product Intelligence: verification semantics", () => {
  it("never grants AUTO_VERIFIED from LLM confidence alone without deterministic corroboration (spec regression)", () => {
    const result = verifyProductIntelligence({
      matchResult: { status: "NO_MATCH", candidates: [], rule: null },
      conflicts: [],
      missingInformationCount: 0,
      readiness: {
        productIdentity: "INSUFFICIENT_DATA",
        classification: "READY",
        origin: "INSUFFICIENT_DATA",
        regulatory: "INSUFFICIENT_DATA",
        valuation: "INSUFFICIENT_DATA",
      },
      confidence: 95,
    });

    expect(result.verificationStatus).not.toBe("AUTO_VERIFIED");
    expect(result.verificationStatus).toBe("AGENT_PROPOSED");
    expect(result.triageState).toBe("NEEDS_REVIEW");
  });

  it("routes any conflict straight to NEEDS_REVIEW regardless of confidence, and never auto-resolves it", () => {
    const result = verifyProductIntelligence({
      matchResult: { status: "EXACT_MATCH", candidates: [], rule: "UNIQUE_IDENTIFIER" },
      conflicts: [
        {
          type: "PRODUCT_DATA_CONFLICT",
          field: "materialComposition",
          incomingValue: "Brass",
          masterValue: "Stainless Steel",
          explanation: "mismatch",
        },
      ],
      missingInformationCount: 0,
      readiness: {
        productIdentity: "READY",
        classification: "READY",
        origin: "READY",
        regulatory: "READY",
        valuation: "READY",
      },
      confidence: 99,
    });

    expect(result.verificationStatus).toBe("NEEDS_REVIEW");
    expect(result.triageState).toBe("NEEDS_REVIEW");
  });

  it("routes AMBIGUOUS matches to NEEDS_REVIEW even with high confidence", () => {
    const result = verifyProductIntelligence({
      matchResult: { status: "AMBIGUOUS", candidates: [], rule: "UNQUALIFIED_IDENTIFIER" },
      conflicts: [],
      missingInformationCount: 0,
      readiness: {
        productIdentity: "PARTIAL",
        classification: "READY",
        origin: "READY",
        regulatory: "READY",
        valuation: "READY",
      },
      confidence: 97,
    });

    expect(result.verificationStatus).toBe("NEEDS_REVIEW");
  });

  it("grants AUTO_VERIFIED only for an exact match, zero conflicts, and zero missing information", () => {
    const result = verifyProductIntelligence({
      matchResult: { status: "EXACT_MATCH", candidates: [], rule: "UNIQUE_IDENTIFIER" },
      conflicts: [],
      missingInformationCount: 0,
      readiness: {
        productIdentity: "READY",
        classification: "READY",
        origin: "READY",
        regulatory: "READY",
        valuation: "READY",
      },
      confidence: 40,
    });

    expect(result.verificationStatus).toBe("AUTO_VERIFIED");
    expect(result.triageState).toBe("AUTO_VERIFIED");
  });

  it("downgrades an exact match with missing classification info to AGENT_PROPOSED, not AUTO_VERIFIED", () => {
    const result = verifyProductIntelligence({
      matchResult: { status: "EXACT_MATCH", candidates: [], rule: "UNIQUE_IDENTIFIER" },
      conflicts: [],
      missingInformationCount: 1,
      readiness: {
        productIdentity: "READY",
        classification: "PARTIAL",
        origin: "READY",
        regulatory: "READY",
        valuation: "READY",
      },
      confidence: 80,
    });

    expect(result.verificationStatus).toBe("AGENT_PROPOSED");
  });
});

describe("Product Intelligence: fact comparison against the Product Master", () => {
  it("detects a material conflict and names both sides' values without resolving it", () => {
    const snapshot = baseSnapshot();
    const input = baseComparisonInput({
      matchedProduct: { product: {} as never, snapshot },
      materialComposition: "Brass",
    });

    const result = compareLineItemToProductMaster(input);
    const materialConflict = result.conflicts.find((c) => c.field === "materialComposition");

    expect(materialConflict).toBeDefined();
    expect(materialConflict?.incomingValue).toBe("Brass");
    expect(materialConflict?.masterValue).toContain("Stainless Steel");
  });

  it("detects a manufacturer conflict when the resolved legal entity differs from the Product Master's", () => {
    const snapshot = baseSnapshot();
    const input = baseComparisonInput({
      matchedProduct: { product: {} as never, snapshot },
      parties: [{ role: "MANUFACTURER", rawName: "Other Corp", legalEntityId: "le_2", matchScore: 90, matchReason: "exact name" }],
    });

    const result = compareLineItemToProductMaster(input);
    const manufacturerConflict = result.conflicts.find((c) => c.field === "manufacturer");

    expect(manufacturerConflict).toBeDefined();
    expect(manufacturerConflict?.masterValue).toBe("le_1");
  });

  it("flags an origin claim conflict as ORIGIN_CLAIM_CONFLICT and never as an auto-resolved fact", () => {
    const snapshot = baseSnapshot({ countryFacts: [{ factType: "ORIGIN_CLAIM", country: "MX" }] });
    const input = baseComparisonInput({
      matchedProduct: { product: {} as never, snapshot },
      originClaim: "CN",
    });

    const result = compareLineItemToProductMaster(input);
    const originConflict = result.conflicts.find((c) => c.field === "originClaim");

    expect(originConflict?.type).toBe("ORIGIN_CLAIM_CONFLICT");
    expect(originConflict?.masterValue).toBe("MX");
  });

  it("reports missing information deterministically when enrichment fields are undetermined", () => {
    const input = baseComparisonInput({
      enrichedDescription: "Not determined",
      materialComposition: "Not determined",
      essentialCharacter: "Not determined",
      endUse: "Not determined",
    });

    const result = compareLineItemToProductMaster(input);

    expect(result.missingInformation.map((m) => m.field)).toEqual(
      expect.arrayContaining(["enrichedDescription", "materialComposition", "essentialCharacter", "endUse"])
    );
    expect(result.readiness.classification).toBe("INSUFFICIENT_DATA");
  });

  it("never collapses readiness into one score -- each dimension is assessed independently", () => {
    const snapshot = baseSnapshot();
    const input = baseComparisonInput({ matchedProduct: { product: {} as never, snapshot } });

    const result = compareLineItemToProductMaster(input);

    expect(result.readiness).toHaveProperty("productIdentity");
    expect(result.readiness).toHaveProperty("classification");
    expect(result.readiness).toHaveProperty("origin");
    expect(result.readiness).toHaveProperty("regulatory");
    expect(result.readiness).toHaveProperty("valuation");
    expect(result.readiness.productIdentity).toBe("READY");
  });

  it("maps a manufacture-country change to a revalidation recommendation, not an asserted legal outcome", () => {
    const snapshot = baseSnapshot();
    const input = baseComparisonInput({
      matchedProduct: { product: {} as never, snapshot },
      countryOfManufacture: "VN",
    });

    const result = compareLineItemToProductMaster(input);

    expect(result.changes.length).toBeGreaterThan(0);
    const originFlag = result.recommendedActions.find((a) => a.flag === "ORIGIN_REVALIDATION_REQUIRED");
    expect(originFlag).toBeDefined();
    expect(originFlag?.reason).not.toMatch(/originates from|is now made in/i);
  });

  it("produces no conflicts and no changes when there is no Product Master match", () => {
    const input = baseComparisonInput({ matchedProduct: null, matchResult: { status: "NO_MATCH", candidates: [], rule: null } });

    const result = compareLineItemToProductMaster(input);

    expect(result.conflicts).toEqual([]);
    expect(result.changes).toEqual([]);
    expect(result.readiness.productIdentity).toBe("INSUFFICIENT_DATA");
  });
});
