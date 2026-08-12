import { describe, it, expect, beforeAll, vi } from "vitest";
import { db } from "../src/lib/db";
import { findProductMatches, type ProductActor } from "../src/modules/product/productService";
import { findPartyMatches, type PartyActor } from "../src/modules/party/partyService";

/**
 * Validates the durable output of `scripts/seed-qubere-trade-network.ts`.
 * This suite is read-only: it queries the seeded rows by their known slugs,
 * SKUs, and codes and never deletes anything, since the seed tenants are
 * meant to persist as a standing demo fixture.
 *
 * Run in isolation (never as part of the full suite):
 *   npx vitest run tests/qubere-trade-network-seed.test.ts
 */

// This account's DB connection is high-latency; several tests make multiple
// sequential round trips and exceed vitest's 5s default.
vi.setConfig({ testTimeout: 20000 });

const TENANT_A_SLUG = "qubere-demo-trading";
const TENANT_B_SLUG = "qubere-test-logistics";

let tenantAId: string;
let tenantBId: string;
let seedAgentUserId: string;
let reviewerUserId: string;

beforeAll(async () => {
  const tenantA = await db.account.findUniqueOrThrow({ where: { slug: TENANT_A_SLUG } });
  const tenantB = await db.account.findUniqueOrThrow({ where: { slug: TENANT_B_SLUG } });
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const seedAgent = await db.user.findUniqueOrThrow({ where: { email: "seed-agent@qubere-demo.local" } });
  const reviewer = await db.user.findUniqueOrThrow({
    where: { email: "trade-compliance-reviewer@qubere-demo.local" },
  });
  seedAgentUserId = seedAgent.id;
  reviewerUserId = reviewer.id;
});

async function partyByCode(accountId: string, code: string) {
  return db.party.findFirstOrThrow({
    where: { accountId, internalPartyCode: code, deletedAt: null },
    include: { names: true, identifiers: true, addresses: true, roles: true },
  });
}

async function productBySku(accountId: string, sku: string) {
  return db.product.findFirstOrThrow({
    where: { accountId, internalSku: sku, deletedAt: null },
  });
}

describe("accounts, users, and memberships", () => {
  it("bootstraps both tenants as DEMO-mode enterprise accounts", async () => {
    const tenantA = await db.account.findUniqueOrThrow({ where: { slug: TENANT_A_SLUG } });
    const tenantB = await db.account.findUniqueOrThrow({ where: { slug: TENANT_B_SLUG } });
    expect(tenantA.dataMode).toBe("DEMO");
    expect(tenantB.dataMode).toBe("DEMO");
  });

  it("attaches the seed agent and reviewer to Tenant A, and the isolation user to Tenant B", async () => {
    const membershipA = await db.accountMembership.findMany({
      where: { accountId: tenantAId, status: "ACTIVE" },
      include: { user: true },
    });
    const emails = membershipA.map((m) => m.user.email);
    expect(emails).toContain("seed-agent@qubere-demo.local");
    expect(emails).toContain("trade-compliance-reviewer@qubere-demo.local");

    const membershipB = await db.accountMembership.findMany({
      where: { accountId: tenantBId, status: "ACTIVE" },
      include: { user: true },
    });
    expect(membershipB.map((m) => m.user.email)).toContain("isolation-check@qubere-test-logistics.local");
  });
});

