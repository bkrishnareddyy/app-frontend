/**
 * Tests for the product AI enrichment approval flow.
 *
 * These tests cover the change-detection consequences of approving AI-sourced
 * attribute suggestions: specifically, that approving a customs-significant
 * attribute raises a revalidation flag, while approving a non-significant one
 * does not.
 *
 * The enrichment endpoint's database writes are not tested here (they delegate
 * to `setAttribute`, which is covered by integration tests). What matters to
 * test in isolation is the downstream signal: a product whose material
 * attribute just changed needs reclassification, and the change-detection
 * module must say so regardless of whether the change was made by a human or
 * approved from an AI suggestion.
 */

import { describe, expect, it } from "vitest";
import {
  detectProductChanges,
  revalidationSignals,
  highestSignificance,
  type ProductSnapshot,
} from "@/modules/product/productChangeDetection";

function snapshot(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    productName: "Industrial Valve",
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

// ---------------------------------------------------------------------------
// Attribute change detection (the path that enrichment approval triggers)
// ---------------------------------------------------------------------------

describe("AI enrichment approval: customs-significant attribute", () => {
  it("raises CLASSIFICATION_REVALIDATION_REQUIRED when PRIMARY_MATERIAL is set for the first time", () => {
    const before = snapshot();
    const after = snapshot({
      attributes: [{ attributeCode: "PRIMARY_MATERIAL", value: "Stainless Steel", unit: null }],
    });

    const changes = detectProductChanges(before, after);
    const signals = revalidationSignals(changes);

    expect(signals.some((s) => s.flag === "CLASSIFICATION_REVALIDATION_REQUIRED")).toBe(true);
  });

  it("raises CLASSIFICATION_REVALIDATION_REQUIRED when NET_WEIGHT changes (AI suggestion approved)", () => {
    const before = snapshot({
      attributes: [{ attributeCode: "NET_WEIGHT", value: "2", unit: "KG" }],
    });
    const after = snapshot({
      attributes: [{ attributeCode: "NET_WEIGHT", value: "3.5", unit: "KG" }],
    });

    const changes = detectProductChanges(before, after);
    expect(highestSignificance(changes)).toBe("CUSTOMS_SIGNIFICANT");
    expect(
      changes.some((c) => c.impactFlags.includes("CLASSIFICATION_REVALIDATION_REQUIRED"))
    ).toBe(true);
  });

  it("does not raise any flag when a non-customs-significant attribute is added", () => {
    const before = snapshot();
    const after = snapshot({
      attributes: [{ attributeCode: "GROSS_WEIGHT", value: "5", unit: "KG" }],
    });

    const changes = detectProductChanges(before, after);
    const signals = revalidationSignals(changes);
    expect(signals).toHaveLength(0);
  });

  it("recognises HAZMAT as regulatory-significant (its group governs its flags)", () => {
    const before = snapshot();
    const after = snapshot({
      attributes: [{ attributeCode: "HAZMAT", value: "true", unit: null }],
    });

    const changes = detectProductChanges(before, after);
    const flags = new Set(changes.flatMap((c) => c.impactFlags));
    expect(flags).toContain("REGULATORY_REVALIDATION_REQUIRED");
  });

  it("deduplicates signals: two customs-significant attributes added simultaneously raise one flag", () => {
    const before = snapshot();
    const after = snapshot({
      attributes: [
        { attributeCode: "NET_WEIGHT", value: "2", unit: "KG" },
        { attributeCode: "PRIMARY_MATERIAL", value: "Aluminium", unit: null },
      ],
    });

    const changes = detectProductChanges(before, after);
    const signals = revalidationSignals(changes);
    const classificationSignals = signals.filter(
      (s) => s.flag === "CLASSIFICATION_REVALIDATION_REQUIRED"
    );
    expect(classificationSignals).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Source type does not affect change detection
// ---------------------------------------------------------------------------

describe("AI enrichment approval: source type is irrelevant to change detection", () => {
  it("detects a change regardless of what set the attribute (USER or AGENT)", () => {
    // Change detection looks at before/after snapshots; the source that wrote
    // the attribute is not part of the snapshot. This test confirms there is
    // no source-type branch that would silence the signal for AI-sourced data.
    const before = snapshot({
      attributes: [{ attributeCode: "NET_WEIGHT", value: "1", unit: "KG" }],
    });
    const after = snapshot({
      attributes: [{ attributeCode: "NET_WEIGHT", value: "2", unit: "KG" }],
    });

    const changes = detectProductChanges(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.significance).toBe("CUSTOMS_SIGNIFICANT");
  });
});

// ---------------------------------------------------------------------------
// Composition changes that enrichment may also surface
// ---------------------------------------------------------------------------

describe("AI enrichment approval: composition-type suggestions", () => {
  it("raises CLASSIFICATION_REVALIDATION_REQUIRED when a material composition is added", () => {
    const before = snapshot();
    const after = snapshot({
      compositions: [{ material: "Stainless Steel", percentage: null, componentName: null }],
    });

    const changes = detectProductChanges(before, after);
    const flags = new Set(changes.flatMap((c) => c.impactFlags));
    expect(flags).toContain("CLASSIFICATION_REVALIDATION_REQUIRED");
  });

  it("raises ORIGIN_REVALIDATION_REQUIRED when a composition percentage is updated", () => {
    const before = snapshot({
      compositions: [{ material: "Cotton", percentage: 80, componentName: null }],
    });
    const after = snapshot({
      compositions: [{ material: "Cotton", percentage: 60, componentName: null }],
    });

    const changes = detectProductChanges(before, after);
    const flags = new Set(changes.flatMap((c) => c.impactFlags));
    expect(flags).toContain("ORIGIN_REVALIDATION_REQUIRED");
  });
});
