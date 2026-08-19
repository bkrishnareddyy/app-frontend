import { describe, expect, it } from "vitest";
import { parseProductQuery, buildProductWhere } from "@/modules/product/productQuery";
import { parsePartyQuery, buildPartyWhere } from "@/modules/party/partyQuery";
import { matchProduct } from "@/modules/product/productMatching";
import { matchParty } from "@/modules/party/partyMatching";

describe("Client Catalog Scoping: Product Query", () => {
  it("parses clientId and clientScope query parameters", () => {
    const params = new URLSearchParams("clientId=cli_abc&clientScope=include_shared");
    const parsed = parseProductQuery(params);
    expect(parsed.clientId).toBe("cli_abc");
    expect(parsed.clientScope).toBe("include_shared");
  });

  it("builds exact clientId filter when clientScope is exact or unassigned", () => {
    const exactWhere = buildProductWhere("acct_1", parseProductQuery(new URLSearchParams("clientId=cli_abc")));
    expect(exactWhere.clientId).toBe("cli_abc");

    const unassignedWhere = buildProductWhere("acct_1", parseProductQuery(new URLSearchParams("clientId=unassigned")));
    expect(unassignedWhere.clientId).toBeNull();
  });

  it("builds include_shared clientId filter when requested", () => {
    const sharedWhere = buildProductWhere("acct_1", parseProductQuery(new URLSearchParams("clientId=cli_abc&clientScope=include_shared")));
    expect(sharedWhere.clientId).toEqual({ in: ["cli_abc", null] });
  });
});

describe("Client Catalog Scoping: Party Query", () => {
  it("parses clientId and clientScope query parameters", () => {
    const params = new URLSearchParams("clientId=cli_xyz&clientScope=include_shared");
    const parsed = parsePartyQuery(params);
    expect(parsed.clientId).toBe("cli_xyz");
    expect(parsed.clientScope).toBe("include_shared");
  });

  it("builds exact clientId filter when clientScope is exact or unassigned", () => {
    const exactWhere = buildPartyWhere("acct_1", parsePartyQuery(new URLSearchParams("clientId=cli_xyz")));
    expect(exactWhere.clientId).toBe("cli_xyz");

    const unassignedWhere = buildPartyWhere("acct_1", parsePartyQuery(new URLSearchParams("clientId=unassigned")));
    expect(unassignedWhere.clientId).toBeNull();
  });

  it("builds include_shared clientId filter when requested", () => {
    const sharedWhere = buildPartyWhere("acct_1", parsePartyQuery(new URLSearchParams("clientId=cli_xyz&clientScope=include_shared")));
    expect(sharedWhere.clientId).toEqual({ in: ["cli_xyz", null] });
  });
});

describe("Client Catalog Scoping: Product Matching", () => {
  it("prioritizes client-specific product over account-wide shared product", () => {
    const sharedProd = {
      id: "prod_shared",
      productName: "Widget 100",
      brand: "Acme",
      internalSku: "SKU-100",
      clientId: null,
      identifiers: [{ identifierType: "GTIN" as const, normalizedValue: "100200300" }],
      manufacturerPartyIds: [],
    };
    const clientProd = {
      id: "prod_client",
      productName: "Widget 100 Client Spec",
      brand: "Acme",
      internalSku: "SKU-100",
      clientId: "cli_100",
      identifiers: [{ identifierType: "GTIN" as const, normalizedValue: "100200300" }],
      manufacturerPartyIds: [],
    };

    const matchResult = matchProduct(
      {
        identifiers: [{ identifierType: "GTIN", value: "100200300" }],
        clientId: "cli_100",
      },
      [sharedProd, clientProd]
    );

    expect(matchResult.status).toBe("EXACT_MATCH");
    expect(matchResult.candidates[0]?.productId).toBe("prod_client");
  });
});

describe("Client Catalog Scoping: Party Matching", () => {
  it("prioritizes client-specific party over account-wide shared party", () => {
    const sharedParty = {
      id: "party_shared",
      clientId: null,
      identifiers: [{ identifierType: "DUNS" as const, normalizedValue: "999888777", issuingCountry: null }],
      registrations: [],
      normalizedNames: ["ACME LOGISTICS"],
      countries: ["US"],
    };
    const clientParty = {
      id: "party_client",
      clientId: "cli_200",
      identifiers: [{ identifierType: "DUNS" as const, normalizedValue: "999888777", issuingCountry: null }],
      registrations: [],
      normalizedNames: ["ACME LOGISTICS"],
      countries: ["US"],
    };

    const matchResult = matchParty(
      {
        identifiers: [{ identifierType: "DUNS", value: "999888777" }],
        clientId: "cli_200",
      },
      [sharedParty, clientParty]
    );

    expect(matchResult.status).toBe("EXACT_MATCH");
    expect(matchResult.candidates[0]?.partyId).toBe("party_client");
  });
});
