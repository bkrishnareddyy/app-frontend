import { describe, expect, it } from "vitest";
import {
  COUNTRY_QUALIFIED_TYPES,
  UNIQUE_IDENTIFIER_TYPES,
  isAutoAttachable,
  matchParty,
  type MatchableParty,
} from "@/modules/party/partyMatching";

function party(overrides: Partial<MatchableParty> & { id: string }): MatchableParty {
  return {
    identifiers: [],
    registrations: [],
    normalizedNames: [],
    countries: [],
    ...overrides,
  };
}

const EORI_PARTY = party({
  id: "party_eori",
  identifiers: [{ identifierType: "EORI", normalizedValue: "DE123456789012345", issuingCountry: null }],
});

describe("matchParty: unique identifiers", () => {
  it("calls a single EORI hit an exact match", () => {
    const result = matchParty(
      { identifiers: [{ identifierType: "EORI", value: "de 1234-5678 9012345" }] },
      [EORI_PARTY, party({ id: "other" })]
    );
    expect(result.status).toBe("EXACT_MATCH");
    expect(result.rule).toBe("UNIQUE_IDENTIFIER");
    expect(result.candidates.map((c) => c.partyId)).toEqual(["party_eori"]);
  });

  it("normalizes punctuation and case on both sides before comparing", () => {
    const catalogue = [
      party({
        id: "party_code",
        identifiers: [{ identifierType: "INTERNAL_PARTY_CODE", normalizedValue: "SUP1002", issuingCountry: null }],
      }),
    ];
    const result = matchParty(
      { identifiers: [{ identifierType: "INTERNAL_PARTY_CODE", value: " sup-1002 " }] },
      catalogue
    );
    expect(result.status).toBe("EXACT_MATCH");
    expect(result.candidates[0]?.matchedValue).toBe("SUP1002");
  });

  it("reports a collision on a unique scheme as ambiguous rather than picking one", () => {
    // Two parties carrying the same EORI is a data error. Silently returning
    // the first would attach a shipment line to whichever row sorted first.
    const result = matchParty(
      { identifiers: [{ identifierType: "EORI", value: "DE123456789012345" }] },
      [EORI_PARTY, party({ ...EORI_PARTY, id: "party_dupe" })]
    );
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.candidates).toHaveLength(2);
  });

  it("does not fall through to a weaker rule when a strong rule found a collision", () => {
    const result = matchParty(
      {
        identifiers: [{ identifierType: "EORI", value: "DE123456789012345" }],
        legalName: "Acme Fabrication",
        country: "DE",
      },
      [EORI_PARTY, party({ ...EORI_PARTY, id: "party_dupe" })]
    );
    expect(result.rule).toBe("UNIQUE_IDENTIFIER");
  });

  it("keeps the unique and country-qualified identifier families disjoint", () => {
    for (const type of UNIQUE_IDENTIFIER_TYPES) {
      expect(COUNTRY_QUALIFIED_TYPES).not.toContain(type);
    }
  });
});

describe("matchParty: registration number", () => {
  const catalogue = [
    party({ id: "party_de", registrations: [{ normalizedRegistrationNumber: "HRB98765", country: "DE" }] }),
  ];

  it("is exact when the registration number is paired with its country", () => {
    const result = matchParty({ registrationNumber: "HRB 98765", registrationCountry: "DE" }, catalogue);
    expect(result.status).toBe("EXACT_MATCH");
    expect(result.rule).toBe("REGISTRATION_NUMBER");
    expect(result.candidates[0]?.partyId).toBe("party_de");
  });

  it("does not match a registration number with no country supplied", () => {
    const result = matchParty({ registrationNumber: "HRB 98765" }, catalogue);
    expect(result.status).toBe("NO_MATCH");
  });

  it("is ambiguous when the same number and country appear on two parties", () => {
    const result = matchParty(
      { registrationNumber: "HRB 98765", registrationCountry: "DE" },
      [catalogue[0]!, party({ id: "party_dupe", registrations: catalogue[0]!.registrations })]
    );
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.candidates).toHaveLength(2);
  });
});

describe("matchParty: country-qualified identifiers", () => {
  const catalogue = [
    party({
      id: "party_de",
      identifiers: [{ identifierType: "VAT", normalizedValue: "123456789", issuingCountry: "DE" }],
    }),
    party({
      id: "party_fr",
      identifiers: [{ identifierType: "VAT", normalizedValue: "123456789", issuingCountry: "FR" }],
    }),
  ];

  it("is exact when the VAT number is qualified by its issuing country", () => {
    const result = matchParty(
      { identifiers: [{ identifierType: "VAT", value: "123456789", issuingCountry: "DE" }] },
      catalogue
    );
    expect(result.status).toBe("EXACT_MATCH");
    expect(result.rule).toBe("COUNTRY_QUALIFIED_IDENTIFIER");
    expect(result.candidates[0]?.partyId).toBe("party_de");
  });

  it("never returns EXACT for a VAT number with no issuing country, even when only one party carries it", () => {
    // The same digits are a real VAT number in more than one jurisdiction.
    // One hit today is an accident of the catalogue, not an identification.
    const result = matchParty({ identifiers: [{ identifierType: "VAT", value: "123456789" }] }, [catalogue[0]!]);
    expect(result.status).toBe("POSSIBLE_MATCH");
    expect(result.rule).toBe("UNQUALIFIED_IDENTIFIER");
  });

  it("is ambiguous when an unqualified VAT number hits several parties", () => {
    const result = matchParty({ identifiers: [{ identifierType: "VAT", value: "123456789" }] }, catalogue);
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.candidates).toHaveLength(2);
  });
});

