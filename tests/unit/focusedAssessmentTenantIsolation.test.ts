import { describe, it, expect, vi } from "vitest";
import { assembleFocusedAssessmentFile } from "../../src/lib/audit/focusedAssessment";
import { db } from "../../src/lib/db";

vi.mock("../../src/lib/db", () => {
  return {
    db: {
      customsFiling: {
        findMany: vi.fn(),
      },
      controlEvidence: {
        findMany: vi.fn(),
      },
      exceptionItem: {
        findMany: vi.fn(),
      },
      importerOfRecord: {
        findFirst: vi.fn(),
      },
    },
  };
});

describe("Focused Assessment — tenant isolation", () => {
  it("never resolves an importerOfRecordId belonging to another account", async () => {
    vi.mocked(db.customsFiling.findMany).mockResolvedValue([]);
    vi.mocked(db.controlEvidence.findMany).mockResolvedValue([]);
    vi.mocked(db.exceptionItem.findMany).mockResolvedValue([]);

    // Simulate real Prisma behavior: an importer owned by acc_A is invisible
    // to a query scoped to acc_B, even when the id matches.
    vi.mocked(db.importerOfRecord.findFirst).mockImplementation((async (args: any) => {
      if (args.where.id === "importer_1" && args.where.accountId === "acc_A") {
        return { id: "importer_1", name: "Acme Corp (Tenant A)", cbpImporterNumber: "CBP-A", address: {} } as any;
      }
      return null;
    }) as any);

    const file = await assembleFocusedAssessmentFile("acc_B", {
      importerOfRecordId: "importer_1",
      periodFrom: "2026-01-01",
      periodTo: "2026-02-01",
    });

    expect(db.importerOfRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "importer_1", accountId: "acc_B" }) })
    );
    // Cross-tenant lookup must fail closed, never leak Tenant A's importer identity.
    expect(file.importer.name).not.toBe("Acme Corp (Tenant A)");
    expect(file.importer.name).toBe("Unspecified Importer");
  });

  it("resolves the importer when it belongs to the requesting account", async () => {
    vi.mocked(db.customsFiling.findMany).mockResolvedValue([]);
    vi.mocked(db.controlEvidence.findMany).mockResolvedValue([]);
    vi.mocked(db.exceptionItem.findMany).mockResolvedValue([]);
    vi.mocked(db.importerOfRecord.findFirst).mockResolvedValue({
      id: "importer_1",
      name: "Acme Corp (Tenant A)",
      cbpImporterNumber: "CBP-A",
      address: {},
    } as any);

    const file = await assembleFocusedAssessmentFile("acc_A", {
      importerOfRecordId: "importer_1",
      periodFrom: "2026-01-01",
      periodTo: "2026-02-01",
    });

    expect(file.importer.name).toBe("Acme Corp (Tenant A)");
  });
});
