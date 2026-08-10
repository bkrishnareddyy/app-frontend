import { describe, it, expect, vi, beforeEach } from "vitest";

// This suite previously declared a `ClearanceEngineMockService` in this same file
// with hardcoded documents, extraction fields and its own reconcile/screen/normalize
// methods. It imported no route handler, so the clearance engine was never run.

const ctxMock = vi.fn();

// Both routes now read back what they persisted, so the mocks need a store rather
// than a bare spy: a create that vanishes would hide the duplicate-suppression bug.
type Row = Record<string, unknown>;
let issueStore: Row[] = [];
let pgaStore: Row[] = [];
let nextId = 0;

function matches(row: Row, where: Row = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in (value as object)) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === value;
  });
}

const dbMock = {
  shipment: { findFirst: vi.fn() },
  shipmentLineItem: { findMany: vi.fn() },
  extractionField: { findMany: vi.fn() },
  reconciliationIssue: {
    findMany: vi.fn(async ({ where }: { where?: Row } = {}) => issueStore.filter((r) => matches(r, where))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `iss_${++nextId}`, createdAt: new Date(nextId), ...data };
      issueStore.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = issueStore.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const rows = issueStore.filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    }),
  },
  pgaRequirement: {
    findMany: vi.fn(async ({ where }: { where?: Row } = {}) => pgaStore.filter((r) => matches(r, where))),
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      data.forEach((d) => pgaStore.push({ id: `pga_${++nextId}`, createdAt: new Date(nextId), ...d }));
      return { count: data.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: Row }) => {
      const keep = pgaStore.filter((r) => !matches(r, where));
      const removed = pgaStore.length - keep.length;
      pgaStore = keep;
      return { count: removed };
    }),
  },
  canonicalProduct: { findFirst: vi.fn(), create: vi.fn() },
  productAlias: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/audit", () => ({ createAuditLog: vi.fn() }));

const reconcile = await import("@/app/api/reconcile/route");
const pga = await import("@/app/api/pga/screen/route");
const normalize = await import("@/app/api/products/normalize/route");

const ACCOUNT = "acc_1";

