import { describe, expect, it } from "vitest";
import {
  detectProductChanges,
  highestSignificance,
  revalidationSignals,
  type ProductSnapshot,
} from "@/modules/product/productChangeDetection";

function snapshot(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    productName: "Steel bracket",
    commercialDescription: null,
    technicalDescription: null,
    customsDescription: null,
    brand: null,
    model: null,
    attributes: [],
    compositions: [],
    parties: [],
    countryFacts: [],
    ...overrides,
  };
}

const flagsOf = (changes: ReturnType<typeof detectProductChanges>) =>
  new Set(changes.flatMap((change) => change.impactFlags));

describe("detectProductChanges: descriptions", () => {
  it("treats a customs description change as customs-significant", () => {
    const changes = detectProductChanges(
      snapshot({ customsDescription: "Steel bracket, galvanised" }),
      snapshot({ customsDescription: "Aluminium bracket, anodised" })
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.significance).toBe("CUSTOMS_SIGNIFICANT");
    expect(changes[0]?.impactFlags).toContain("CLASSIFICATION_REVALIDATION_REQUIRED");
  });

  it("records a pure reformat but raises nothing", () => {
    const changes = detectProductChanges(
      snapshot({ customsDescription: "Steel bracket, galvanised" }),
      snapshot({ customsDescription: "  STEEL   BRACKET,  GALVANISED  " })
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.significance).toBe("NON_MATERIAL");
    expect(changes[0]?.impactFlags).toEqual([]);
  });

  it("does not treat renaming or rebranding as customs-significant", () => {
    const changes = detectProductChanges(
      snapshot({ productName: "Bracket", brand: "Acme" }),
      snapshot({ productName: "Heavy bracket", brand: "Acme Industrial" })
    );
    expect(changes).toHaveLength(2);
    expect(highestSignificance(changes)).toBe("NON_MATERIAL");
    expect(flagsOf(changes).size).toBe(0);
  });

  it("reports no change when nothing moved", () => {
    expect(detectProductChanges(snapshot(), snapshot())).toEqual([]);
  });
});

describe("detectProductChanges: attributes", () => {
  it("raises classification revalidation on a customs-significant attribute", () => {
    const changes = detectProductChanges(
      snapshot({ attributes: [{ attributeCode: "NET_WEIGHT", value: "2", unit: "KG" }] }),
      snapshot({ attributes: [{ attributeCode: "NET_WEIGHT", value: "4", unit: "KG" }] })
    );
    expect(changes[0]?.significance).toBe("CUSTOMS_SIGNIFICANT");
    expect(changes[0]?.impactFlags).toContain("CLASSIFICATION_REVALIDATION_REQUIRED");
  });

  it("stays quiet on an attribute the catalogue marks insignificant", () => {
    const changes = detectProductChanges(
      snapshot({ attributes: [{ attributeCode: "GROSS_WEIGHT", value: "2", unit: "KG" }] }),
      snapshot({ attributes: [{ attributeCode: "GROSS_WEIGHT", value: "4", unit: "KG" }] })
    );
    expect(changes[0]?.significance).toBe("NON_MATERIAL");
    expect(changes[0]?.impactFlags).toEqual([]);
  });

  it("treats an unrecognised attribute as significant on all three fronts", () => {
    // Failing open is the wrong default here: an unknown fact that turns out to
    // matter is worse than a revalidation signal that turns out to be unnecessary.
    const changes = detectProductChanges(
      snapshot(),
      snapshot({ attributes: [{ attributeCode: "SOME_TENANT_FIELD", value: "yes", unit: null }] })
    );
    expect(changes[0]?.significance).toBe("CUSTOMS_SIGNIFICANT");
    expect(new Set(changes[0]?.impactFlags)).toEqual(
      new Set([
        "CLASSIFICATION_REVALIDATION_REQUIRED",
        "ORIGIN_REVALIDATION_REQUIRED",
        "REGULATORY_REVALIDATION_REQUIRED",
      ])
    );
  });

  it("notices a unit change even when the number is unchanged", () => {
    const changes = detectProductChanges(
      snapshot({ attributes: [{ attributeCode: "NET_WEIGHT", value: "2", unit: "KG" }] }),
      snapshot({ attributes: [{ attributeCode: "NET_WEIGHT", value: "2", unit: "G" }] })
    );
    expect(changes).toHaveLength(1);
  });

  it("compares attribute codes case-insensitively", () => {
    const changes = detectProductChanges(
      snapshot({ attributes: [{ attributeCode: "net_weight", value: "2", unit: "KG" }] }),
      snapshot({ attributes: [{ attributeCode: "NET_WEIGHT", value: "2", unit: "KG" }] })
    );
    expect(changes).toEqual([]);
  });
});

describe("detectProductChanges: composition", () => {
  it("raises classification and origin on any percentage move, with no threshold", () => {
    const changes = detectProductChanges(
      snapshot({ compositions: [{ material: "Steel", percentage: 60, componentName: null }] }),
      snapshot({ compositions: [{ material: "Steel", percentage: 59.5, componentName: null }] })
    );
    expect(changes[0]?.significance).toBe("CUSTOMS_SIGNIFICANT");
    expect(new Set(changes[0]?.impactFlags)).toEqual(
      new Set(["CLASSIFICATION_REVALIDATION_REQUIRED", "ORIGIN_REVALIDATION_REQUIRED"])
    );
  });

  it("raises on a material appearing and on one disappearing", () => {
    const added = detectProductChanges(
      snapshot(),
      snapshot({ compositions: [{ material: "Copper", percentage: 5, componentName: null }] })
    );
    const removed = detectProductChanges(
      snapshot({ compositions: [{ material: "Copper", percentage: 5, componentName: null }] }),
      snapshot()
    );
    expect(added[0]?.field).toBe("added");
    expect(removed[0]?.field).toBe("removed");
    expect(highestSignificance([...added, ...removed])).toBe("CUSTOMS_SIGNIFICANT");
  });
});

