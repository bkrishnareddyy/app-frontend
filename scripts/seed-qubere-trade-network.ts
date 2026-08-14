/**
 * Qubere Agentic Customs — Parties & Products Seed Data.
 *
 * Builds a durable demo tenant ("Qubere Demo Trading") with a realistic
 * network of parties and products, exercised entirely through the domain
 * service layer (createParty/createProduct and their mutation companions) so
 * that normalization, matching, versioning, and automatic change detection
 * run exactly as they do for a real caller. A second tenant ("Qubere Test
 * Logistics") carries a couple of isolated rows for cross-tenant checks.
 *
 * Idempotent: every step looks up its target before creating it, so this can
 * be re-run safely. Nothing here deletes or overwrites prior seed output —
 * "change scenarios" are real follow-up mutations that supersede individual
 * fields, never replacements of a whole Product or Party row.
 *
 * Usage:
 *   npx tsx scripts/seed-qubere-trade-network.ts
 */
import { db, withDataModeContext } from "@/lib/db";
import { assertDemoSeedingAllowed } from "@/lib/environment";
import {
  createParty,
  addRelationship,
  type PartyActor,
} from "@/modules/party/partyService";
import type { CreatePartyInput } from "@/modules/party/partySchemas";
import {
  createProduct,
  setAttribute,
  addParty as addProductParty,
  removeParty as removeProductParty,
  addCountryFact,
  proposeClassification,
  reviewClassification,
  type ProductActor,
} from "@/modules/product/productService";
import type { CreateProductInput } from "@/modules/product/productSchemas";

assertDemoSeedingAllowed();

// The shared dev database this seeds against is slow enough that the
// service layer's default interactive-transaction timeout occasionally
// expires on a cold connection. Idempotency (getOrCreate*) makes a retry
// safe: a timed-out transaction rolls back fully, so nothing is created
// twice.
async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "P2028" || i === attempts - 1) throw err;
      console.warn(`  Transient DB error (${code}), retrying (${i + 1}/${attempts})...`);
    }
  }
  throw new Error("unreachable");
}

const REQUEST_ID = "seed:qubere-trade-network";

const TENANT_A_SLUG = "qubere-demo-trading";
const TENANT_B_SLUG = "qubere-test-logistics";

// ---------------------------------------------------------------------------
// Accounts, roles, users
// ---------------------------------------------------------------------------

async function seedAccount(slug: string, name: string) {
  return db.account.upsert({
    where: { slug },
    update: {},
    create: { name, slug, type: "ENTERPRISE", status: "ACTIVE", dataMode: "DEMO" },
  });
}

async function seedUser(email: string, firstName: string, lastName: string, clerkSuffix: string) {
  return db.user.upsert({
    where: { email },
    update: {},
    create: { clerkUserId: `demo_qubere_${clerkSuffix}`, email, firstName, lastName },
  });
}

async function attachOwner(accountId: string, userId: string, ownerRoleId: string) {
  await db.accountMembership.upsert({
    where: { accountId_userId: { accountId, userId } },
    update: { status: "ACTIVE" },
    create: { accountId, userId, status: "ACTIVE" },
  });
  const membership = await db.accountMembership.findFirstOrThrow({ where: { accountId, userId } });
  await db.accountMembershipRole.upsert({
    where: { accountMembershipId_roleId: { accountMembershipId: membership.id, roleId: ownerRoleId } },
    update: {},
    create: { accountMembershipId: membership.id, roleId: ownerRoleId },
  });
}