function post(body: unknown) {
  return new Request("http://t/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function doc(docType: string, id = docType) {
  return { id, docType };
}

/** Extraction rows as the route reads them: one row per document per field. */
function extracted(rows: Array<[string, string, string]>) {
  // Shaped like the stored column set, because the route now resolves which
  // reading is current from source and createdAt, not just from confidence.
  return rows.map(([documentId, fieldName, value], index) => ({
    id: `ef_${index}`,
    documentId,
    fieldName,
    value,
    confidence: 90,
    pageNumber: 1,
    bbox: null,
    source: "OCR_AI_AGENT",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
}

/** Every required document declaring the same value for every compared field. */
function agreeingExtractions() {
  return extracted([
    ["Commercial Invoice", "totalQuantity", "500"],
    ["Packing List", "totalQuantity", "500"],
  ]);
}

function lineItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "li_1",
    description: "Stainless Steel Valve",
    htsCode: "8481.80.5090",
    countryOfOrigin: "Germany",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  issueStore = [];
  pgaStore = [];
  nextId = 0;
    ctxMock.mockResolvedValue({
      userId: "u_1",
      accountId: ACCOUNT,
      roleNames: ["ADMIN"],
      permissions: [],
      isPlatformAdmin: false,
    });
});

describe("POST /api/reconcile", () => {
  it("refuses to reconcile without a shipmentId instead of picking an arbitrary shipment", async () => {
    // It used to findFirst() a shipment and write issue rows against it.
    const res = await reconcile.POST(post({}));

    expect(res.status).toBe(400);
    expect(dbMock.shipment.findFirst).not.toHaveBeenCalled();
    expect(dbMock.reconciliationIssue.create).not.toHaveBeenCalled();
  });

  it("does not reconcile another account's shipment", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(null);

    const res = await reconcile.POST(post({ shipmentId: "shp_other" }));

    expect(res.status).toBe(404);
    expect(dbMock.shipment.findFirst.mock.calls[0][0].where.accountId).toBe(ACCOUNT);
  });

  it("blocks a shipment with no bill of lading", async () => {
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List")],
      lineItems: [lineItem()],
      incoterm: null,
    });
    dbMock.extractionField.findMany.mockResolvedValue(agreeingExtractions());

    const body = await (await reconcile.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.reconciliation.status).toBe("BLOCKED");
    const missing = body.reconciliation.issues.find(
      (i: { field: string }) => i.field === "requiredDocuments"
    );
    expect(missing.actualValue).toContain("Bill of Lading");
  });

  it("reports INCOMPLETE, not MATCHED, when the quantity check could not run", async () => {
    // Previously returned status MATCHED and score 100 for a comparison that
    // never happened, because the rule was skipped for want of documents.
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List"), doc("Bill of Lading")],
      lineItems: [lineItem()],
      incoterm: null,
    });
    dbMock.extractionField.findMany.mockResolvedValue([]);

    const body = await (await reconcile.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.reconciliation.status).toBe("INCOMPLETE");
    expect(body.reconciliation.reconciliationScore).toBeNull();
    expect(body.reconciliation.skippedChecks.length).toBeGreaterThan(0);
  });

  it("reports INCOMPLETE when the documents exist but nothing was extracted from them", async () => {
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List"), doc("Bill of Lading")],
      lineItems: [lineItem()],
      incoterm: null,
    });
    dbMock.extractionField.findMany.mockResolvedValue([]);

    const body = await (await reconcile.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.reconciliation.status).toBe("INCOMPLETE");
    expect(body.reconciliation.issuesCount).toBe(0);
  });

  it("never returns MATCHED while any rule was skipped", async () => {
    // Only the quantity rule can run here, so the shipment is not cleared even
    // though nothing disagreed.
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List"), doc("Bill of Lading")],
      lineItems: [lineItem()],
      incoterm: null,
    });
    dbMock.extractionField.findMany.mockResolvedValue(agreeingExtractions());

    const body = await (await reconcile.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.reconciliation.issuesCount).toBe(0);
    expect(body.reconciliation.status).toBe("INCOMPLETE");
    expect(body.reconciliation.reconciliationScore).toBeNull();
  });

  it("raises a warning when invoice and packing list quantities disagree", async () => {
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List"), doc("Bill of Lading")],
      lineItems: [lineItem()],
      incoterm: null,
    });
    dbMock.extractionField.findMany.mockResolvedValue(
      extracted([
        ["Commercial Invoice", "totalQuantity", "500"],
        ["Packing List", "totalQuantity", "480"],
      ])
    );

    const body = await (await reconcile.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.reconciliation.status).toBe("WARNINGS");
    expect(body.reconciliation.issues[0].field).toBe("quantity");
  });

  it("reconciles on a reviewer's correction rather than the model's original reading", async () => {
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List"), doc("Bill of Lading")],
      lineItems: [lineItem()],
      incoterm: null,
    });
    // The extractor misread the packing list; a reviewer corrected it. The
    // correction carries no model confidence, so a confidence-ranked query
    // would have kept the wrong number and reported a mismatch that is closed.
    dbMock.extractionField.findMany.mockResolvedValue([
      ...extracted([["Commercial Invoice", "totalQuantity", "500"]]),
      {
        id: "ef_bad",
        documentId: "Packing List",
        fieldName: "totalQuantity",
        value: "480",
        confidence: 99,
        pageNumber: 1,
        bbox: null,
        source: "OCR_AI_AGENT",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "ef_fixed",
        documentId: "Packing List",
        fieldName: "totalQuantity",
        value: "500",
        confidence: null,
        pageNumber: 1,
        bbox: null,
        source: "HUMAN_CORRECTION",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);

    const body = await (await reconcile.POST(post({ shipmentId: "shp_1" }))).json();

    expect(
      body.reconciliation.issues.some((i: { field: string }) => i.field === "quantity")
    ).toBe(false);
  });

  it("flags conflicting countries of origin without inventing an expected one", async () => {
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List"), doc("Bill of Lading")],
      lineItems: [lineItem(), lineItem({ id: "li_2", countryOfOrigin: "China" })],
      incoterm: null,
    });
    dbMock.extractionField.findMany.mockResolvedValue(agreeingExtractions());

    const body = await (await reconcile.POST(post({ shipmentId: "shp_1" }))).json();

    const country = body.reconciliation.issues.find(
      (i: { field: string }) => i.field === "country"
    );
    expect(country.severity).toBe("Critical");
    // The expected value used to fall back to the literal "Germany".
    expect(country.expectedValue).not.toBe("Germany");
    expect(country.actualValue).toContain("China");
  });

  it("does not append a second copy of the same issue when re-run", async () => {
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List")],
      lineItems: [lineItem()],
      incoterm: null,
    });
    dbMock.extractionField.findMany.mockResolvedValue(agreeingExtractions());

    await reconcile.POST(post({ shipmentId: "shp_1" }));
    const body = await (await reconcile.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.reconciliation.issuesCount).toBe(1);
    expect(issueStore.filter((r) => r.field === "requiredDocuments")).toHaveLength(1);
  });

  it("still reports an unresolved issue raised by an earlier run", async () => {
    // Status and score used to come from the rows created this run alone, so a
    // shipment carrying an open Critical issue reported MATCHED.
    issueStore.push({
      id: "iss_old",
      shipmentId: "shp_1",
      accountId: ACCOUNT,
      field: "totalValue",
      severity: "Critical",
      status: "Open",
      createdAt: new Date(0),
    });
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List"), doc("Bill of Lading")],
      lineItems: [lineItem()],
      incoterm: null,
    });
    dbMock.extractionField.findMany.mockResolvedValue(agreeingExtractions());

    const body = await (await reconcile.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.reconciliation.status).toBe("BLOCKED");
    expect(body.reconciliation.criticalCount).toBe(1);
  });

  it("closes an issue whose rule ran again and found nothing, but not a skipped one", async () => {
    issueStore.push(
      {
        id: "iss_documents",
        shipmentId: "shp_1",
        accountId: ACCOUNT,
        field: "requiredDocuments",
        severity: "Critical",
        status: "Open",
        createdAt: new Date(0),
      },
      {
        id: "iss_quantity",
        shipmentId: "shp_1",
        accountId: ACCOUNT,
        field: "quantity",
        severity: "Warning",
        status: "Open",
        createdAt: new Date(0),
      }
    );
    // Every required document is now attached, but only the invoice declares a
    // quantity, so the quantity rule cannot run and must not close its issue.
    dbMock.shipment.findFirst.mockResolvedValue({
      id: "shp_1",
      documents: [doc("Commercial Invoice"), doc("Packing List"), doc("Bill of Lading")],
      lineItems: [lineItem()],
      incoterm: null,
    });
    dbMock.extractionField.findMany.mockResolvedValue(
      extracted([["Commercial Invoice", "totalQuantity", "500"]])
    );

    await reconcile.POST(post({ shipmentId: "shp_1" }));

    expect(issueStore.find((r) => r.id === "iss_documents")!.status).toBe("Resolved");
    expect(issueStore.find((r) => r.id === "iss_quantity")!.status).toBe("Open");
  });
});

