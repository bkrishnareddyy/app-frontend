import { describe, it, expect, vi, beforeEach } from "vitest";

// CROSS rulings are the authority the classification agents cite. Ingestion used
// to fill in the issuing office, the ruling type and the source URL when the
// caller omitted them, so the "verified" index carried invented provenance.

const dbMock = {
  ruling: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({ createAuditLog: vi.fn() }));

const { CrossIngestionService } = await import("@/modules/regulatory/crossIngestionService");

const VALID = {
  rulingNumber: "N302145",
  issuedAt: new Date("2019-02-11"),
  title: "Classification of a steel flange",
  rulingType: "NY",
  htsCodes: ["7307.91.5010"],
  fragments: [{ fragmentType: "Holding", text: "Classified under 7307.91.5010." }],
};

/** The `create` branch Prisma was asked to write. */
function created() {
  return dbMock.ruling.upsert.mock.calls[0][0].create;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.ruling.upsert.mockResolvedValue({ id: "rul_1" });
});

describe("CrossIngestionService.ingestRuling: provenance", () => {
  it("rejects a ruling type outside HQ and NY", async () => {
    await expect(
      CrossIngestionService.ingestRuling({ ...VALID, rulingType: "CBP" })
    ).rejects.toThrow(/rulingType/);

    expect(dbMock.ruling.upsert).not.toHaveBeenCalled();
  });

  it("does not file a New York ruling as an HQ ruling", async () => {
    await CrossIngestionService.ingestRuling(VALID);

    expect(created().rulingType).toBe("NY");
  });

  it("leaves the issuing office null rather than assuming HQ", async () => {
    await CrossIngestionService.ingestRuling(VALID);

    expect(created().office).toBeNull();
  });

  it("records a supplied office unchanged", async () => {
    await CrossIngestionService.ingestRuling({ ...VALID, office: "NIS 106" });

    expect(created().office).toBe("NIS 106");
  });

  it("does not construct a cbp.gov source URL nobody fetched", async () => {
    await CrossIngestionService.ingestRuling(VALID);

    expect(created().sourceUrl).toBeNull();
  });

  it("records a supplied source URL unchanged", async () => {
    const sourceUrl = "https://rulings.cbp.gov/ruling/N302145";

    await CrossIngestionService.ingestRuling({ ...VALID, sourceUrl });

    expect(created().sourceUrl).toBe(sourceUrl);
  });
});