async function seedAccountsAndUsers() {
  const tenantA = await seedAccount(TENANT_A_SLUG, "Qubere Demo Trading");
  const tenantB = await seedAccount(TENANT_B_SLUG, "Qubere Test Logistics");

  let ownerRole = await db.role.findFirst({ where: { accountId: null, name: "OWNER" } });
  if (!ownerRole) {
    const SYSTEM_ROLES = ["OWNER", "ADMIN", "BROKER", "SPECIALIST", "REVIEWER", "MEMBER", "VIEWER"];
    for (const name of SYSTEM_ROLES) {
      await db.role.create({
        data: { name, description: `System role ${name}`, isSystem: true },
      }).catch(() => null);
    }
    ownerRole = await db.role.findFirstOrThrow({ where: { accountId: null, name: "OWNER" } });
  }

  const seedAgentUser = await seedUser(
    "seed-agent@qubere-demo.local",
    "Qubere",
    "Seed Agent",
    "trade_network_seed_agent"
  );
  const reviewerUser = await seedUser(
    "trade-compliance-reviewer@qubere-demo.local",
    "Trade Compliance",
    "Reviewer",
    "trade_network_reviewer"
  );
  const tenantBUser = await seedUser(
    "isolation-check@qubere-test-logistics.local",
    "Isolation",
    "Check",
    "trade_network_tenant_b"
  );

  await attachOwner(tenantA.id, seedAgentUser.id, ownerRole.id);
  await attachOwner(tenantA.id, reviewerUser.id, ownerRole.id);
  await attachOwner(tenantB.id, tenantBUser.id, ownerRole.id);

  return { tenantA, tenantB, seedAgentUser, reviewerUser, tenantBUser };
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

interface PartyDef {
  code: string;
  legalName: string;
  tradeName?: string;
  partyKind?: "ORGANIZATION" | "INDIVIDUAL";
  country: string;
  entityType: string;
  addressLine1: string;
  city: string;
  stateProvince?: string;
  postalCode?: string;
  roles: CreatePartyInput["roles"];
  identifiers?: CreatePartyInput["identifiers"];
  aliasNames?: { nameType: "TRADE" | "DBA"; rawName: string }[];
  needsLegalEntity: boolean;
}

const TENANT_A_PARTY_DEFS: PartyDef[] = [
  {
    code: "NORTHSTAR-IMPORTS-US",
    legalName: "NorthStar Imports USA Inc.",
    country: "US",
    entityType: "US_CORPORATION",
    addressLine1: "4820 Freight Commons Drive",
    city: "Charlotte",
    stateProvince: "NC",
    postalCode: "28273",
    roles: [{ roleType: "IMPORTER" }, { roleType: "BUYER" }],
    identifiers: [{ identifierType: "EORI", value: "QBR-EORI-US-00001" }],
    needsLegalEntity: true,
  },
  {
    code: "AQUILA-DE",
    legalName: "Aquila Industrial Systems GmbH",
    country: "DE",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "Industriestrasse 44",
    city: "Stuttgart",
    postalCode: "70565",
    roles: [{ roleType: "MANUFACTURER" }],
    identifiers: [{ identifierType: "VAT", value: "QBR-VAT-DE-000001", issuingCountry: "DE" }],
    aliasNames: [{ nameType: "TRADE", rawName: "Aquila Industrial" }],
    needsLegalEntity: true,
  },
  {
    code: "AQUILA-PL",
    legalName: "Aquila Manufacturing Polska Sp. z o.o.",
    country: "PL",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "ul. Fabryczna 12",
    city: "Wroclaw",
    postalCode: "50-001",
    roles: [{ roleType: "MANUFACTURER" }],
    identifiers: [{ identifierType: "VAT", value: "QBR-VAT-PL-000001", issuingCountry: "PL" }],
    needsLegalEntity: true,
  },
  {
    code: "NOVATECH-VN",
    legalName: "NovaTech Electronics Vietnam Co. Ltd.",
    country: "VN",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "Lot 8, Vsip Industrial Park",
    city: "Thuan An",
    roles: [{ roleType: "MANUFACTURER" }],
    identifiers: [{ identifierType: "CUSTOMS_ID", value: "QBR-CID-VN-000001" }],
    needsLegalEntity: true,
  },
  {
    code: "INDIGO-IN",
    legalName: "Indigo Apparel Manufacturing Pvt. Ltd.",
    country: "IN",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "Plot 22, Textile SEZ",
    city: "Tiruppur",
    roles: [{ roleType: "MANUFACTURER" }],
    identifiers: [{ identifierType: "CUSTOMS_ID", value: "QBR-CID-IN-000001" }],
    needsLegalEntity: true,
  },
  {
    code: "EASTERN-COMMERCE-CN",
    legalName: "Eastern Commerce Trading Co. Ltd.",
    country: "CN",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "88 Nanjing Road",
    city: "Shanghai",
    roles: [{ roleType: "SUPPLIER" }, { roleType: "MANUFACTURER" }],
    identifiers: [{ identifierType: "CUSTOMS_ID", value: "QBR-CID-CN-000001" }],
    needsLegalEntity: true,
  },
  {
    code: "HARBORGATE-US",
    legalName: "HarborGate Customs Services LLC",
    country: "US",
    entityType: "US_LLC",
    addressLine1: "1200 Port Authority Blvd",
    city: "Newark",
    stateProvince: "NJ",
    postalCode: "07114",
    roles: [{ roleType: "CUSTOMS_BROKER" }],
    identifiers: [{ identifierType: "CUSTOMS_ID", value: "QBR-CID-US-000002" }],
    needsLegalEntity: true,
  },
  {
    code: "BLUEBRIDGE-NL",
    legalName: "BlueBridge Global Logistics BV",
    country: "NL",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "Havenweg 5",
    city: "Rotterdam",
    roles: [{ roleType: "FREIGHT_FORWARDER" }],
    identifiers: [{ identifierType: "VAT", value: "QBR-VAT-NL-000001", issuingCountry: "NL" }],
    needsLegalEntity: true,
  },
  {
    code: "OCEANARC-SG",
    legalName: "OceanArc Container Lines Ltd.",
    country: "SG",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "1 Marina Boulevard",
    city: "Singapore",
    roles: [{ roleType: "CARRIER" }],
    identifiers: [{ identifierType: "CUSTOMS_ID", value: "QBR-CID-SG-000001" }],
    needsLegalEntity: true,
  },
  {
    code: "NORTHSTAR-DIST-US",
    legalName: "NorthStar Distribution Center East LLC",
    country: "US",
    entityType: "US_LLC",
    addressLine1: "900 Logistics Parkway",
    city: "Savannah",
    stateProvince: "GA",
    postalCode: "31408",
    roles: [{ roleType: "CONSIGNEE" }],
    identifiers: [{ identifierType: "EORI", value: "QBR-EORI-US-00002" }],
    needsLegalEntity: true,
  },
  {
    code: "LUMINA-GB",
    legalName: "Lumina Consumer Brands Ltd.",
    country: "GB",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "14 Regent Street",
    city: "London",
    roles: [{ roleType: "BUYER" }],
    identifiers: [{ identifierType: "VAT", value: "QBR-VAT-GB-000001", issuingCountry: "GB" }],
    needsLegalEntity: true,
  },
  {
    code: "CHEMCORE-BE",
    legalName: "ChemCore Specialty Materials NV",
    country: "BE",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "Chemiepark 3",
    city: "Antwerp",
    roles: [{ roleType: "SUPPLIER" }],
    identifiers: [{ identifierType: "VAT", value: "QBR-VAT-BE-000001", issuingCountry: "BE" }],
    needsLegalEntity: true,
  },
  {
    code: "GLOBAL-COMPONENTS-LTD",
    legalName: "Global Components Ltd.",
    country: "GB",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "22 Component Way",
    city: "Birmingham",
    roles: [{ roleType: "SUPPLIER" }],
    identifiers: [{ identifierType: "CUSTOMS_ID", value: "QBR-CID-GB-000001" }],
    needsLegalEntity: false,
  },
  {
    code: "GLOBAL-COMPONENTS-TRADING-LTD",
    legalName: "Global Components Trading Ltd.",
    country: "HK",
    entityType: "FOREIGN_ENTITY",
    addressLine1: "18 Harbour Road",
    city: "Hong Kong",
    roles: [{ roleType: "SUPPLIER" }],
    identifiers: [{ identifierType: "CUSTOMS_ID", value: "QBR-CID-HK-000001" }],
    needsLegalEntity: false,
  },
];

const TENANT_B_PARTY_DEFS: PartyDef[] = [
  {
    code: "CASCADE-FREIGHT-TB",
    legalName: "Cascade Freight Solutions Ltd.",
    country: "US",
    entityType: "US_CORPORATION",
    addressLine1: "77 Isolation Way",
    city: "Seattle",
    stateProvince: "WA",
    postalCode: "98101",
    roles: [{ roleType: "IMPORTER" }],
    identifiers: [{ identifierType: "EORI", value: "QBR-EORI-US-90001" }],
    needsLegalEntity: false,
  },
];

interface SeededParty {
  partyId: string;
  legalEntityId: string | null;
}

async function getOrCreateParty(actor: PartyActor, def: PartyDef): Promise<string> {
  const existing = await db.party.findFirst({
    where: { accountId: actor.accountId, internalPartyCode: def.code, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  const input: CreatePartyInput = {
    partyKind: def.partyKind ?? "ORGANIZATION",
    internalPartyCode: def.code,
    names: [
      { nameType: "LEGAL", rawName: def.legalName, isPrimary: true, sourceType: "USER" },
      ...(def.aliasNames ?? []).map((alias) => ({ ...alias, sourceType: "USER" as const })),
    ],
    identifiers: def.identifiers,
    addresses: [
      {
        addressType: "REGISTERED",
        addressLine1: def.addressLine1,
        city: def.city,
        stateProvince: def.stateProvince,
        postalCode: def.postalCode,
        country: def.country,
        isPrimary: true,
        sourceType: "USER",
      },
    ],
    roles: def.roles,
  };

  const created = await withTransientRetry(() => createParty(actor, input));
  return created.id;
}

async function getOrCreateLegalEntity(
  accountId: string,
  partyId: string,
  def: PartyDef
): Promise<string> {
  const existing = await db.legalEntity.findFirst({ where: { accountId, partyId }, select: { id: true } });
  if (existing) return existing.id;

  const created = await db.legalEntity.create({
    data: {
      accountId,
      partyId,
      legalName: def.legalName,
      tradeName: def.tradeName ?? null,
      entityType: def.entityType,
      country: def.country,
      addressLine1: def.addressLine1,
      city: def.city,
      stateProvince: def.stateProvince ?? null,
      postalCode: def.postalCode ?? null,
      status: "ACTIVE",
    },
  });
  return created.id;
}

async function seedParties(
  actor: PartyActor,
  defs: PartyDef[]
): Promise<Map<string, SeededParty>> {
  const result = new Map<string, SeededParty>();
  for (const def of defs) {
    const partyId = await getOrCreateParty(actor, def);
    const legalEntityId = def.needsLegalEntity
      ? await getOrCreateLegalEntity(actor.accountId, partyId, def)
      : null;
    result.set(def.code, { partyId, legalEntityId });
  }
  return result;
}

async function seedPartyRelationships(actor: PartyActor, parties: Map<string, SeededParty>) {
  const relationships: { from: string; to: string; type: "SUBSIDIARY_OF" | "AFFILIATE_OF" }[] = [
    { from: "AQUILA-PL", to: "AQUILA-DE", type: "SUBSIDIARY_OF" },
    { from: "NORTHSTAR-DIST-US", to: "NORTHSTAR-IMPORTS-US", type: "AFFILIATE_OF" },
  ];

  for (const rel of relationships) {
    const from = parties.get(rel.from);
    const to = parties.get(rel.to);
    if (!from || !to) continue;

    const existing = await db.partyRelationship.findFirst({
      where: {
        accountId: actor.accountId,
        fromPartyId: from.partyId,
        toPartyId: to.partyId,
        relationshipType: rel.type,
        status: "ACTIVE",
      },
    });
    if (existing) continue;

    await withTransientRetry(() =>
      addRelationship(actor, from.partyId, {
        toPartyId: to.partyId,
        relationshipType: rel.type,
        sourceType: "USER",
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

interface ProductDef {
  sku: string;
  productName: string;
  brand?: string;
  model?: string;
  commercialDescription?: string;
  manufacturerCode?: string;
  supplierCode?: string;
  brandOwnerCode?: string;
  identifiers?: CreateProductInput["identifiers"];
  attributes?: CreateProductInput["attributes"];
  compositions?: CreateProductInput["compositions"];
  countryFacts?: CreateProductInput["countryFacts"];
}

const TENANT_A_PRODUCT_DEFS: ProductDef[] = [
  {
    sku: "VALVE-1001",
    productName: "Industrial Ball Valve VX-220",
    brand: "Aquila",
    model: "VX-220",
    commercialDescription: "2-piece stainless-body ball valve for oleohydraulic fluid control.",
    manufacturerCode: "AQUILA-DE",
    identifiers: [{ identifierType: "MODEL_NUMBER", value: "VX-220" }],
    attributes: [
      { attributeCode: "PRIMARY_MATERIAL", rawValue: "Brass", sourceType: "SUPPLIER_DECLARATION" },
      { attributeCode: "FUNCTION", rawValue: "Fluid flow control", sourceType: "USER" },
      { attributeCode: "POWERED", rawValue: "No", sourceType: "USER" },
    ],
    countryFacts: [{ factType: "MANUFACTURE_COUNTRY", country: "Germany", sourceType: "SUPPLIER_DECLARATION" }],
  },
  {
    sku: "ELEC-2001",
    productName: "AC Control Motor Drive AC65",
    brand: "NovaTech",
    model: "AC65",
    commercialDescription: "Variable-frequency AC motor drive controller.",
    manufacturerCode: "NOVATECH-VN",
    attributes: [
      { attributeCode: "POWER_RATING", rawValue: "65", rawUnit: "W", sourceType: "MANUFACTURER_DATASHEET" },
      { attributeCode: "VOLTAGE", rawValue: "230", rawUnit: "V", sourceType: "MANUFACTURER_DATASHEET" },
    ],
    countryFacts: [{ factType: "MANUFACTURE_COUNTRY", country: "Vietnam", sourceType: "SUPPLIER_DECLARATION" }],
  },
  {
    sku: "APP-3001",
    productName: "Men's Crew Neck T-Shirt",
    brand: "Indigo Basics",
    commercialDescription: "Men's short-sleeve crew neck T-shirt, casual wear.",
    manufacturerCode: "INDIGO-IN",
    attributes: [{ attributeCode: "INTENDED_USE", rawValue: "Apparel — casual wear", sourceType: "USER" }],
  },
  {
    sku: "APP-3002",
    productName: "Men's Crew Neck T-Shirt — Organic Cotton Blend",
    brand: "Indigo Basics",
    commercialDescription: "Men's short-sleeve crew neck T-shirt, cotton/polyester blend.",
    manufacturerCode: "INDIGO-IN",
    attributes: [
      { attributeCode: "PRIMARY_MATERIAL", rawValue: "Cotton/Polyester Blend", sourceType: "SUPPLIER_DECLARATION" },
      { attributeCode: "RETAIL_PACKAGED", rawValue: "Yes", sourceType: "USER" },
    ],
    compositions: [
      { material: "Cotton", percentage: 60, isCompleteDeclaration: true, sourceType: "SUPPLIER_DECLARATION" },
      { material: "Polyester", percentage: 40, isCompleteDeclaration: true, sourceType: "SUPPLIER_DECLARATION" },
    ],
  },
  {
    sku: "MOTOR-4001",
    productName: "Industrial AC Motor ZX900",
    brand: "Aquila",
    model: "ZX900",
    commercialDescription: "General-purpose industrial AC induction motor.",
    manufacturerCode: "AQUILA-DE",
    attributes: [
      { attributeCode: "FUNCTION", rawValue: "Rotational mechanical power", sourceType: "USER" },
      { attributeCode: "POWER_RATING", rawValue: "900", rawUnit: "W", sourceType: "MANUFACTURER_DATASHEET" },
    ],
  },
  {
    sku: "AUTO-5001",
    productName: "Automotive Brake Caliper Assembly",
    commercialDescription: "Cast-iron front brake caliper assembly for passenger vehicles.",
    manufacturerCode: "EASTERN-COMMERCE-CN",
    attributes: [
      { attributeCode: "PRIMARY_MATERIAL", rawValue: "Cast Iron", sourceType: "SUPPLIER_DECLARATION" },
      { attributeCode: "INTENDED_USE", rawValue: "Automotive braking system component", sourceType: "USER" },
    ],
  },
  {
    sku: "ELEC-2002",
    productName: "LED Panel Light Fixture",
    brand: "NovaTech",
    commercialDescription: "Recessed LED panel light fixture, commercial grade.",
    manufacturerCode: "NOVATECH-VN",
    attributes: [
      { attributeCode: "VOLTAGE", rawValue: "120", rawUnit: "V", sourceType: "MANUFACTURER_DATASHEET" },
      { attributeCode: "POWERED", rawValue: "Yes", sourceType: "USER" },
      { attributeCode: "PRIMARY_MATERIAL", rawValue: "Aluminum", sourceType: "SUPPLIER_DECLARATION" },
    ],
  },
  {
    sku: "CHEM-6001",
    productName: "Industrial Solvent Blend CX-40",
    commercialDescription: "Mixed organic solvent blend for industrial degreasing.",
    supplierCode: "CHEMCORE-BE",
    attributes: [
      { attributeCode: "HAZMAT", rawValue: "Yes", sourceType: "SUPPLIER_DECLARATION" },
      { attributeCode: "UN_NUMBER", rawValue: "UN1993", sourceType: "SUPPLIER_DECLARATION" },
      { attributeCode: "PRIMARY_MATERIAL", rawValue: "Mixed organic solvents", sourceType: "SUPPLIER_DECLARATION" },
    ],
    countryFacts: [{ factType: "MANUFACTURE_COUNTRY", country: "Belgium", sourceType: "SUPPLIER_DECLARATION" }],
  },
  {
    sku: "METAL-7001",
    productName: "Stainless Steel Hex Bolt M10",
    commercialDescription: "M10 stainless steel hex head bolt, 6mm+ shank diameter.",
    manufacturerCode: "AQUILA-DE",
    attributes: [
      { attributeCode: "PRIMARY_MATERIAL", rawValue: "Stainless Steel", sourceType: "SUPPLIER_DECLARATION" },
      { attributeCode: "PROCESSING_STATE", rawValue: "Finished", sourceType: "USER" },
    ],
  },
  {
    sku: "PLAST-8001",
    productName: "Injection-Molded Enclosure Housing",
    commercialDescription: "Injection-molded polypropylene enclosure housing.",
    supplierCode: "EASTERN-COMMERCE-CN",
    attributes: [
      { attributeCode: "PRIMARY_MATERIAL", rawValue: "Polypropylene", sourceType: "SUPPLIER_DECLARATION" },
      { attributeCode: "COLOUR", rawValue: "Black", sourceType: "USER" },
    ],
  },
  {
    sku: "CONS-9001",
    productName: "Reusable Water Bottle 750ml",
    brand: "Lumina",
    commercialDescription: "Double-wall stainless steel reusable water bottle, 750ml.",
    manufacturerCode: "NOVATECH-VN",
    brandOwnerCode: "LUMINA-GB",
    attributes: [
      { attributeCode: "PRIMARY_MATERIAL", rawValue: "Stainless Steel", sourceType: "SUPPLIER_DECLARATION" },
      { attributeCode: "RETAIL_PACKAGED", rawValue: "Yes", sourceType: "USER" },
    ],
  },
  {
    sku: "IND-1002",
    productName: "Industrial Conveyor Bracket",
    commercialDescription: "Structural steel bracket for conveyor assembly.",
    manufacturerCode: "AQUILA-PL",
    attributes: [
      { attributeCode: "PRIMARY_MATERIAL", rawValue: "Steel", sourceType: "SUPPLIER_DECLARATION" },
      { attributeCode: "FUNCTION", rawValue: "Structural support component", sourceType: "USER" },
    ],
  },
  {
    sku: "ORIGIN-1001",
    productName: "Multi-Sourced Circuit Board Assembly",
    commercialDescription: "Populated PCB assembly sourced through a multi-tier supply chain.",
    manufacturerCode: "NOVATECH-VN",
    attributes: [{ attributeCode: "PRIMARY_MATERIAL", rawValue: "Mixed electronic components", sourceType: "SUPPLIER_DECLARATION" }],
    countryFacts: [
      { factType: "ORIGIN_CLAIM", country: "Vietnam", sourceType: "SUPPLIER_DECLARATION" },
      { factType: "ORIGIN_CLAIM", country: "China", sourceType: "DOCUMENT" },
    ],
  },
];

async function getOrCreateProduct(
  actor: ProductActor,
  def: ProductDef,
  parties: Map<string, SeededParty>
): Promise<string> {
  const existing = await db.product.findFirst({
    where: { accountId: actor.accountId, internalSku: def.sku, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  const productParties: CreateProductInput["parties"] = [];
  if (def.manufacturerCode) {
    const legalEntityId = parties.get(def.manufacturerCode)?.legalEntityId;
    if (legalEntityId) productParties.push({ legalEntityId, role: "MANUFACTURER", sourceType: "USER" });
  }
  if (def.supplierCode) {
    const legalEntityId = parties.get(def.supplierCode)?.legalEntityId;
    if (legalEntityId) productParties.push({ legalEntityId, role: "SUPPLIER", sourceType: "USER" });
  }
  if (def.brandOwnerCode) {
    const legalEntityId = parties.get(def.brandOwnerCode)?.legalEntityId;
    if (legalEntityId) productParties.push({ legalEntityId, role: "BRAND_OWNER", sourceType: "USER" });
  }

  const input: CreateProductInput = {
    productName: def.productName,
    internalSku: def.sku,
    commercialDescription: def.commercialDescription,
    brand: def.brand,
    model: def.model,
    identifiers: def.identifiers,
    attributes: def.attributes,
    compositions: def.compositions,
    parties: productParties.length > 0 ? productParties : undefined,
    countryFacts: def.countryFacts,
  };

  const created = await withTransientRetry(() => createProduct(actor, input));
  return created.id;
}

async function seedProducts(
  actor: ProductActor,
  defs: ProductDef[],
  parties: Map<string, SeededParty>
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const def of defs) {
    const productId = await getOrCreateProduct(actor, def, parties);
    result.set(def.sku, productId);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Change scenarios: real follow-up mutations that exercise automatic change
// detection, rather than fabricated ProductChangeEvent rows. Prior values are
// superseded, not deleted, and the resulting revalidation flags are left OPEN
// to represent pending human review.
// ---------------------------------------------------------------------------

async function seedValveChangeScenario(actor: ProductActor, productId: string, parties: Map<string, SeededParty>) {
  const currentMaterial = await db.productAttribute.findFirst({
    where: { productId, accountId: actor.accountId, attributeCode: "PRIMARY_MATERIAL", status: "ACTIVE" },
  });
  if (currentMaterial && currentMaterial.rawValue !== "Stainless Steel") {
    await withTransientRetry(() =>
      setAttribute(actor, productId, {
        attributeCode: "PRIMARY_MATERIAL",
        rawValue: "Stainless Steel",
        sourceType: "SUPPLIER_DECLARATION",
      })
    );
  }

  const aquilaPl = parties.get("AQUILA-PL");
  const aquilaDe = parties.get("AQUILA-DE");
  if (aquilaPl?.legalEntityId && aquilaDe?.legalEntityId) {
    const polandManufacturer = await db.productParty.findFirst({
      where: { productId, accountId: actor.accountId, legalEntityId: aquilaPl.legalEntityId, role: "MANUFACTURER", status: "ACTIVE" },
    });
    if (!polandManufacturer) {
      const germanyManufacturer = await db.productParty.findFirst({
        where: { productId, accountId: actor.accountId, legalEntityId: aquilaDe.legalEntityId, role: "MANUFACTURER", status: "ACTIVE" },
      });
      await withTransientRetry(() =>
        addProductParty(actor, productId, { legalEntityId: aquilaPl.legalEntityId, role: "MANUFACTURER", sourceType: "SUPPLIER_DECLARATION" })
      );
      if (germanyManufacturer) {
        await withTransientRetry(() => removeProductParty(actor, productId, germanyManufacturer.id));
      }
    }
  }

  const polandFact = await db.productCountryFact.findFirst({
    where: { productId, accountId: actor.accountId, factType: "MANUFACTURE_COUNTRY", countryCode: "PL" },
  });
  if (!polandFact) {
    await withTransientRetry(() =>
      addCountryFact(actor, productId, { factType: "MANUFACTURE_COUNTRY", country: "Poland", sourceType: "SUPPLIER_DECLARATION" })
    );
  }
}

async function seedElectronicsChangeScenario(actor: ProductActor, productId: string) {
  const current = await db.productAttribute.findFirst({
    where: { productId, accountId: actor.accountId, attributeCode: "POWER_RATING", status: "ACTIVE" },
  });
  if (current && current.rawValue !== "100") {
    await withTransientRetry(() =>
      setAttribute(actor, productId, {
        attributeCode: "POWER_RATING",
        rawValue: "100",
        rawUnit: "W",
        sourceType: "MANUFACTURER_DATASHEET",
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Classifications. Only two products get a real ProductClassification, both
// against genuine HTS Master rows already seeded by scripts/seed.ts — every
// other product is left deliberately unclassified rather than fabricating a
// legal tariff conclusion.
// ---------------------------------------------------------------------------

async function seedClassifications(actor: ProductActor, products: Map<string, string>) {
  const valveId = products.get("VALVE-1001");
  if (valveId) {
    const existing = await db.productClassification.findFirst({
      where: { productId: valveId, accountId: actor.accountId, jurisdiction: "US", nomenclature: "HTSUS" },
    });
    if (!existing) {
      await withTransientRetry(() =>
        proposeClassification(actor, valveId, {
          jurisdiction: "US",
          nomenclature: "HTSUS",
          classificationCode: "8481.80.5090",
          description: "Valves for oleohydraulic or pneumatic transmissions",
          decisionSource: "AGENT",
          decisionMethod: "AGENT_PROPOSED",
        })
      );
    }
  }

  const metalId = products.get("METAL-7001");
  if (metalId) {
    let classification = await db.productClassification.findFirst({
      where: { productId: metalId, accountId: actor.accountId, jurisdiction: "US", nomenclature: "HTSUS" },
    });
    if (!classification) {
      classification = await withTransientRetry(() =>
        proposeClassification(actor, metalId, {
          jurisdiction: "US",
          nomenclature: "HTSUS",
          classificationCode: "7318.15.2065",
          description: "Screws and bolts of stainless steel, shank diameter 6mm or more",
          decisionSource: "USER",
          decisionMethod: "MANUAL",
        })
      );
    }
    if (classification.status === "PROPOSED") {
      classification = await withTransientRetry(() =>
        reviewClassification(actor, metalId, classification.id, "START_REVIEW", {
          reviewNote: "Routed to trade compliance for review.",
        })
      );
    }
    if (classification.status === "UNDER_REVIEW") {
      await withTransientRetry(() =>
        reviewClassification(actor, metalId, classification.id, "APPROVE", {
          reviewNote: "Confirmed against CBP ruling HQ H293841 — stainless hex bolts, 6mm+ shank.",
        })
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Shipments, exceptions, decisions
// ---------------------------------------------------------------------------

interface LineItemDef {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  countryOfOrigin: string;
  htsCode: string;
  htsConfidence?: number;
  status?: string;
}

interface ShipmentDef {
  shipmentNumber: string;
  importerName: string;
  countryOfExport?: string;
  countryOfOrigin?: string;
  parties: { code: string; role: string }[];
  documents: { docType: string; fileName: string; status?: string }[];
  lineItems: LineItemDef[];
  decisions: {
    agentName: string;
    status: string;
    decisionSummary: string;
    purpose?: string;
    dataSources?: string[];
    regulations?: string[];
    lineNumber?: number;
    proposedHtsCode?: string;
    rulesApplied?: string[];
    reviewedByReviewer?: boolean;
  }[];
  exceptions: {
    category: string;
    type: string;
    severity: string;
    description: string;
    blocking: boolean;
    sourceAgent?: string;
  }[];
}

const SHIPMENT_DEFS: ShipmentDef[] = [
  {
    shipmentNumber: "QBR-SHP-1001",
    importerName: "NorthStar Imports USA Inc.",
    countryOfExport: "Germany",
    countryOfOrigin: "Germany",
    parties: [
      { code: "NORTHSTAR-IMPORTS-US", role: "IMPORTER" },
      { code: "AQUILA-DE", role: "MANUFACTURER" },
      { code: "HARBORGATE-US", role: "CUSTOMS_BROKER" },
      { code: "BLUEBRIDGE-NL", role: "FREIGHT_FORWARDER" },
      { code: "OCEANARC-SG", role: "CARRIER" },
    ],
    documents: [
      { docType: "Commercial Invoice", fileName: "QBR-SHP-1001-invoice.pdf" },
      { docType: "Packing List", fileName: "QBR-SHP-1001-packing-list.pdf" },
      { docType: "Bill of Lading", fileName: "QBR-SHP-1001-bol.pdf" },
    ],
    lineItems: [
      {
        sku: "VALVE-1001",
        description: "Industrial Ball Valve VX-220",
        quantity: 500,
        unitPrice: 42.5,
        countryOfOrigin: "Germany",
        htsCode: "8481.80.5090",
        status: "Review Required",
      },
      {
        sku: "MOTOR-4001",
        description: "Industrial AC Motor ZX900",
        quantity: 120,
        unitPrice: 210,
        countryOfOrigin: "Germany",
        htsCode: "0000.00.0000",
        status: "Review Required",
      },
    ],
    decisions: [
      {
        agentName: "Product Intelligence Agent",
        status: "Completed",
        decisionSummary: "Matched 2 of 2 line items to Product Master via exact SKU (EXACT_MATCH/UNIQUE_IDENTIFIER).",
        purpose: "Match shipment line items to Product Master records",
        dataSources: ["Documents", "Product Master"],
      },
      {
        agentName: "Classification Agent",
        status: "Review Required",
        decisionSummary: "Proposed HTS 8481.80.5090 for VALVE-1001 (CANDIDATE — pending human classification review).",
        purpose: "Determine correct HS/HTS classification for line items",
        dataSources: ["Product Master", "Tariff Rulings"],
        regulations: ["US HTSUS 2026"],
        lineNumber: 1,
        proposedHtsCode: "8481.80.5090",
        rulesApplied: ["GRI 1"],
      },
    ],
    exceptions: [],
  },
  {
    shipmentNumber: "QBR-SHP-1002",
    importerName: "NorthStar Imports USA Inc.",
    countryOfExport: "Vietnam",
    countryOfOrigin: "Vietnam",
    parties: [
      { code: "NORTHSTAR-IMPORTS-US", role: "IMPORTER" },
      { code: "NOVATECH-VN", role: "MANUFACTURER" },
      { code: "HARBORGATE-US", role: "CUSTOMS_BROKER" },
      { code: "BLUEBRIDGE-NL", role: "FREIGHT_FORWARDER" },
      { code: "OCEANARC-SG", role: "CARRIER" },
    ],
    documents: [
      { docType: "Commercial Invoice", fileName: "QBR-SHP-1002-invoice.pdf" },
      { docType: "Packing List", fileName: "QBR-SHP-1002-packing-list.pdf" },
    ],
    lineItems: [
      {
        sku: "ELEC-2001",
        description: "AC Control Motor Drive AC65",
        quantity: 300,
        unitPrice: 58,
        countryOfOrigin: "Vietnam",
        htsCode: "0000.00.0000",
        status: "Review Required",
      },
      {
        sku: "ELEC-2002",
        description: "LED Panel Light Fixture",
        quantity: 800,
        unitPrice: 19.75,
        countryOfOrigin: "Vietnam",
        htsCode: "0000.00.0000",
        status: "Review Required",
      },
    ],
    decisions: [
      {
        agentName: "Classification Agent",
        status: "Attention",
        decisionSummary: "ELEC-2001 power rating changed from 65W to 100W after classification research began — revalidation required.",
        purpose: "Determine correct HS/HTS classification for line items",
        dataSources: ["Product Master"],
        lineNumber: 1,
      },
    ],
    exceptions: [
      {
        category: "CLASSIFICATION",
        type: "data_mismatch",
        severity: "High",
        description:
          "ELEC-2001 (AC65) power rating attribute changed from 65W to 100W after initial classification research began. Classification revalidation is required before this line can be filed.",
        blocking: true,
        sourceAgent: "Classification Agent",
      },
    ],
  },
  {
    shipmentNumber: "QBR-SHP-1003",
    importerName: "Lumina Consumer Brands Ltd.",
    countryOfExport: "India",
    countryOfOrigin: "India",
    parties: [
      { code: "LUMINA-GB", role: "BUYER" },
      { code: "INDIGO-IN", role: "MANUFACTURER" },
      { code: "EASTERN-COMMERCE-CN", role: "SUPPLIER" },
      { code: "HARBORGATE-US", role: "CUSTOMS_BROKER" },
    ],
    documents: [{ docType: "Commercial Invoice", fileName: "QBR-SHP-1003-invoice.pdf" }],
    lineItems: [
      {
        sku: "APP-3001",
        description: "Men's Crew Neck T-Shirt",
        quantity: 5000,
        unitPrice: 3.2,
        countryOfOrigin: "India",
        htsCode: "0000.00.0000",
        status: "Review Required",
      },
      {
        sku: "APP-3002",
        description: "Men's Crew Neck T-Shirt — Organic Cotton Blend",
        quantity: 3000,
        unitPrice: 3.9,
        countryOfOrigin: "India",
        htsCode: "0000.00.0000",
        status: "Review Required",
      },
    ],
    decisions: [],
    exceptions: [
      {
        category: "MISSING_DATA",
        type: "missing_document",
        severity: "Medium",
        description:
          "APP-3001 has no fiber composition on file — the commercial invoice does not state a material breakdown. Classification cannot proceed without a supplier declaration or lab test.",
        blocking: true,
        sourceAgent: "Classification Agent",
      },
    ],
  },
  {
    shipmentNumber: "QBR-SHP-1004",
    importerName: "NorthStar Imports USA Inc.",
    countryOfExport: "Vietnam",
    parties: [
      { code: "NORTHSTAR-IMPORTS-US", role: "IMPORTER" },
      { code: "NOVATECH-VN", role: "MANUFACTURER" },
    ],
    documents: [{ docType: "Commercial Invoice", fileName: "QBR-SHP-1004-invoice.pdf" }],
    lineItems: [
      {
        sku: "ORIGIN-1001",
        description: "Multi-Sourced Circuit Board Assembly",
        quantity: 1000,
        unitPrice: 14.25,
        countryOfOrigin: "Vietnam",
        htsCode: "0000.00.0000",
        status: "Review Required",
      },
    ],
    decisions: [
      {
        agentName: "Origin Agent",
        status: "Attention",
        decisionSummary: "Conflicting origin claims detected for ORIGIN-1001 (Vietnam vs China) — flagged for manual origin determination; no origin has been recorded.",
        purpose: "Determine country of origin for shipment line items",
        dataSources: ["Documents", "Product Master"],
        regulations: ["19 CFR Part 102"],
      },
    ],
    exceptions: [
      {
        category: "CONFLICT",
        type: "data_mismatch",
        severity: "Critical",
        description:
          "ORIGIN-1001 carries two conflicting ORIGIN_CLAIM country facts: Vietnam (per supplier declaration) and China (per commercial invoice). Origin cannot be determined until reconciled by a human reviewer; no automatic determination has been made.",
        blocking: true,
        sourceAgent: "Origin Agent",
      },
    ],
  },
  {
    shipmentNumber: "QBR-SHP-1005",
    importerName: "NorthStar Imports USA Inc.",
    countryOfExport: "Germany",
    countryOfOrigin: "Germany",
    parties: [
      { code: "NORTHSTAR-IMPORTS-US", role: "IMPORTER" },
      { code: "AQUILA-DE", role: "MANUFACTURER" },
      { code: "CHEMCORE-BE", role: "SUPPLIER" },
    ],
    documents: [{ docType: "Commercial Invoice", fileName: "QBR-SHP-1005-invoice.pdf" }],
    lineItems: [
      {
        sku: "METAL-7001",
        description: "Stainless Steel Hex Bolt M10",
        quantity: 20000,
        unitPrice: 0.18,
        countryOfOrigin: "Germany",
        htsCode: "7318.15.2065",
        htsConfidence: 96,
        status: "Valid",
      },
      {
        sku: "CHEM-6001",
        description: "Industrial Solvent Blend CX-40",
        quantity: 400,
        unitPrice: 22.5,
        countryOfOrigin: "Belgium",
        htsCode: "0000.00.0000",
        status: "Review Required",
      },
    ],
    decisions: [
      {
        agentName: "Classification Agent",
        status: "Approved",
        decisionSummary: "HTS 7318.15.2065 confirmed and approved for METAL-7001 after human review.",
        purpose: "Determine correct HS/HTS classification for line items",
        dataSources: ["Product Master", "Tariff Rulings"],
        regulations: ["US HTSUS 2026"],
        lineNumber: 1,
        proposedHtsCode: "7318.15.2065",
        rulesApplied: ["GRI 1", "GRI 6"],
        reviewedByReviewer: true,
      },
    ],
    exceptions: [],
  },
];

async function seedShipments(
  accountId: string,
  reviewerUserId: string,
  parties: Map<string, SeededParty>,
  products: Map<string, string>
) {
  for (const def of SHIPMENT_DEFS) {
    const existing = await db.shipment.findFirst({ where: { accountId, shipmentNumber: def.shipmentNumber } });
    if (existing) continue;

    const shipment = await db.shipment.create({
      data: {
        accountId,
        shipmentNumber: def.shipmentNumber,
        importerName: def.importerName,
        countryOfExport: def.countryOfExport,
        countryOfOrigin: def.countryOfOrigin,
        status: "In Progress",
      },
    });

    for (const partyRef of def.parties) {
      const legalEntityId = parties.get(partyRef.code)?.legalEntityId;
      if (!legalEntityId) continue;
      await db.shipmentParty.create({
        data: { shipmentId: shipment.id, legalEntityId, role: partyRef.role, source: "USER" },
      });
    }

    for (const doc of def.documents) {
      await db.shipmentDocument.create({
        data: {
          shipmentId: shipment.id,
          accountId,
          docType: doc.docType,
          fileName: doc.fileName,
          status: doc.status ?? "Received",
          source: "UPLOAD",
        },
      });
    }

    for (let i = 0; i < def.lineItems.length; i++) {
      const line = def.lineItems[i];
      await db.shipmentLineItem.create({
        data: {
          shipmentId: shipment.id,
          accountId,
          lineNumber: i + 1,
          partNumber: line.sku,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalValue: line.quantity * line.unitPrice,
          countryOfOrigin: line.countryOfOrigin,
          htsCode: line.htsCode,
          htsConfidence: line.htsConfidence ?? null,
          status: line.status ?? "Unreviewed",
          productId: products.get(line.sku) ?? null,
        },
      });
    }

    for (const decision of def.decisions) {
      await db.agentDecision.create({
        data: {
          shipmentId: shipment.id,
          accountId,
          agentName: decision.agentName,
          status: decision.status,
          decisionSummary: decision.decisionSummary,
          purpose: decision.purpose ?? null,
          dataSources: decision.dataSources ?? [],
          regulations: decision.regulations ?? [],
          lineNumber: decision.lineNumber ?? null,
          proposedHtsCode: decision.proposedHtsCode ?? null,
          rulesApplied: decision.rulesApplied ?? [],
          reviewedByUserId: decision.reviewedByReviewer ? reviewerUserId : null,
        },
      });
    }

    for (const exception of def.exceptions) {
      await db.exceptionItem.create({
        data: {
          accountId,
          shipmentId: shipment.id,
          category: exception.category,
          type: exception.type,
          severity: exception.severity,
          description: exception.description,
          blocking: exception.blocking,
          sourceAgent: exception.sourceAgent ?? null,
        },
      });
    }
  }
}

/** Product/party-level exceptions with no shipment to attach to. */
async function seedStandaloneExceptions(accountId: string) {
  const items: { code: string; category: string; type: string; severity: string; description: string }[] = [
    {
      code: "SEED-EXC-PARTY-AMBIGUITY-GLOBAL-COMPONENTS",
      category: "VALIDATION",
      type: "data_mismatch",
      severity: "Medium",
      description:
        "Two parties named 'Global Components...' exist in this tenant (Global Components Ltd., GB; Global Components Trading Ltd., HK). Verify supplier identity before linking either to a new shipment or product.",
    },
  ];

  for (const item of items) {
    const existing = await db.exceptionItem.findFirst({ where: { accountId, code: item.code } });
    if (existing) continue;
    await db.exceptionItem.create({
      data: {
        accountId,
        code: item.code,
        category: item.category,
        type: item.type,
        severity: item.severity,
        description: item.description,
        blocking: false,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Tenant B isolation fixture
// ---------------------------------------------------------------------------

async function seedTenantB(actor: PartyActor, productActor: ProductActor) {
  const parties = await seedParties(actor, TENANT_B_PARTY_DEFS);

  const existing = await db.product.findFirst({
    where: { accountId: productActor.accountId, internalSku: "TB-PRODUCT-0001", deletedAt: null },
  });
  if (!existing) {
    await withTransientRetry(() =>
      createProduct(productActor, {
        productName: "Isolation Check Test Product",
        internalSku: "TB-PRODUCT-0001",
        commercialDescription: "Tenant B fixture used only to verify cross-tenant isolation.",
      })
    );
  }

  return parties;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Seeding Qubere Agentic Customs trade network demo data...");

  const { tenantA, tenantB, seedAgentUser, reviewerUser, tenantBUser } = await seedAccountsAndUsers();
  console.log(`  Tenant A: ${tenantA.name} (${tenantA.id})`);
  console.log(`  Tenant B: ${tenantB.name} (${tenantB.id})`);

  const partyActor: PartyActor = {
    accountId: tenantA.id,
    userId: seedAgentUser.id,
    canApproveParty: true,
    canVerifyRegistration: true,
    canResolveRevalidation: true,
    requestId: REQUEST_ID,
  };
  const productActor: ProductActor = {
    accountId: tenantA.id,
    userId: seedAgentUser.id,
    canApproveClassification: true,
    requestId: REQUEST_ID,
  };

  const parties = await seedParties(partyActor, TENANT_A_PARTY_DEFS);
  console.log(`  Seeded ${parties.size} Tenant A parties.`);
  await seedPartyRelationships(partyActor, parties);

  const products = await seedProducts(productActor, TENANT_A_PRODUCT_DEFS, parties);
  console.log(`  Seeded ${products.size} Tenant A products.`);

  const valveId = products.get("VALVE-1001");
  if (valveId) await seedValveChangeScenario(productActor, valveId, parties);
  const elecId = products.get("ELEC-2001");
  if (elecId) await seedElectronicsChangeScenario(productActor, elecId);
  console.log("  Applied change scenarios for VALVE-1001 and ELEC-2001.");

  const reviewerProductActor: ProductActor = {
    accountId: tenantA.id,
    userId: reviewerUser.id,
    canApproveClassification: true,
    requestId: REQUEST_ID,
  };
  await seedClassifications(reviewerProductActor, products);
  console.log("  Seeded classifications: VALVE-1001 (CANDIDATE), METAL-7001 (APPROVED).");

  await seedShipments(tenantA.id, reviewerUser.id, parties, products);
  await seedStandaloneExceptions(tenantA.id);
  console.log(`  Seeded ${SHIPMENT_DEFS.length} shipments with documents, line items, decisions, and exceptions.`);

  const tenantBPartyActor: PartyActor = {
    accountId: tenantB.id,
    userId: tenantBUser.id,
    canApproveParty: true,
    requestId: REQUEST_ID,
  };
  const tenantBProductActor: ProductActor = {
    accountId: tenantB.id,
    userId: tenantBUser.id,
    canApproveClassification: true,
    requestId: REQUEST_ID,
  };
  await seedTenantB(tenantBPartyActor, tenantBProductActor);
  console.log("  Seeded Tenant B isolation fixture.");

  console.log("\nDone.");
}

withDataModeContext("DEMO", () => main())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
