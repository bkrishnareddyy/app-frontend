import { describe, it, expect } from "vitest";
import {
  resolveOriginPosition,
  type CountryFactInput,
} from "@/modules/copilot/copilotOrigin";
import {
  COPILOT_PROMPT_VERSION,
  buildCopilotSystemPrompt,
} from "@/modules/copilot/prompts/copilotSystemPrompt";

/**
 * Country-of-origin safety.
 *
 * The specification singles this out: the Copilot must never infer legal origin
 * from a manufacturing, supplier, ship-from or address country, and the
 * behaviour must be explicitly tested. These tests assert the *code* refuses to,
 * which is the only form of the guarantee that survives a model ignoring its
 * prompt — `legalCountryOfOrigin` stays null, and the statement the model is
 * given to quote says so in words.
 */

const NOW = new Date("2026-08-12T00:00:00.000Z");

function fact(overrides: Partial<CountryFactInput> & Pick<CountryFactInput, "factType">): CountryFactInput {
  return {
    rawCountry: "Germany",
    countryCode: "DE",
    status: "CLAIMED",
    effectiveTo: null,
    reviewedAt: null,
    ...overrides,
  };
}

describe("country of origin is never inferred", () => {
  it("reports no determination when only the manufacturing country is known", () => {
    const position = resolveOriginPosition(
      [fact({ factType: "MANUFACTURE_COUNTRY", status: "VERIFIED" })],
      NOW
    );

    // The scenario named in the specification: manufactured in Germany, no
    // approved origin. A verified *manufacture* fact is still not origin.
    expect(position.legalCountryOfOrigin).toBeNull();
    expect(position.basis).toBe("NO_DETERMINATION");
    expect(position.statement).toContain("no approved country-of-origin determination");
    expect(position.statement).toContain("is not a legal country of origin");
    expect(position.manufactureCountries).toEqual([
      { country: "Germany", countryCode: "DE", status: "VERIFIED" },
    ]);
  });

  it("does not treat a production country as origin either", () => {
    const position = resolveOriginPosition(
      [fact({ factType: "PRODUCTION_COUNTRY", rawCountry: "Vietnam", countryCode: "VN" })],
      NOW
    );

    expect(position.legalCountryOfOrigin).toBeNull();
    expect(position.productionCountries).toHaveLength(1);
    expect(position.statement).toContain("Vietnam");
    expect(position.statement).toContain("physical fact");
  });

  it("does not promote an unverified origin claim to a determination", () => {
    for (const status of ["CLAIMED", "UNDER_REVIEW", "REJECTED"]) {
      const position = resolveOriginPosition(
        [fact({ factType: "ORIGIN_CLAIM", status, rawCountry: "China", countryCode: "CN" })],
        NOW
      );
      expect(position.legalCountryOfOrigin, `status ${status}`).toBeNull();
      expect(position.basis).toBe("NO_DETERMINATION");
    }
  });

  it("mentions pending claims without adopting one", () => {
    const position = resolveOriginPosition(
      [fact({ factType: "ORIGIN_CLAIM", status: "UNDER_REVIEW" })],
      NOW
    );

    expect(position.legalCountryOfOrigin).toBeNull();
    expect(position.unverifiedOriginClaims).toHaveLength(1);
    expect(position.statement).toContain("not been verified");
  });

  it("reports a single verified origin claim as the determination", () => {
    const position = resolveOriginPosition(
      [
        fact({ factType: "MANUFACTURE_COUNTRY", rawCountry: "Germany" }),
        fact({ factType: "ORIGIN_CLAIM", status: "VERIFIED", rawCountry: "Austria", countryCode: "AT" }),
      ],
      NOW
    );

    // The determination wins over the manufacturing country, which is the whole
    // point: origin is what was determined, not where the goods were made.
    expect(position.legalCountryOfOrigin).toBe("Austria");
    expect(position.basis).toBe("VERIFIED_ORIGIN_DETERMINATION");
    expect(position.statement).toContain("verified country-of-origin determination");
  });

  it("refuses to break a tie between conflicting verified claims", () => {
    const position = resolveOriginPosition(
      [
        fact({ factType: "ORIGIN_CLAIM", status: "VERIFIED", rawCountry: "Germany" }),
        fact({ factType: "ORIGIN_CLAIM", status: "VERIFIED", rawCountry: "Poland", countryCode: "PL" }),
      ],
      NOW
    );

    expect(position.legalCountryOfOrigin).toBeNull();
    expect(position.statement).toContain("conflicting verified origin claims");
    expect(position.unverifiedOriginClaims).toHaveLength(2);
  });

  it("ignores an expired verified determination", () => {
    const position = resolveOriginPosition(
      [
        fact({
          factType: "ORIGIN_CLAIM",
          status: "VERIFIED",
          effectiveTo: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ],
      NOW
    );

    expect(position.legalCountryOfOrigin).toBeNull();
    expect(position.unverifiedOriginClaims).toHaveLength(0);
  });

  it("ignores a superseded determination", () => {
    const position = resolveOriginPosition(
      [fact({ factType: "ORIGIN_CLAIM", status: "SUPERSEDED" })],
      NOW
    );

    expect(position.legalCountryOfOrigin).toBeNull();
  });

  it("says nothing at all when there are no country facts", () => {
    const position = resolveOriginPosition([], NOW);

    expect(position.legalCountryOfOrigin).toBeNull();
    expect(position.manufactureCountries).toEqual([]);
    expect(position.statement).toContain("no approved country-of-origin determination");
    // No manufacturing country to caveat, so no caveat is invented.
    expect(position.statement).not.toContain("physical fact");
  });
});

describe("the system prompt carries the origin rules", () => {
  const prompt = buildCopilotSystemPrompt({ resolvedContext: null, today: "2026-08-12" });

  it("names every weak country fact as not being origin", () => {
    for (const phrase of [
      "manufacturing country",
      "supplier's country",
      "ship-from country",
      "port of loading",
      "export country",
    ]) {
      expect(prompt).toContain(phrase);
    }
  });

  it("forbids the specific wrong answers", () => {
    expect(prompt).toContain('Do not write "origin: Germany"');
    expect(prompt).toContain('Do not write "origin is likely Germany"');
  });

  it("tells the model to quote the resolved statement rather than reason", () => {
    expect(prompt).toContain("Use that statement. Do not improve on it.");
  });

  it("describes a declared origin on a shipment line as a declaration", () => {
    expect(prompt).toContain("That is what someone declared, not what Qubere determined");
  });

  it("is versioned, so an answer can be explained by the rules in force", () => {
    expect(COPILOT_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
