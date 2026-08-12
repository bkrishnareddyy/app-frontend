import { describe, expect, it } from "vitest";
import {
  detectPartyChanges,
  highestSignificance,
  namesAreEquivalent,
  revalidationSignals,
  type PartySnapshot,
} from "@/modules/party/partyChangeDetection";

function snapshot(overrides: Partial<PartySnapshot> = {}): PartySnapshot {
  return {
    names: [],
    identifiers: [],
    registrations: [],
    addresses: [],
    ...overrides,
  };
}

const flagsOf = (changes: ReturnType<typeof detectPartyChanges>) => new Set(changes.flatMap((c) => c.impactFlags));

describe("detectPartyChanges: names", () => {
  it("treats a legal name change as compliance-significant and re-raises screening", () => {
    const changes = detectPartyChanges(
      snapshot({ names: [{ nameType: "LEGAL", normalizedName: "ACME TRADING" }] }),
      snapshot({ names: [{ nameType: "LEGAL", normalizedName: "ACME GLOBAL TRADING" }] })
    );
    expect(changes).toHaveLength(2);
    expect(highestSignificance(changes)).toBe("COMPLIANCE_SIGNIFICANT");
    expect(flagsOf(changes)).toEqual(new Set(["IDENTITY_REVALIDATION_REQUIRED", "SCREENING_REVALIDATION_REQUIRED"]));
  });

  it("does not raise screening for a trade name change, only identity", () => {
    const changes = detectPartyChanges(
      snapshot({ names: [{ nameType: "TRADE_NAME", normalizedName: "ACME" }] }),
      snapshot({ names: [{ nameType: "TRADE_NAME", normalizedName: "ACME EUROPE" }] })
    );
    expect(highestSignificance(changes)).toBe("POTENTIALLY_COMPLIANCE_SIGNIFICANT");
    expect(flagsOf(changes)).toEqual(new Set(["IDENTITY_REVALIDATION_REQUIRED"]));
  });

  it("reports no change when nothing moved", () => {
    expect(detectPartyChanges(snapshot(), snapshot())).toEqual([]);
  });
});

describe("detectPartyChanges: identifiers", () => {
  it("re-raises identity and screening on a changed EORI, a registry identifier", () => {
    const changes = detectPartyChanges(
      snapshot({ identifiers: [{ identifierType: "EORI", normalizedValue: "DE111", issuingCountry: null }] }),
      snapshot({ identifiers: [{ identifierType: "EORI", normalizedValue: "DE222", issuingCountry: null }] })
    );
    expect(changes[0]?.significance).toBe("COMPLIANCE_SIGNIFICANT");
    expect(changes[0]?.impactFlags).toEqual(["IDENTITY_REVALIDATION_REQUIRED", "SCREENING_REVALIDATION_REQUIRED"]);
  });

  it("stays non-material for a tenant-internal reference number", () => {
    const changes = detectPartyChanges(
      snapshot({ identifiers: [{ identifierType: "CUSTOMER_NUMBER", normalizedValue: "C1", issuingCountry: null }] }),
      snapshot({ identifiers: [{ identifierType: "CUSTOMER_NUMBER", normalizedValue: "C2", issuingCountry: null }] })
    );
    expect(changes[0]?.significance).toBe("NON_MATERIAL");
    expect(changes[0]?.impactFlags).toEqual([]);
  });

  it("keys by scheme, so a corrected value shows as one change, not a remove-and-add pair", () => {
    const changes = detectPartyChanges(
      snapshot({ identifiers: [{ identifierType: "EORI", normalizedValue: "DE111", issuingCountry: null }] }),
      snapshot({ identifiers: [{ identifierType: "EORI", normalizedValue: "DE222", issuingCountry: null }] })
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.field).toBe("value");
  });
});

describe("detectPartyChanges: registrations", () => {
  it("raises registration and screening revalidation on any change, kept by country", () => {
    const changes = detectPartyChanges(
      snapshot({ registrations: [{ country: "DE", registrationNumber: "HRB1", legalForm: null, registeringAuthority: null }] }),
      snapshot({ registrations: [{ country: "DE", registrationNumber: "HRB2", legalForm: null, registeringAuthority: null }] })
    );
    expect(changes[0]?.significance).toBe("COMPLIANCE_SIGNIFICANT");
    expect(new Set(changes[0]?.impactFlags)).toEqual(
      new Set(["REGISTRATION_REVALIDATION_REQUIRED", "SCREENING_REVALIDATION_REQUIRED"])
    );
  });

  it("raises on a registration appearing in a new jurisdiction and on one disappearing", () => {
    const added = detectPartyChanges(
      snapshot(),
      snapshot({ registrations: [{ country: "FR", registrationNumber: "R1", legalForm: null, registeringAuthority: null }] })
    );
    const removed = detectPartyChanges(
      snapshot({ registrations: [{ country: "FR", registrationNumber: "R1", legalForm: null, registeringAuthority: null }] }),
      snapshot()
    );
    expect(added[0]?.field).toBe("added");
    expect(removed[0]?.field).toBe("removed");
  });
});