describe("matchParty: name and country", () => {
  const catalogue = [party({ id: "party_named", normalizedNames: ["ACME TRADING"], countries: ["DE"] })];

  it("never determines identity from name and country alone, however exact the agreement", () => {
    const result = matchParty({ legalName: "Acme Trading Co., Ltd.", country: "DE" }, catalogue);
    expect(result.status).toBe("POSSIBLE_MATCH");
    expect(result.rule).toBe("NAME_AND_COUNTRY");
  });

  it("refuses to match on name alone, with no country", () => {
    const result = matchParty({ legalName: "Acme Trading" }, catalogue);
    expect(result.status).toBe("NO_MATCH");
  });

  it("refuses to match a named party against a catalogue row in a different country", () => {
    const result = matchParty({ legalName: "Acme Trading", country: "FR" }, catalogue);
    expect(result.status).toBe("NO_MATCH");
  });

  it("stays POSSIBLE, never EXACT, even with a single unambiguous hit", () => {
    const result = matchParty({ legalName: "Acme Trading", country: "DE" }, catalogue);
    expect(result.candidates).toHaveLength(1);
    expect(result.status).not.toBe("EXACT_MATCH");
  });
});

describe("matchParty: no match", () => {
  it("returns NO_MATCH with no candidates and no rule when nothing was supplied", () => {
    const result = matchParty({}, [EORI_PARTY]);
    expect(result).toEqual({ status: "NO_MATCH", candidates: [], rule: null });
  });

  it("ignores identifiers that normalize to nothing", () => {
    const result = matchParty({ identifiers: [{ identifierType: "EORI", value: "   -- " }] }, [EORI_PARTY]);
    expect(result.status).toBe("NO_MATCH");
  });
});

describe("isAutoAttachable", () => {
  it("permits attachment only for a single exact match", () => {
    expect(
      isAutoAttachable(matchParty({ identifiers: [{ identifierType: "EORI", value: "DE123456789012345" }] }, [EORI_PARTY]))
    ).toBe(true);
  });

  it("refuses every weaker outcome", () => {
    const possible = matchParty(
      { identifiers: [{ identifierType: "VAT", value: "123456789" }] },
      [party({ id: "party_a", identifiers: [{ identifierType: "VAT", normalizedValue: "123456789", issuingCountry: null }] })]
    );
    const ambiguous = matchParty(
      { identifiers: [{ identifierType: "EORI", value: "DE123456789012345" }] },
      [EORI_PARTY, party({ ...EORI_PARTY, id: "party_dupe" })]
    );
    expect(isAutoAttachable(possible)).toBe(false);
    expect(isAutoAttachable(ambiguous)).toBe(false);
    expect(isAutoAttachable(matchParty({}, []))).toBe(false);
  });
});

describe("matching is deterministic", () => {
  it("returns the same result for the same inputs, independent of catalogue order", () => {
    const a = party({ id: "party_a", identifiers: [{ identifierType: "VAT", normalizedValue: "123456789", issuingCountry: null }] });
    const b = party({ id: "party_b", identifiers: [{ identifierType: "VAT", normalizedValue: "123456789", issuingCountry: null }] });
    const input = { identifiers: [{ identifierType: "VAT" as const, value: "123456789" }] };

    const forwards = matchParty(input, [a, b]);
    const backwards = matchParty(input, [b, a]);

    expect(forwards.status).toBe(backwards.status);
    expect(new Set(forwards.candidates.map((c) => c.partyId))).toEqual(new Set(backwards.candidates.map((c) => c.partyId)));
  });

  it("explains every candidate by naming the evidence, never a score", () => {
    const result = matchParty({ identifiers: [{ identifierType: "EORI", value: "DE123456789012345" }] }, [EORI_PARTY]);
    for (const candidate of result.candidates) {
      expect(candidate.explanation).toContain("EORI");
      expect(candidate.explanation).not.toMatch(/confiden|score|probabil|%/i);
    }
  });
});

describe("matchParty: client-level tie breaking", () => {
  it("prefers client-scoped candidate over shared catalog candidate when matching for a client", () => {
    const sharedParty = party({
      id: "party_shared",
      clientId: null,
      identifiers: [{ identifierType: "EORI", normalizedValue: "DE123456789012345", issuingCountry: null }],
    });
    const clientParty = party({
      id: "party_client_a",
      clientId: "cli_a",
      identifiers: [{ identifierType: "EORI", normalizedValue: "DE123456789012345", issuingCountry: null }],
    });

    const result = matchParty(
      { identifiers: [{ identifierType: "EORI", value: "DE123456789012345" }], clientId: "cli_a" },
      [sharedParty, clientParty]
    );

    expect(result.status).toBe("EXACT_MATCH");
    expect(result.candidates.map((c) => c.partyId)).toEqual(["party_client_a"]);
  });
});