describe("POST /api/pga/screen", () => {
  it("refuses to screen without a shipmentId instead of picking an arbitrary shipment", async () => {
    const res = await pga.POST(post({}));

    expect(res.status).toBe(400);
    expect(dbMock.shipment.findFirst).not.toHaveBeenCalled();
    expect(dbMock.pgaRequirement.createMany).not.toHaveBeenCalled();
  });

  it("does not report 'no filing required' for a shipment with nothing to screen", async () => {
    dbMock.shipmentLineItem.findMany.mockResolvedValue([]);

    const body = await (await pga.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.pgaScreening.requiresPgaFiling).toBeNull();
    expect(body.pgaScreening.notScreenedReason).toBeTruthy();
  });

  it("flags EPA for a valve heading and FCC for a wireless controller", async () => {
    dbMock.shipmentLineItem.findMany.mockResolvedValue([
      lineItem(),
      lineItem({ id: "li_2", description: "Wireless Transmission Controller", htsCode: "8537.10.2030" }),
    ]);

    const body = await (await pga.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.pgaScreening.requiresPgaFiling).toBe(true);
    expect(body.pgaScreening.flaggedAgencies).toContain("EPA");
    expect(body.pgaScreening.flaggedAgencies).toContain("FCC");
  });

  it("does not duplicate a requirement when the shipment is screened again", async () => {
    dbMock.shipmentLineItem.findMany.mockResolvedValue([lineItem()]);

    await pga.POST(post({ shipmentId: "shp_1" }));
    const body = await (await pga.POST(post({ shipmentId: "shp_1" }))).json();

    // Re-screening used to record a second TSCA certification for the same line.
    expect(pgaStore).toHaveLength(1);
    // ...and suppressing the duplicate must not flip the answer to "none required".
    expect(body.pgaScreening.requiresPgaFiling).toBe(true);
    expect(body.pgaScreening.pgaFlagsCount).toBe(1);
  });

  it("withdraws a requirement the rules no longer detect", async () => {
    dbMock.shipmentLineItem.findMany.mockResolvedValue([lineItem()]);
    await pga.POST(post({ shipmentId: "shp_1" }));

    dbMock.shipmentLineItem.findMany.mockResolvedValue([
      lineItem({ description: "Cotton T-Shirt", htsCode: "6109.10.0012" }),
    ]);
    const body = await (await pga.POST(post({ shipmentId: "shp_1" }))).json();

    expect(pgaStore).toHaveLength(0);
    expect(body.pgaScreening.requiresPgaFiling).toBe(false);
  });

  it("declares which agencies it actually screened", async () => {
    dbMock.shipmentLineItem.findMany.mockResolvedValue([
      lineItem({ description: "Cotton T-Shirt", htsCode: "6109.10.0012" }),
    ]);

    const body = await (await pga.POST(post({ shipmentId: "shp_1" }))).json();

    expect(body.pgaScreening.requiresPgaFiling).toBe(false);
    // A false result covers only these three agencies, not every PGA.
    expect(body.pgaScreening.agenciesScreened).toEqual(["FDA", "FCC", "EPA"]);
  });

  it("only screens line items belonging to the caller's account", async () => {
    dbMock.shipmentLineItem.findMany.mockResolvedValue([]);

    await pga.POST(post({ shipmentId: "shp_1" }));

    expect(dbMock.shipmentLineItem.findMany.mock.calls[0][0].where.accountId).toBe(ACCOUNT);
  });
});

