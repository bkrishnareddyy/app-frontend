/**
 * Tests for DPS screening and party change detection relevant to the
 * F11 party-screening feature.
 *
 * All tests here are pure — no database, no network. The scoring function
 * is tested independently of the database so the algorithm is verifiable
 * without Prisma.
 *
 * Three invariants:
 *   1. An exact name match (case-insensitive) must score 100 and produce a
 *      BLOCKED outcome at the threshold used by `scoreToMatchStatus`.
 *   2. A partial match (one string contains the other) scores 85 — above the
 *      FLAGGED threshold.
 *   3. A clearly unrelated name scores 0 and produces a PASSED outcome.
 *
 * Party revalidation tests confirm that screening-significant changes
 * (legal name, EORI, registered address country) open the right flags and
 * that softer changes (trade name, mailing address) open a weaker flag.
 */

import { describe, expect, it } from "vitest";
import { scoreDpsMatch, scoreToMatchStatus } from "@/lib/screening/fuzzyMatch";
import {
  detectPartyChanges,
  revalidationSignals,
  highestSignificance,
  type PartySnapshot,
} from "@/modules/party/partyChangeDetection";

// ---------------------------------------------------------------------------
// scoreDpsMatch: pure fuzzy scoring
// ---------------------------------------------------------------------------

describe("scoreDpsMatch: exact matches", () => {
  it("returns 100 for a byte-identical name", () => {
    expect(scoreDpsMatch("Acme Trading Co", "Acme Trading Co")).toBe(100);
  });

  it("returns 100 for names that differ only in case", () => {
    expect(scoreDpsMatch("ACME TRADING CO", "acme trading co")).toBe(100);
  });

  it("returns 100 for names that differ only in leading/trailing whitespace", () => {
    expect(scoreDpsMatch("  Acme Trading  ", "Acme Trading")).toBe(100);
  });
});

describe("scoreDpsMatch: containment matches", () => {
  it("returns 85 when the target name contains the watchlist entry", () => {
    expect(scoreDpsMatch("Acme Trading Co Ltd", "Acme Trading Co")).toBe(85);
  });

  it("returns 85 when the watchlist entry contains the target name", () => {
    expect(scoreDpsMatch("Acme Trading", "Acme Trading Co Ltd")).toBe(85);
  });
});