describe("Tenant A party roster", () => {
  it("seeds all 14 defined parties", async () => {
    const count = await db.party.count({ where: { accountId: tenantAId, deletedAt: null } });
    expect(count).toBeGreaterThanOrEqual(14);
  });

  it("gives Aquila DE its legal name and its TRADE alias", async () => {
    const aquilaDe = await partyByCode(tenantAId, "AQUILA-DE");
    const legal = aquilaDe.names.find((n) => n.nameType === "LEGAL" && n.status === "ACTIVE");
    const alias = aquilaDe.names.find((n) => n.nameType === "TRADE" && n.status === "ACTIVE");
    expect(legal?.rawName).toBe("Aquila Industrial Systems GmbH");
    expect(alias?.rawName).toBe("Aquila Industrial");
  });

  it("carries synthetic identifiers only, in the QBR- namespace", async () => {
    const parties = await db.party.findMany({
      where: { accountId: tenantAId, deletedAt: null },
      include: { identifiers: { where: { status: "ACTIVE" } } },
    });
    // INTERNAL_PARTY_CODE is the account-internal code (e.g. "AQUILA-DE"), not an
    // externally-issued credential — only externally-issued identifier types are
    // subject to the synthetic QBR- namespace requirement.
    const externalIdentifiers = parties.flatMap((p) => p.identifiers).filter((id) => id.identifierType !== "INTERNAL_PARTY_CODE");
    expect(externalIdentifiers.length).toBeGreaterThan(0);
    for (const id of externalIdentifiers) {
      expect(id.value.startsWith("QBR-")).toBe(true);
    }
  });

  it("keeps the two similarly-named Global Components parties as distinct rows", async () => {
    const gb = await partyByCode(tenantAId, "GLOBAL-COMPONENTS-LTD");
    const hk = await partyByCode(tenantAId, "GLOBAL-COMPONENTS-TRADING-LTD");
    expect(gb.id).not.toBe(hk.id);
    const gbAddress = gb.addresses.find((a) => a.status === "ACTIVE");
    const hkAddress = hk.addresses.find((a) => a.status === "ACTIVE");
    expect(gbAddress?.country).toBe("GB");
    expect(hkAddress?.country).toBe("HK");
  });

  it("records the AQUILA-PL SUBSIDIARY_OF AQUILA-DE relationship", async () => {
    const pl = await partyByCode(tenantAId, "AQUILA-PL");
    const de = await partyByCode(tenantAId, "AQUILA-DE");
    const rel = await db.partyRelationship.findFirst({
      where: { accountId: tenantAId, fromPartyId: pl.id, toPartyId: de.id, relationshipType: "SUBSIDIARY_OF" },
    });
    expect(rel?.status).toBe("ACTIVE");
  });

  it("records the NORTHSTAR-DIST-US AFFILIATE_OF NORTHSTAR-IMPORTS-US relationship", async () => {
    const dist = await partyByCode(tenantAId, "NORTHSTAR-DIST-US");
    const imports = await partyByCode(tenantAId, "NORTHSTAR-IMPORTS-US");
    const rel = await db.partyRelationship.findFirst({
      where: {
        accountId: tenantAId,
        fromPartyId: dist.id,
        toPartyId: imports.id,
        relationshipType: "AFFILIATE_OF",
      },
    });
    expect(rel?.status).toBe("ACTIVE");
  });
});

describe("Tenant A product roster", () => {
  it("seeds all 13 defined products", async () => {
    const count = await db.product.count({ where: { accountId: tenantAId, deletedAt: null } });
    expect(count).toBeGreaterThanOrEqual(13);
  });

  it("gives APP-3002 a complete two-material composition declaration", async () => {
    const product = await productBySku(tenantAId, "APP-3002");
    const compositions = await db.productComposition.findMany({
      where: { productId: product.id, accountId: tenantAId, status: "ACTIVE" },
    });
    expect(compositions).toHaveLength(2);
    const total = compositions.reduce((sum, c) => sum + Number(c.percentage), 0);
    expect(total).toBe(100);
  });

  it("gives CHEM-6001 a HAZMAT attribute and a UN number", async () => {
    const product = await productBySku(tenantAId, "CHEM-6001");
    const hazmat = await db.productAttribute.findFirst({
      where: { productId: product.id, accountId: tenantAId, attributeCode: "HAZMAT", status: "ACTIVE" },
    });
    const unNumber = await db.productAttribute.findFirst({
      where: { productId: product.id, accountId: tenantAId, attributeCode: "UN_NUMBER", status: "ACTIVE" },
    });
    expect(hazmat?.rawValue).toBe("Yes");
    expect(unNumber?.rawValue).toBe("UN1993");
  });

  it("records both conflicting ORIGIN_CLAIM country facts on ORIGIN-1001, neither one resolved", async () => {
    const product = await productBySku(tenantAId, "ORIGIN-1001");
    const claims = await db.productCountryFact.findMany({
      where: { productId: product.id, accountId: tenantAId, factType: "ORIGIN_CLAIM", status: "CLAIMED" },
    });
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((c) => c.countryCode))).toEqual(new Set(["VN", "CN"]));
  });

  it("leaves every product other than VALVE-1001 and METAL-7001 unclassified", async () => {
    const skus = ["APP-3001", "APP-3002", "MOTOR-4001", "AUTO-5001", "ELEC-2002", "CHEM-6001", "PLAST-8001", "CONS-9001", "IND-1002"];
    const results = await Promise.all(
      skus.map(async (sku) => {
        const product = await productBySku(tenantAId, sku);
        const count = await db.productClassification.count({ where: { productId: product.id, accountId: tenantAId } });
        return { sku, count };
      })
    );
    for (const result of results) {
      expect(result).toEqual({ sku: result.sku, count: 0 });
    }
  });
});

