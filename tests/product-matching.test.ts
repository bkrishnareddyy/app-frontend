import { describe, expect, it } from "vitest";
import {
  MANUFACTURER_QUALIFIED_TYPES,
  UNIQUE_IDENTIFIER_TYPES,
  isAutoAttachable,
  matchProduct,
  type MatchableProduct,
} from "@/modules/product/productMatching";

function product(overrides: Partial<MatchableProduct> & { id: string }): MatchableProduct {
  return {
    productName: "Steel bracket",
    brand: null,
    internalSku: null,
    identifiers: [],
    manufacturerPartyIds: [],
    ...overrides,
  };
}

const GTIN_PRODUCT = product({
  id: "prod_gtin",
  identifiers: [{ identifierType: "GTIN", normalizedValue: "05012345678900" }],
});

describe("matchProduct: unique identifiers", () => {
  it("calls a single GTIN hit an exact match", () => {
    const result = matchProduct(
      { identifiers: [{ identifierType: "GTIN", value: "0501-2345 678900" }] },
      [GTIN_PRODUCT, product({ id: "other" })]
    );
    expect(result.status).toBe("EXACT_MATCH");
    expect(result.rule).toBe("UNIQUE_IDENTIFIER");
    expect(result.candidates.map((c) => c.productId)).toEqual(["prod_gtin"]);
  });

  it("normalizes punctuation and case on both sides before comparing", () => {
    const catalogue = [
      product({
        id: "prod_sku",
        identifiers: [{ identifierType: "INTERNAL_SKU", normalizedValue: "ABC123" }],
      }),
    ];
    const result = matchProduct(
      { identifiers: [{ identifierType: "INTERNAL_SKU", value: " abc-123 " }] },
      catalogue
    );
    expect(result.status).toBe("EXACT_MATCH");
    expect(result.candidates[0]?.matchedValue).toBe("ABC123");
  });

  it("reports a collision on a unique scheme as ambiguous rather than picking one", () => {
    // Two products carrying the same GTIN is a data error. Silently returning the
    // first would attach a shipment line to whichever row happened to sort first.
    const result = matchProduct(
      { identifiers: [{ identifierType: "GTIN", value: "05012345678900" }] },
      [GTIN_PRODUCT, product({ ...GTIN_PRODUCT, id: "prod_dupe" })]
    );
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.candidates).toHaveLength(2);
  });

  it("does not fall through to a weaker rule when a strong rule found a collision", () => {
    const result = matchProduct(
      {
        identifiers: [{ identifierType: "GTIN", value: "05012345678900" }],
        productName: "Steel bracket",
        brand: "Acme",
      },
      [GTIN_PRODUCT, product({ ...GTIN_PRODUCT, id: "prod_dupe" })]
    );
    expect(result.rule).toBe("UNIQUE_IDENTIFIER");
  });
});