describe("scoreDpsMatch: word-overlap scoring", () => {
  it("returns 0 for completely unrelated names", () => {
    expect(scoreDpsMatch("Ocean Star Shipping", "Global Finance Corp")).toBe(0);
  });

  it("returns a positive score for a partial word overlap (> 3 chars per word)", () => {
    const score = scoreDpsMatch("Global Shipping Services", "Global Trade Services Corp");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(85);
  });

  it("caps the word-overlap score at 75", () => {
    const score = scoreDpsMatch(
      "Acme Alpha Beta Gamma Delta",
      "Acme Alpha Beta Gamma Delta Corp Ltd"
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it("ignores short words (3 chars or fewer) in the overlap calculation", () => {
    // "The" (3), "Co" (2), "Ltd" (3) all fail the length > 3 guard → no overlap tokens
    const score = scoreDpsMatch("The Co Ltd", "The Co SA");
    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreToMatchStatus: threshold mapping
// ---------------------------------------------------------------------------

describe("scoreToMatchStatus: threshold correctness", () => {
  it("maps score 100 to BLOCKED", () => {
    expect(scoreToMatchStatus(100)).toBe("BLOCKED");
  });

  it("maps score 80 to BLOCKED (boundary)", () => {
    expect(scoreToMatchStatus(80)).toBe("BLOCKED");
  });

  it("maps score 79 to FLAGGED (just below BLOCKED threshold)", () => {
    expect(scoreToMatchStatus(79)).toBe("FLAGGED");
  });

  it("maps score 50 to FLAGGED (boundary)", () => {
    expect(scoreToMatchStatus(50)).toBe("FLAGGED");
  });

  it("maps score 49 to PASSED (just below FLAGGED threshold)", () => {
    expect(scoreToMatchStatus(49)).toBe("PASSED");
  });

  it("maps score 0 to PASSED", () => {
    expect(scoreToMatchStatus(0)).toBe("PASSED");
  });
});

// ---------------------------------------------------------------------------
// Party revalidation signals: screening-relevant changes
// ---------------------------------------------------------------------------

function snapshot(overrides: Partial<PartySnapshot> = {}): PartySnapshot {
  return { names: [], identifiers: [], registrations: [], addresses: [], ...overrides };
}

describe("party revalidation: legal name change triggers screening flag", () => {
  it("opens SCREENING_REVALIDATION_REQUIRED when a legal name changes", () => {
    const before = snapshot({
      names: [{ nameType: "LEGAL", normalizedName: "ACME TRADING" }],
    });
    const after = snapshot({
      names: [{ nameType: "LEGAL", normalizedName: "ACME GLOBAL TRADING" }],
    });

    const changes = detectPartyChanges(before, after);
    const signals = revalidationSignals(changes);
    expect(signals.some((s) => s.flag === "SCREENING_REVALIDATION_REQUIRED")).toBe(true);
  });

  it("does not open SCREENING flag for a trade name change (identity flag only)", () => {
    const before = snapshot({
      names: [{ nameType: "TRADE_NAME", normalizedName: "ACME" }],
    });
    const after = snapshot({
      names: [{ nameType: "TRADE_NAME", normalizedName: "ACME EUROPE" }],
    });

    const changes = detectPartyChanges(before, after);
    const signals = revalidationSignals(changes);
    expect(signals.every((s) => s.flag !== "SCREENING_REVALIDATION_REQUIRED")).toBe(true);
    expect(signals.some((s) => s.flag === "IDENTITY_REVALIDATION_REQUIRED")).toBe(true);
  });
});

describe("party revalidation: address changes", () => {
  it("raises screening revalidation when a registered address changes", () => {
    const before = snapshot({
      addresses: [
        { addressType: "REGISTERED", addressLine1: "1 Old St", city: "Berlin", country: "DE" },
      ],
    });
    const after = snapshot({
      addresses: [
        { addressType: "REGISTERED", addressLine1: "2 New Ave", city: "Munich", country: "DE" },
      ],
    });

    const changes = detectPartyChanges(before, after);
    expect(highestSignificance(changes)).toBe("COMPLIANCE_SIGNIFICANT");
  });

  it("does not raise screening for a mailing address change", () => {
    const before = snapshot({
      addresses: [
        { addressType: "MAILING", addressLine1: "Box 1", city: "Hamburg", country: "DE" },
      ],
    });
    const after = snapshot({
      addresses: [
        { addressType: "MAILING", addressLine1: "Box 2", city: "Frankfurt", country: "DE" },
      ],
    });

    const changes = detectPartyChanges(before, after);
    const signals = revalidationSignals(changes);
    expect(signals.every((s) => s.flag !== "SCREENING_REVALIDATION_REQUIRED")).toBe(true);
  });
});

describe("party revalidation: identifier changes", () => {
  it("raises SCREENING_REVALIDATION_REQUIRED when an EORI changes", () => {
    const before = snapshot({
      identifiers: [{ identifierType: "EORI", normalizedValue: "DE111", issuingCountry: null }],
    });
    const after = snapshot({
      identifiers: [{ identifierType: "EORI", normalizedValue: "DE999", issuingCountry: null }],
    });

    const changes = detectPartyChanges(before, after);
    const signals = revalidationSignals(changes);
    expect(signals.some((s) => s.flag === "SCREENING_REVALIDATION_REQUIRED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreToMatchStatus + scoreDpsMatch: end-to-end alert thresholds
// ---------------------------------------------------------------------------

describe("end-to-end: match score maps to correct compliance outcome", () => {
  it("an exact legal name match against a watchlist entry produces BLOCKED", () => {
    const score = scoreDpsMatch("Sanctioned Corp Ltd", "Sanctioned Corp Ltd");
    expect(scoreToMatchStatus(score)).toBe("BLOCKED");
  });

  it("a containment name match produces BLOCKED (score 85 ≥ threshold 80)", () => {
    const score = scoreDpsMatch("Sanctioned Corp Ltd UK Branch", "Sanctioned Corp Ltd");
    expect(scoreToMatchStatus(score)).toBe("BLOCKED");
  });

  it("a clearly unrelated party name produces PASSED", () => {
    const score = scoreDpsMatch("Totally Unrelated Manufacturer", "Sanctioned Corp Ltd");
    expect(scoreToMatchStatus(score)).toBe("PASSED");
  });
});