describe("VALVE-1001 change scenario", () => {
  it("now shows Stainless Steel as the active PRIMARY_MATERIAL", async () => {
    const product = await productBySku(tenantAId, "VALVE-1001");
    const material = await db.productAttribute.findFirst({
      where: { productId: product.id, accountId: tenantAId, attributeCode: "PRIMARY_MATERIAL", status: "ACTIVE" },
    });
    expect(material?.rawValue).toBe("Stainless Steel");
  });

  it("now shows Aquila Polska, not Aquila DE, as the active MANUFACTURER", async () => {
    const product = await productBySku(tenantAId, "VALVE-1001");
    const aquilaPl = await partyByCode(tenantAId, "AQUILA-PL");
    const aquilaDe = await partyByCode(tenantAId, "AQUILA-DE");
    const plLegalEntity = await db.legalEntity.findFirstOrThrow({ where: { accountId: tenantAId, partyId: aquilaPl.id } });
    const deLegalEntity = await db.legalEntity.findFirstOrThrow({ where: { accountId: tenantAId, partyId: aquilaDe.id } });

    const active = await db.productParty.findMany({
      where: { productId: product.id, accountId: tenantAId, role: "MANUFACTURER", status: "ACTIVE" },
    });
    expect(active.map((p) => p.legalEntityId)).toEqual([plLegalEntity.id]);

    const superseded = await db.productParty.findFirst({
      where: { productId: product.id, accountId: tenantAId, legalEntityId: deLegalEntity.id, role: "MANUFACTURER" },
    });
    expect(superseded?.status).toBe("SUPERSEDED");
  });

  it("adds a Poland MANUFACTURE_COUNTRY fact", async () => {
    const product = await productBySku(tenantAId, "VALVE-1001");
    const fact = await db.productCountryFact.findFirst({
      where: { productId: product.id, accountId: tenantAId, factType: "MANUFACTURE_COUNTRY", countryCode: "PL", status: "CLAIMED" },
    });
    expect(fact).not.toBeNull();
  });

  it("logs a CUSTOMS_SIGNIFICANT ProductAttribute:PRIMARY_MATERIAL change event", async () => {
    const product = await productBySku(tenantAId, "VALVE-1001");
    const event = await db.productChangeEvent.findFirst({
      where: { productId: product.id, accountId: tenantAId, entity: "ProductAttribute:PRIMARY_MATERIAL" },
    });
    expect(event?.significance).toBe("CUSTOMS_SIGNIFICANT");
    expect(event?.impactFlags.sort()).toEqual(["CLASSIFICATION_REVALIDATION_REQUIRED", "ORIGIN_REVALIDATION_REQUIRED"].sort());
  });

  it("logs a CUSTOMS_SIGNIFICANT ProductParty:MANUFACTURER change event", async () => {
    const product = await productBySku(tenantAId, "VALVE-1001");
    const event = await db.productChangeEvent.findFirst({
      where: { productId: product.id, accountId: tenantAId, entity: "ProductParty:MANUFACTURER" },
    });
    expect(event?.significance).toBe("CUSTOMS_SIGNIFICANT");
    expect(event?.impactFlags.sort()).toEqual(["ORIGIN_REVALIDATION_REQUIRED", "REGULATORY_REVALIDATION_REQUIRED"].sort());
  });

  it("opens exactly the CLASSIFICATION, ORIGIN, and REGULATORY revalidation flags, no VALUATION flag", async () => {
    const product = await productBySku(tenantAId, "VALVE-1001");
    const flags = await db.productRevalidationFlag.findMany({
      where: { productId: product.id, accountId: tenantAId, status: "OPEN" },
    });
    const flagTypes = new Set(flags.map((f) => f.flag));
    expect(flagTypes).toEqual(
      new Set(["CLASSIFICATION_REVALIDATION_REQUIRED", "ORIGIN_REVALIDATION_REQUIRED", "REGULATORY_REVALIDATION_REQUIRED"])
    );
  });

  it("bumped currentVersion past its initial value", async () => {
    const product = await productBySku(tenantAId, "VALVE-1001");
    expect(product.currentVersion).toBeGreaterThan(1);
  });
});

describe("ELEC-2001 change scenario", () => {
  it("now shows 100W as the active POWER_RATING", async () => {
    const product = await productBySku(tenantAId, "ELEC-2001");
    const rating = await db.productAttribute.findFirst({
      where: { productId: product.id, accountId: tenantAId, attributeCode: "POWER_RATING", status: "ACTIVE" },
    });
    expect(rating?.rawValue).toBe("100");
    expect(rating?.rawUnit).toBe("W");
  });

  it("opens only the CLASSIFICATION revalidation flag — no ORIGIN, no REGULATORY, no VALUATION", async () => {
    const product = await productBySku(tenantAId, "ELEC-2001");
    const flags = await db.productRevalidationFlag.findMany({
      where: { productId: product.id, accountId: tenantAId, status: "OPEN" },
    });
    expect(flags.map((f) => f.flag)).toEqual(["CLASSIFICATION_REVALIDATION_REQUIRED"]);
  });
});

