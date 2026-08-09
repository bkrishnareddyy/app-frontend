import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A correction must never overwrite what the extractor read. These tests pin
 * that down: the route inserts, it does not update, and it refuses corrections
 * for fields or documents the caller has no claim on.
 */

const ctxMock = vi.fn();
const auditMock = vi.fn();

const dbMock = {
  shipmentDocument: { findFirst: vi.fn() },
  extractionField: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: async () => true,
}));
vi.mock("@/lib/audit", () => ({ createAuditLog: (p: unknown) => auditMock(p) }));

const fieldsRoute = await import("@/app/api/documents/[id]/extractions/fields/route");

const ACCOUNT = "acc_1";
const DOCUMENT = "doc_1";

function context(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u_1",
    accountId: ACCOUNT,
    firstName: "Jane",
    lastName: "Broker",
    roleNames: ["ADMIN"],
    isPlatformAdmin: false,
    ...overrides,
  };
}

function call(body: unknown, id = DOCUMENT) {
  return fieldsRoute.POST(
    new Request(`http://localhost/api/documents/${id}/extractions/fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

const ORIGINAL = {
  id: "ef_1",
  documentId: DOCUMENT,
  fieldName: "currency",
  value: "US",
  confidence: 55,
  pageNumber: 2,
  bbox: { x: 10, y: 20, width: 30, height: 40 },
  source: "OCR_AI_AGENT",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  ctxMock.mockResolvedValue(context());
  dbMock.shipmentDocument.findFirst.mockResolvedValue({
    id: DOCUMENT,
    shipmentId: "shp_1",
  });
  dbMock.extractionField.findMany.mockResolvedValue([ORIGINAL]);
  dbMock.extractionField.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "ef_2",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      ...data,
    })
  );
});

describe("POST /api/documents/[id]/extractions/fields", () => {
  it("rejects an unauthenticated caller without reading the document", async () => {
    ctxMock.mockResolvedValue(null);

    const res = await call({ fieldName: "currency", value: "USD" });

    expect(res.status).toBe(401);
    expect(dbMock.shipmentDocument.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a read-only role", async () => {
    ctxMock.mockResolvedValue(context({ roleNames: ["VIEWER"] }));

    const res = await call({ fieldName: "currency", value: "USD" });

    expect(res.status).toBe(403);
    expect(dbMock.extractionField.create).not.toHaveBeenCalled();
  });

  it("scopes the document lookup to the caller's account", async () => {
    dbMock.shipmentDocument.findFirst.mockResolvedValue(null);

    const res = await call({ fieldName: "currency", value: "USD" });

    expect(res.status).toBe(404);
    expect(dbMock.shipmentDocument.findFirst.mock.calls[0][0].where).toEqual({
      id: DOCUMENT,
      accountId: ACCOUNT,
    });
    expect(dbMock.extractionField.create).not.toHaveBeenCalled();
  });

  it("refuses to invent a field that was never extracted", async () => {
    dbMock.extractionField.findMany.mockResolvedValue([]);

    const res = await call({ fieldName: "notAField", value: "x" });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "FIELD_NOT_EXTRACTED" } });
    expect(dbMock.extractionField.create).not.toHaveBeenCalled();
  });

  it("requires a field name", async () => {
    const res = await call({ value: "USD" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "FIELD_NAME_REQUIRED" } });
  });

  it("rejects an empty correction", async () => {
    const res = await call({ fieldName: "currency", value: "   " });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_CORRECTION" } });
    expect(dbMock.extractionField.create).not.toHaveBeenCalled();
  });

  it("rejects a correction identical to the current reading", async () => {
    const res = await call({ fieldName: "currency", value: "US" });

    expect(res.status).toBe(400);
    expect(dbMock.extractionField.create).not.toHaveBeenCalled();
  });

  it("inserts the correction and never updates the original row", async () => {
    const res = await call({ fieldName: "currency", value: " USD " });

    expect(res.status).toBe(200);
    expect(dbMock.extractionField.update).not.toHaveBeenCalled();

    const data = dbMock.extractionField.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      documentId: DOCUMENT,
      fieldName: "currency",
      value: "USD",
      source: "HUMAN_CORRECTION",
      // A reviewed value is not a model prediction.
      confidence: null,
      // Provenance is inherited from the machine reading.
      pageNumber: 2,
      bbox: { x: 10, y: 20, width: 30, height: 40 },
    });
  });

  it("returns the field with the correction in force and the original retained", async () => {
    const res = await call({ fieldName: "currency", value: "USD" });
    const body = await res.json();

    expect(body.field).toMatchObject({
      fieldName: "currency",
      currentValue: "USD",
      originalValue: "US",
      corrected: true,
      needsReview: false,
      confidence: 55,
    });
    expect(body.field.history).toHaveLength(2);
  });

  it("records the correction in the audit trail with both readings", async () => {
    await call({ fieldName: "currency", value: "USD" });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT,
        userId: "u_1",
        action: "EXTRACTION_FIELD_CORRECTED",
        entity: "ExtractionField",
        beforeJson: { value: "US", confidence: 55 },
        afterJson: { value: "USD", source: "HUMAN_CORRECTION" },
      })
    );
  });

  it("accepts \"0\" as a corrected value", async () => {
    dbMock.extractionField.findMany.mockResolvedValue([
      { ...ORIGINAL, fieldName: "quantity", value: "10" },
    ]);

    const res = await call({ fieldName: "quantity", value: "0" });

    expect(res.status).toBe(200);
    expect(dbMock.extractionField.create.mock.calls[0][0].data.value).toBe("0");
  });
});