describe("matchProduct: manufacturer-qualified identifiers", () => {
  const catalogue = [
    product({
      id: "prod_acme",
      identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER", normalizedValue: "1000" }],
      manufacturerPartyIds: ["le_acme"],
    }),
    product({
      id: "prod_globex",
      identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER", normalizedValue: "1000" }],
      manufacturerPartyIds: ["le_globex"],
    }),
  ];

  it("is exact when the part number is qualified by a known manufacturer", () => {
    const result = matchProduct(
      {
        identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER", value: "1000" }],
        manufacturerPartyId: "le_acme",
      },
      catalogue
    );
    expect(result.status).toBe("EXACT_MATCH");
    expect(result.rule).toBe("MANUFACTURER_QUALIFIED_IDENTIFIER");
    expect(result.candidates[0]?.productId).toBe("prod_acme");
  });

  it("never returns EXACT for a part number with no manufacturer, even when only one product carries it", () => {
    // Part number "1000" is a real part for dozens of unrelated manufacturers.
    // One hit today is an accident of the catalogue, not an identification.
    const result = matchProduct(
      { identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER", value: "1000" }] },
      [catalogue[0]!]
    );
    expect(result.status).toBe("POSSIBLE_MATCH");
    expect(result.rule).toBe("UNQUALIFIED_IDENTIFIER");
  });

  it("is ambiguous when an unqualified part number hits several products", () => {
    const result = matchProduct(
      { identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER", value: "1000" }] },
      catalogue
    );
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.candidates).toHaveLength(2);
  });

  it("keeps the two identifier families disjoint", () => {
    for (const type of MANUFACTURER_QUALIFIED_TYPES) {
      expect(UNIQUE_IDENTIFIER_TYPES).not.toContain(type);
    }
  });
});

describe("matchProduct: name and brand", () => {
  const catalogue = [product({ id: "prod_named", productName: "Steel Bracket", brand: "Acme" })];

  it("suggests rather than determines when only name and brand agree", () => {
    const result = matchProduct({ productName: "steel  bracket", brand: "ACME" }, catalogue);
    expect(result.status).toBe("POSSIBLE_MATCH");
    expect(result.rule).toBe("NAME_AND_BRAND");
  });

  it("refuses to match on name alone", () => {
    const result = matchProduct({ productName: "Steel Bracket" }, catalogue);
    expect(result.status).toBe("NO_MATCH");
  });

  it("refuses to match a named product against a catalogue row with no brand", () => {
    const result = matchProduct({ productName: "Steel Bracket", brand: "Acme" }, [
      product({ id: "prod_unbranded", productName: "Steel Bracket" }),
    ]);
    expect(result.status).toBe("NO_MATCH");
  });
});

describe("matchProduct: no match", () => {
  it("returns NO_MATCH with no candidates and no rule when nothing was supplied", () => {
    const result = matchProduct({}, [GTIN_PRODUCT]);
    expect(result).toEqual({ status: "NO_MATCH", candidates: [], rule: null });
  });

  it("ignores identifiers that normalize to nothing", () => {
    const result = matchProduct(
      { identifiers: [{ identifierType: "GTIN", value: "   -- " }] },
      [GTIN_PRODUCT]
    );
    expect(result.status).toBe("NO_MATCH");
  });
});

describe("isAutoAttachable", () => {
  it("permits attachment only for a single exact match", () => {
    expect(
      isAutoAttachable(
        matchProduct({ identifiers: [{ identifierType: "GTIN", value: "05012345678900" }] }, [
          GTIN_PRODUCT,
        ])
      )
    ).toBe(true);
  });

  it("refuses every weaker outcome", () => {
    const possible = matchProduct(
      { identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER", value: "1000" }] },
      [
        product({
          id: "prod_a",
          identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER", normalizedValue: "1000" }],
        }),
      ]
    );
    const ambiguous = matchProduct(
      { identifiers: [{ identifierType: "GTIN", value: "05012345678900" }] },
      [GTIN_PRODUCT, product({ ...GTIN_PRODUCT, id: "prod_dupe" })]
    );
    expect(isAutoAttachable(possible)).toBe(false);
    expect(isAutoAttachable(ambiguous)).toBe(false);
    expect(isAutoAttachable(matchProduct({}, []))).toBe(false);
  });
});

describe("matching is deterministic", () => {
  it("returns the same result for the same inputs, independent of catalogue order", () => {
    const a = product({
      id: "prod_a",
      identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER", normalizedValue: "1000" }],
    });
    const b = product({
      id: "prod_b",
      identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER", normalizedValue: "1000" }],
    });
    const input = { identifiers: [{ identifierType: "MANUFACTURER_PART_NUMBER" as const, value: "1000" }] };

    const forwards = matchProduct(input, [a, b]);
    const backwards = matchProduct(input, [b, a]);

    expect(forwards.status).toBe(backwards.status);
    expect(new Set(forwards.candidates.map((c) => c.productId))).toEqual(
      new Set(backwards.candidates.map((c) => c.productId))
    );
  });

  it("explains every candidate by naming the evidence, never a score", () => {
    const result = matchProduct(
      { identifiers: [{ identifierType: "GTIN", value: "05012345678900" }] },
      [GTIN_PRODUCT]
    );
    for (const candidate of result.candidates) {
      expect(candidate.explanation).toContain("GTIN");
      expect(candidate.explanation).not.toMatch(/confiden|score|probabil|%/i);
    }
  });
});