describe("classification lifecycle", () => {
  it("leaves VALVE-1001's HTSUS classification at CANDIDATE, agent-proposed", async () => {
    const product = await productBySku(tenantAId, "VALVE-1001");
    const classification = await db.productClassification.findFirstOrThrow({
      where: { productId: product.id, accountId: tenantAId, jurisdiction: "US", nomenclature: "HTSUS" },
    });
    expect(classification.status).toBe("CANDIDATE");
    expect(classification.decisionMethod).toBe("AGENT_PROPOSED");
    expect(classification.normalizedCode).toBe("8481805090");
  });

  it("carries METAL-7001's HTSUS classification through to APPROVED", async () => {
    const product = await productBySku(tenantAId, "METAL-7001");
    const classification = await db.productClassification.findFirstOrThrow({
      where: { productId: product.id, accountId: tenantAId, jurisdiction: "US", nomenclature: "HTSUS" },
    });
    expect(classification.status).toBe("APPROVED");
    expect(classification.decisionMethod).toBe("MANUAL");
    expect(classification.normalizedCode).toBe("7318152065");
  });
});

describe("product matching (PI scenarios)", () => {
  const actor = () => ({ accountId: tenantAId, userId: seedAgentUserId, canApproveClassification: true, requestId: "test" }) as ProductActor;

  it("matches VALVE-1001 exactly by its INTERNAL_SKU identifier", async () => {
    const result = await findProductMatches(actor(), { identifiers: [{ identifierType: "INTERNAL_SKU", value: "VALVE-1001" }] });
    expect(result.status).toBe("EXACT_MATCH");
    const product = await productBySku(tenantAId, "VALVE-1001");
    expect(result.candidates.map((c) => c.productId)).toEqual([product.id]);
  });

  it("matches VALVE-1001 only possibly by its MODEL_NUMBER identifier alone (manufacturer-qualified, not unique)", async () => {
    const result = await findProductMatches(actor(), { identifiers: [{ identifierType: "MODEL_NUMBER", value: "VX-220" }] });
    expect(result.status).toBe("POSSIBLE_MATCH");
  });

  it("shows VALVE-1001 carrying only Aquila Polska as manufacturer post-change-scenario", async () => {
    const product = await productBySku(tenantAId, "VALVE-1001");
    const aquilaPl = await partyByCode(tenantAId, "AQUILA-PL");
    const plLegalEntity = await db.legalEntity.findFirstOrThrow({ where: { accountId: tenantAId, partyId: aquilaPl.id } });
    const manufacturerLinks = await db.productParty.findMany({
      where: { productId: product.id, accountId: tenantAId, role: "MANUFACTURER", status: "ACTIVE" },
    });
    expect(manufacturerLinks.map((l) => l.legalEntityId)).toEqual([plLegalEntity.id]);
  });

  it("does not match an internal SKU that was never seeded", async () => {
    const result = await findProductMatches(actor(), { identifiers: [{ identifierType: "INTERNAL_SKU", value: "NOT-A-REAL-SKU" }] });
    expect(result.status).toBe("NO_MATCH");
  });
});

describe("party matching (PA scenarios)", () => {
  const actor = () => ({ accountId: tenantAId, userId: seedAgentUserId, canApproveParty: true, requestId: "test" }) as PartyActor;

  it("is EXACT_MATCH for Aquila DE's VAT number qualified by its issuing country", async () => {
    const result = await findPartyMatches(actor(), {
      identifiers: [{ identifierType: "VAT", value: "QBR-VAT-DE-000001", issuingCountry: "DE" }],
    });
    expect(result.status).toBe("EXACT_MATCH");
    const aquilaDe = await partyByCode(tenantAId, "AQUILA-DE");
    expect(result.candidates.map((c) => c.partyId)).toEqual([aquilaDe.id]);
  });

  it("is only POSSIBLE_MATCH for the same VAT number with no issuing country supplied", async () => {
    const result = await findPartyMatches(actor(), { identifiers: [{ identifierType: "VAT", value: "QBR-VAT-DE-000001" }] });
    expect(result.status).toBe("POSSIBLE_MATCH");
  });

  it("refuses to identify a Global Components party by name alone", async () => {
    const result = await findPartyMatches(actor(), { legalName: "Global Components Ltd." });
    expect(result.status).toBe("NO_MATCH");
  });

  it("never conflates the two Global Components parties when a country is supplied", async () => {
    const result = await findPartyMatches(actor(), { legalName: "Global Components Ltd.", country: "GB" });
    const gb = await partyByCode(tenantAId, "GLOBAL-COMPONENTS-LTD");
    expect(result.candidates.map((c) => c.partyId)).toEqual([gb.id]);
  });
});