describe("POST /api/products/normalize", () => {
  it("requires a raw description", async () => {
    const res = await normalize.POST(post({}));

    expect(res.status).toBe(400);
    expect(dbMock.canonicalProduct.create).not.toHaveBeenCalled();
  });

  it("does not merge a product into an unrelated canonical record", async () => {
    // Matching used to be `contains: canonicalName.split(" ")[0]`, so "Steel Bolt"
    // bound to an existing "Steel Valve" and inherited its HTS code.
    dbMock.productAlias.findFirst.mockResolvedValue(null);
    dbMock.canonicalProduct.findFirst.mockResolvedValue(null);
    dbMock.canonicalProduct.create.mockResolvedValue({ id: "cp_1", canonicalName: "Steel Bolt", aliases: [] });
    dbMock.productAlias.count.mockResolvedValue(1);

    await normalize.POST(post({ rawDescription: "Steel Bolt" }));

    expect(dbMock.canonicalProduct.findFirst.mock.calls[0][0].where.canonicalName).toEqual({
      equals: "Steel Bolt",
      mode: "insensitive",
    });
    expect(dbMock.canonicalProduct.create).toHaveBeenCalled();
  });

  it("reuses the canonical product when the exact alias was seen before", async () => {
    dbMock.productAlias.findFirst.mockResolvedValue({
      canonicalProduct: { id: "cp_1", canonicalName: "Steel Valve", aliases: [{ id: "a1" }] },
    });
    dbMock.productAlias.count.mockResolvedValue(1);

    const body = await (await normalize.POST(post({ rawDescription: "Steel Valve" }))).json();

    expect(body.normalizedProduct.canonicalProductId).toBe("cp_1");
    expect(dbMock.canonicalProduct.create).not.toHaveBeenCalled();
    // The alias already exists, so it must not be duplicated.
    expect(dbMock.productAlias.create).not.toHaveBeenCalled();
  });

  it("reports the real number of aliases rather than always adding one", async () => {
    dbMock.productAlias.findFirst.mockResolvedValue(null);
    dbMock.canonicalProduct.findFirst.mockResolvedValue(null);
    dbMock.canonicalProduct.create.mockResolvedValue({
      id: "cp_1",
      canonicalName: "Steel Bolt",
      aliases: [{ id: "a1" }],
    });
    dbMock.productAlias.count.mockResolvedValue(1);

    const body = await (await normalize.POST(post({ rawDescription: "Steel Bolt" }))).json();

    expect(body.normalizedProduct.aliasesCount).toBe(1);
  });

  it("scopes the alias lookup to the caller's account", async () => {
    dbMock.productAlias.findFirst.mockResolvedValue(null);
    dbMock.canonicalProduct.findFirst.mockResolvedValue(null);
    dbMock.canonicalProduct.create.mockResolvedValue({ id: "cp_1", canonicalName: "X", aliases: [] });
    dbMock.productAlias.count.mockResolvedValue(1);

    await normalize.POST(post({ rawDescription: "Steel Bolt" }));

    expect(dbMock.productAlias.findFirst.mock.calls[0][0].where.canonicalProduct.accountId).toBe(ACCOUNT);
    expect(dbMock.canonicalProduct.create.mock.calls[0][0].data.accountId).toBe(ACCOUNT);
  });
});
