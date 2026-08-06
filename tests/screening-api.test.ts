import { describe, it, expect, beforeEach } from "vitest";

// =============================================================================
// SANCTIONS SCREENING & TRADE INTELLIGENCE API TEST SUITE
// =============================================================================

class ScreeningMockService {
  watchlists = [
    { entityName: "Shenzhen MicroElectronics Tech Corp", listSource: "OFAC_SDN", country: "China" },
    { entityName: "Global Defense Logistics LLC", listSource: "BIS_ENTITY_LIST", country: "Russia" },
  ];

  embargoes = ["CU", "IR", "KP", "UFLPA_XINJIANG"];

  screenParty(name: string) {
    const clean = name.toLowerCase();
    const match = this.watchlists.find((w) => clean.includes(w.entityName.toLowerCase()) || w.entityName.toLowerCase().includes(clean));
    if (match) {
      return { matchStatus: "BLOCKED", matchScore: 95, matchedEntity: match };
    }
    return { matchStatus: "PASSED", matchScore: 0, matchedEntity: null };
  }

  screenEmbargo(country: string) {
    const blocked = this.embargoes.some((e) => country.toUpperCase().includes(e) || country.toLowerCase().includes("xinjiang") || country.toLowerCase().includes("cuba"));
    return { isEmbargoed: blocked, status: blocked ? "BLOCKED_SANCTIONED_REGION" : "CLEARED" };
  }
}

describe("Denied Party Screening & Trade Intelligence Test Suite", () => {
  let service: ScreeningMockService;

  beforeEach(() => {
    service = new ScreeningMockService();
  });

  it("1. Denied Party Screening should match sanctioned entity name and trigger BLOCKED status", () => {
    const res = service.screenParty("Shenzhen MicroElectronics Tech Corp");
    expect(res.matchStatus).toBe("BLOCKED");
    expect(res.matchScore).toBeGreaterThanOrEqual(90);
    expect(res.matchedEntity?.listSource).toBe("OFAC_SDN");
  });

  it("2. Denied Party Screening should pass legitimate non-sanctioned companies", () => {
    const res = service.screenParty("Acme Trade Supplies LLC");
    expect(res.matchStatus).toBe("PASSED");
    expect(res.matchScore).toBe(0);
  });

  it("3. Embargo Screening should block imports originating from UFLPA Xinjiang regions or sanctioned countries", () => {
    const uflpa = service.screenEmbargo("China (Xinjiang Region)");
    expect(uflpa.isEmbargoed).toBe(true);
    expect(uflpa.status).toBe("BLOCKED_SANCTIONED_REGION");

    const clear = service.screenEmbargo("Japan");
    expect(clear.isEmbargoed).toBe(false);
    expect(clear.status).toBe("CLEARED");
  });
});