describe("shipments, decisions, and exceptions", () => {
  it("seeds all 5 defined shipments", async () => {
    const numbers = ["QBR-SHP-1001", "QBR-SHP-1002", "QBR-SHP-1003", "QBR-SHP-1004", "QBR-SHP-1005"];
    for (const shipmentNumber of numbers) {
      const shipment = await db.shipment.findFirst({ where: { accountId: tenantAId, shipmentNumber } });
      expect({ shipmentNumber, found: shipment !== null }).toEqual({ shipmentNumber, found: true });
    }
  });

  it("blocks QBR-SHP-1002 on the ELEC-2001 power-rating change exception", async () => {
    const shipment = await db.shipment.findFirstOrThrow({ where: { accountId: tenantAId, shipmentNumber: "QBR-SHP-1002" } });
    const exceptions = await db.exceptionItem.findMany({ where: { accountId: tenantAId, shipmentId: shipment.id } });
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]?.blocking).toBe(true);
    expect(exceptions[0]?.category).toBe("CLASSIFICATION");
  });

  it("blocks QBR-SHP-1004 on the conflicting-origin exception, with no origin decision recorded", async () => {
    const shipment = await db.shipment.findFirstOrThrow({ where: { accountId: tenantAId, shipmentNumber: "QBR-SHP-1004" } });
    const exceptions = await db.exceptionItem.findMany({ where: { accountId: tenantAId, shipmentId: shipment.id } });
    expect(exceptions[0]?.severity).toBe("Critical");
    expect(exceptions[0]?.blocking).toBe(true);
    expect(shipment.countryOfOrigin).toBeNull();
  });

  it("marks QBR-SHP-1005's METAL-7001 line as reviewed by the compliance reviewer, with no blocking exceptions", async () => {
    const shipment = await db.shipment.findFirstOrThrow({ where: { accountId: tenantAId, shipmentNumber: "QBR-SHP-1005" } });
    const decisions = await db.agentDecision.findMany({ where: { accountId: tenantAId, shipmentId: shipment.id } });
    const approved = decisions.find((d) => d.status === "Approved");
    expect(approved?.reviewedByUserId).toBe(reviewerUserId);
    const exceptions = await db.exceptionItem.findMany({ where: { accountId: tenantAId, shipmentId: shipment.id, blocking: true } });
    expect(exceptions).toHaveLength(0);
  });

  it("records the standalone Global Components ambiguity exception with no shipment attached", async () => {
    const exception = await db.exceptionItem.findFirst({
      where: { accountId: tenantAId, code: "SEED-EXC-PARTY-AMBIGUITY-GLOBAL-COMPONENTS" },
    });
    expect(exception?.shipmentId).toBeNull();
    expect(exception?.blocking).toBe(false);
  });
});

describe("Tenant B isolation", () => {
  it("keeps Tenant B's party out of every Tenant A query", async () => {
    const tenantBParty = await db.party.findFirstOrThrow({ where: { accountId: tenantBId, internalPartyCode: "CASCADE-FREIGHT-TB" } });
    const foundUnderTenantA = await db.party.findFirst({ where: { accountId: tenantAId, id: tenantBParty.id } });
    expect(foundUnderTenantA).toBeNull();
  });

  it("keeps Tenant B's product out of every Tenant A query", async () => {
    const tenantBProduct = await db.product.findFirstOrThrow({ where: { accountId: tenantBId, internalSku: "TB-PRODUCT-0001" } });
    const foundUnderTenantA = await db.product.findFirst({ where: { accountId: tenantAId, id: tenantBProduct.id } });
    expect(foundUnderTenantA).toBeNull();
  });

  it("never returns Tenant B's party as a match candidate for a Tenant A search", async () => {
    const actor = { accountId: tenantAId, userId: seedAgentUserId, canApproveParty: true, requestId: "test" } as PartyActor;
    const result = await findPartyMatches(actor, {
      identifiers: [{ identifierType: "EORI", value: "QBR-EORI-US-90001" }],
    });
    expect(result.status).toBe("NO_MATCH");
  });
});