describe("detectPartyChanges: addresses", () => {
  it("records a pure reformat but raises nothing", () => {
    const changes = detectPartyChanges(
      snapshot({ addresses: [{ addressType: "MAILING", addressLine1: "1 Main St", city: "Berlin", country: "DE" }] }),
      snapshot({ addresses: [{ addressType: "MAILING", addressLine1: "1  MAIN   ST", city: "berlin", country: "DE" }] })
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.significance).toBe("NON_MATERIAL");
    expect(changes[0]?.impactFlags).toEqual([]);
  });

  it("treats a changed registered address as compliance-significant and re-raises screening", () => {
    const changes = detectPartyChanges(
      snapshot({ addresses: [{ addressType: "REGISTERED", addressLine1: "1 Main St", city: "Berlin", country: "DE" }] }),
      snapshot({ addresses: [{ addressType: "REGISTERED", addressLine1: "2 Other St", city: "Munich", country: "DE" }] })
    );
    expect(changes[0]?.significance).toBe("COMPLIANCE_SIGNIFICANT");
    expect(new Set(changes[0]?.impactFlags)).toEqual(
      new Set(["ADDRESS_REVALIDATION_REQUIRED", "SCREENING_REVALIDATION_REQUIRED"])
    );
  });

  it("does not raise screening for a changed site or mailing address, only address revalidation", () => {
    const changes = detectPartyChanges(
      snapshot({ addresses: [{ addressType: "SITE", addressLine1: "1 Main St", city: "Berlin", country: "DE" }] }),
      snapshot({ addresses: [{ addressType: "SITE", addressLine1: "2 Other St", city: "Munich", country: "DE" }] })
    );
    expect(changes[0]?.significance).toBe("POTENTIALLY_COMPLIANCE_SIGNIFICANT");
    expect(changes[0]?.impactFlags).toEqual(["ADDRESS_REVALIDATION_REQUIRED"]);
  });
});

describe("revalidationSignals", () => {
  it("collapses many changes into one signal per flag, keeping every reason", () => {
    const changes = detectPartyChanges(
      snapshot({
        names: [{ nameType: "LEGAL", normalizedName: "ACME" }],
        registrations: [{ country: "DE", registrationNumber: "HRB1", legalForm: null, registeringAuthority: null }],
      }),
      snapshot({
        names: [{ nameType: "LEGAL", normalizedName: "ACME GLOBAL" }],
        registrations: [{ country: "DE", registrationNumber: "HRB2", legalForm: null, registeringAuthority: null }],
      })
    );
    const signals = revalidationSignals(changes);
    const screening = signals.find((s) => s.flag === "SCREENING_REVALIDATION_REQUIRED");

    expect(signals.filter((s) => s.flag === "SCREENING_REVALIDATION_REQUIRED")).toHaveLength(1);
    expect(screening?.triggeredBy.length).toBeGreaterThan(1);
    expect(screening?.reason).toContain("PartyName:LEGAL");
    expect(screening?.reason).toContain("PartyRegistration:DE");
  });

  it("produces no signal at all when nothing significant changed", () => {
    const changes = detectPartyChanges(
      snapshot({ addresses: [{ addressType: "MAILING", addressLine1: "1 Main St", city: null, country: "DE" }] }),
      snapshot({ addresses: [{ addressType: "MAILING", addressLine1: "1  main  st", city: null, country: "DE" }] })
    );
    expect(revalidationSignals(changes)).toEqual([]);
  });

  it("only ever emits the four workflow signals", () => {
    const changes = detectPartyChanges(
      snapshot(),
      snapshot({
        names: [{ nameType: "LEGAL", normalizedName: "NEW CO" }],
        identifiers: [{ identifierType: "EORI", normalizedValue: "DE111", issuingCountry: null }],
        registrations: [{ country: "DE", registrationNumber: "HRB1", legalForm: null, registeringAuthority: null }],
        addresses: [{ addressType: "REGISTERED", addressLine1: "1 Main St", city: null, country: "DE" }],
      })
    );
    for (const signal of revalidationSignals(changes)) {
      expect([
        "IDENTITY_REVALIDATION_REQUIRED",
        "REGISTRATION_REVALIDATION_REQUIRED",
        "ADDRESS_REVALIDATION_REQUIRED",
        "SCREENING_REVALIDATION_REQUIRED",
      ]).toContain(signal.flag);
    }
  });
});

describe("highestSignificance", () => {
  it("ranks compliance-significant above potentially-significant above non-material", () => {
    expect(highestSignificance([])).toBe("NON_MATERIAL");
    expect(
      highestSignificance(
        detectPartyChanges(
          snapshot({ names: [{ nameType: "TRADE_NAME", normalizedName: "A" }] }),
          snapshot({ names: [{ nameType: "TRADE_NAME", normalizedName: "B" }] })
        )
      )
    ).toBe("POTENTIALLY_COMPLIANCE_SIGNIFICANT");
    expect(
      highestSignificance(
        detectPartyChanges(
          snapshot({ names: [{ nameType: "LEGAL", normalizedName: "A" }] }),
          snapshot({ names: [{ nameType: "LEGAL", normalizedName: "B" }] })
        )
      )
    ).toBe("COMPLIANCE_SIGNIFICANT");
  });
});

describe("namesAreEquivalent", () => {
  it("folds legal-form suffixes and formatting before comparing", () => {
    expect(namesAreEquivalent("Acme Trading Co., Ltd.", "ACME TRADING")).toBe(true);
    expect(namesAreEquivalent("Acme Trading", "Acme Global Trading")).toBe(false);
  });
});