describe("detectProductChanges: parties and country facts", () => {
  it("asks for origin revalidation on a manufacturer change without changing origin", () => {
    const changes = detectProductChanges(
      snapshot({ parties: [{ role: "MANUFACTURER", legalEntityId: "le_a", manufacturingSite: null }] }),
      snapshot({ parties: [{ role: "MANUFACTURER", legalEntityId: "le_b", manufacturingSite: null }] })
    );
    const flags = flagsOf(changes);
    expect(flags).toContain("ORIGIN_REVALIDATION_REQUIRED");
    // Nothing here produces or edits an origin claim; it only asks for a review.
    expect(changes.every((change) => !change.entity.startsWith("ProductCountryFact"))).toBe(true);
  });

  it("treats a supplier change as a valuation question, not an origin one", () => {
    const changes = detectProductChanges(
      snapshot({ parties: [{ role: "SUPPLIER", legalEntityId: "le_a", manufacturingSite: null }] }),
      snapshot({ parties: [{ role: "SUPPLIER", legalEntityId: "le_b", manufacturingSite: null }] })
    );
    const flags = flagsOf(changes);
    expect(flags).toContain("VALUATION_REVIEW_REQUIRED");
    expect(flags).not.toContain("ORIGIN_REVALIDATION_REQUIRED");
  });

  it("keeps manufacture country and origin claim as separate facts", () => {
    const changes = detectProductChanges(
      snapshot({ countryFacts: [{ factType: "MANUFACTURE_COUNTRY", country: "CN" }] }),
      snapshot({
        countryFacts: [
          { factType: "MANUFACTURE_COUNTRY", country: "VN" },
          { factType: "ORIGIN_CLAIM", country: "CN" },
        ],
      })
    );
    const entities = changes.map((change) => change.entity);
    expect(entities).toContain("ProductCountryFact:MANUFACTURE_COUNTRY");
    expect(entities).toContain("ProductCountryFact:ORIGIN_CLAIM");
    // Manufacture moving to VN did not rewrite the origin claim to VN.
    const originChange = changes.find((c) => c.entity.endsWith("ORIGIN_CLAIM"));
    expect(originChange?.newValue).toBe("CN");
  });

  it("says plainly that a manufacture country is not the country of origin", () => {
    const changes = detectProductChanges(
      snapshot({ countryFacts: [{ factType: "MANUFACTURE_COUNTRY", country: "CN" }] }),
      snapshot({ countryFacts: [{ factType: "MANUFACTURE_COUNTRY", country: "VN" }] })
    );
    expect(changes.some((c) => c.reason.includes("not the country of origin"))).toBe(true);
  });
});

describe("revalidationSignals", () => {
  it("collapses many changes into one signal per flag, keeping every reason", () => {
    const changes = detectProductChanges(
      snapshot({
        customsDescription: "Steel bracket",
        compositions: [{ material: "Steel", percentage: 100, componentName: null }],
      }),
      snapshot({
        customsDescription: "Aluminium bracket",
        compositions: [{ material: "Aluminium", percentage: 100, componentName: null }],
      })
    );
    const signals = revalidationSignals(changes);
    const classification = signals.find(
      (signal) => signal.flag === "CLASSIFICATION_REVALIDATION_REQUIRED"
    );

    expect(signals.filter((s) => s.flag === "CLASSIFICATION_REVALIDATION_REQUIRED")).toHaveLength(1);
    expect(classification?.triggeredBy.length).toBeGreaterThan(1);
    expect(classification?.reason).toContain("customsDescription");
    expect(classification?.reason).toContain("ProductComposition");
  });

  it("produces no signal at all when nothing significant changed", () => {
    const changes = detectProductChanges(
      snapshot({ productName: "Bracket" }),
      snapshot({ productName: "Bracket, heavy" })
    );
    expect(revalidationSignals(changes)).toEqual([]);
  });

  it("only ever emits the four workflow signals", () => {
    const changes = detectProductChanges(
      snapshot(),
      snapshot({
        customsDescription: "New",
        compositions: [{ material: "Steel", percentage: 100, componentName: null }],
        parties: [{ role: "MANUFACTURER", legalEntityId: "le_a", manufacturingSite: null }],
        countryFacts: [{ factType: "ORIGIN_CLAIM", country: "CN" }],
        attributes: [{ attributeCode: "HAZMAT", value: "true", unit: null }],
      })
    );
    for (const signal of revalidationSignals(changes)) {
      expect([
        "CLASSIFICATION_REVALIDATION_REQUIRED",
        "ORIGIN_REVALIDATION_REQUIRED",
        "REGULATORY_REVALIDATION_REQUIRED",
        "VALUATION_REVIEW_REQUIRED",
      ]).toContain(signal.flag);
    }
  });
});

describe("highestSignificance", () => {
  it("ranks customs-significant above potentially-significant above non-material", () => {
    expect(highestSignificance([])).toBe("NON_MATERIAL");
    expect(
      highestSignificance(
        detectProductChanges(snapshot({ model: "A" }), snapshot({ model: "B" }))
      )
    ).toBe("POTENTIALLY_CUSTOMS_SIGNIFICANT");
    expect(
      highestSignificance(
        detectProductChanges(
          snapshot({ model: "A", customsDescription: "X" }),
          snapshot({ model: "B", customsDescription: "Y" })
        )
      )
    ).toBe("CUSTOMS_SIGNIFICANT");
  });
});
