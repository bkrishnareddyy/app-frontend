import { describe, it, expect, vi, beforeEach } from "vitest";
import { diff } from "../../src/lib/audit/diffHelper";
import { assembleReasonableCarePackage } from "../../src/lib/audit/reasonableCarePackage";
import { computeAnalyticsMetrics } from "../../src/lib/analytics/metricComputer";
import { db } from "../../src/lib/db";

// Mock the prisma database client
vi.mock("../../src/lib/db", () => {
  return {
    db: {
      shipment: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      customsFiling: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      exceptionItem: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      extractionField: {
        findMany: vi.fn(),
      },
      postSummaryCorrection: {
        count: vi.fn(),
      },
      controlEvidence: {
        findMany: vi.fn(),
      },
    },
  };
});

describe("Capability A — Redacted Diff Capture Tests", () => {
  it("computes previous and new values for changed fields, redacting secrets", () => {
    const before = {
      id: "1",
      description: "Old description",
      password: "secret_password_123",
      token: "raw_token_xyz",
    };

    const after = {
      id: "1",
      description: "New description",
      password: "new_password_456",
      token: "new_token_abc",
    };

    const changes = diff(before, after);

    expect(changes.description).toEqual({
      previousValue: "Old description",
      newValue: "New description",
    });

    // Excluded secret/password/token fields should be redacted or excluded
    expect(changes.password).toEqual({
      previousValue: "[REDACTED]",
      newValue: "[REDACTED]",
    });

    expect(changes.token).toEqual({
      previousValue: "[REDACTED]",
      newValue: "[REDACTED]",
    });
  });

  it("handles missing entity or no-change gracefully", () => {
    const changes = diff(null, null);
    expect(changes).toEqual({});
  });
});

describe("Capability B — Reasonable Care Package Assembly Tests", () => {
  it("calculates completeness score based on filled/missing sections", async () => {
    const mockShipment = {
      id: "ship_1",
      shipmentNumber: "SHP-001",
      importerName: "Test Importer",
      createdAt: new Date(),
      lineItems: [
        {
          lineNumber: 1,
          htsCode: "8471.30.0100",
          description: "Laptop computer",
          totalValue: 5000,
          countryOfOrigin: "CN",
          origins: [],
        },
      ],
      documents: [{ id: "doc_1", fileName: "invoice.pdf", docType: "Commercial Invoice", checksum: "hash123" }],
      customsFilings: [{ id: "filing_1", entryNumber: "ENT-12345" }],
      exceptionItems: [],
      agentDecisions: [],
    };

    vi.mocked(db.shipment.findFirst).mockResolvedValue(mockShipment as any);

    const pkg = await assembleReasonableCarePackage("acc_1", "ship_1");
    expect(pkg).not.toBeNull();
    expect(pkg!.completenessScore).toBeGreaterThan(0);
    expect(pkg!.sections.classification[0].htsCode).toBe("8471.30.0100");
    expect(pkg!.sections.documents[0].fileName).toBe("invoice.pdf");
  });

  it("scopes the shipment lookup to accountId, preventing cross-tenant access", async () => {
    vi.mocked(db.shipment.findFirst).mockImplementation((async (args: any) => {
      // Simulate real Prisma behavior: a shipment owned by acc_A is invisible
      // to a query scoped to acc_B, even when the shipment id matches.
      if (args.where.id === "ship_1" && args.where.accountId === "acc_A") {
        return { id: "ship_1", accountId: "acc_A" } as any;
      }
      return null;
    }) as any);

    const crossTenantPkg = await assembleReasonableCarePackage("acc_B", "ship_1");
    expect(crossTenantPkg).toBeNull();

    expect(db.shipment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "ship_1", accountId: "acc_B" }) })
    );
  });
});

describe("Capability C — Audit Population Analytics Tests", () => {
  it("computes touch rate correctly from extraction field modifications", async () => {
    const mockFields = [
      { id: "f1", source: "HUMAN_CORRECTION", document: { shipmentId: "ship_1" } },
      { id: "f2", source: "OCR_AI_AGENT", document: { shipmentId: "ship_1" } },
      { id: "f3", source: "OCR_AI_AGENT", document: { shipmentId: "ship_1" } },
      { id: "f4", source: "OCR_AI_AGENT", document: { shipmentId: "ship_1" } },
    ];

    vi.mocked(db.extractionField.findMany).mockResolvedValue(mockFields as any);
    vi.mocked(db.customsFiling.findMany).mockResolvedValue([]);
    vi.mocked(db.exceptionItem.findMany).mockResolvedValue([]);
    vi.mocked(db.postSummaryCorrection.count).mockResolvedValue(0);

    const metrics = await computeAnalyticsMetrics("acc_1");
    // 1 Human touch field out of 4 total fields = 25% touch rate
    expect(metrics.touchRate).toBe(25);
  });
});
