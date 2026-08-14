import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbMock } = vi.hoisted(() => {
  return {
    dbMock: {
      ruling: {
        findUnique: vi.fn(),
      },
      regulatoryUpdate: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      accountMembership: {
        findMany: vi.fn(),
      },
      notification: {
        create: vi.fn(),
      },
      customsFiling: {
        findMany: vi.fn(),
      },
      refundOpportunity: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

vi.mock("../src/lib/db", () => ({
  db: dbMock,
}));

// Mock the Gemini API meter/call to avoid network/api issues
vi.mock("../src/lib/ai/aiMeter", () => ({
  meterGeminiCall: vi.fn(),
}));

import { CrossIngestionService } from "../src/modules/regulatory/crossIngestionService";
import { POST } from "../src/app/api/cron/regulatory-ingest/route";

describe("Phase 4 Regulatory Intelligence & Ingestion Test Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "dev-cron-secret";
    dbMock.customsFiling.findMany.mockResolvedValue([]);
  });

  const cronHeaders = { authorization: "Bearer dev-cron-secret" };

  describe("Anti-Hallucination Citation Verification", () => {
    it("rejects non-existent unverified ruling numbers to prevent AI hallucinated citations", async () => {
      dbMock.ruling.findUnique.mockResolvedValue(null);

      const verification = await CrossIngestionService.verifyCitation("HQ999999999_FAKE");
      expect(verification.verified).toBe(false);
      expect(verification.reason).toContain("Zero-hallucination policy enforced");
    });
  });

  describe("Federal Register Parsing and Ingestion", () => {
    it("correctly parses FR API results and creates RegulatoryUpdate records", async () => {
      const mockDocument = {
        document_number: "2026-9999",
        title: "Revised Customs Duties on Certain Electronics HTSUS 8541.43.0010",
        abstract: "CBP announces tariff rate revision under 8541.43.0010",
        publication_date: "2026-08-10T00:00:00.000Z",
        pdf_url: "https://www.federalregister.gov/documents/2026-9999.pdf",
      };

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ results: [mockDocument] }),
      } as any);

      dbMock.regulatoryUpdate.findUnique.mockResolvedValue(null);
      dbMock.regulatoryUpdate.create.mockResolvedValue({
        id: "update-9999",
        documentNumber: "2026-9999",
        title: mockDocument.title,
        status: "Action Required",
      } as any);

      dbMock.accountMembership.findMany.mockResolvedValue([]);

      const request = new Request("http://localhost/api/cron/regulatory-ingest", {
        method: "POST",
        headers: cronHeaders,
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("COMPLETE");
      expect(body.ingestedCount).toBe(1);

      expect(dbMock.regulatoryUpdate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentNumber: "2026-9999",
          title: mockDocument.title,
          publishedText: mockDocument.pdf_url,
          status: "Action Required",
          metadata: expect.objectContaining({
            type: "TARIFF_RATE_CHANGE",
            actionRequired: true,
            affectedHtsCodes: ["8541.43.0010"],
          }),
        }),
      });
    });

    it("handles idempotency by skipping duplicate document numbers", async () => {
      const mockDocument = {
        document_number: "2026-EXISTING",
        title: "Duplicate Notice",
        abstract: "Already ingested document",
        publication_date: new Date().toISOString(),
      };

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ results: [mockDocument] }),
      } as any);

      dbMock.regulatoryUpdate.findUnique.mockResolvedValue({
        id: "update-existing",
        documentNumber: "2026-EXISTING",
      } as any);

      const request = new Request("http://localhost/api/cron/regulatory-ingest", {
        method: "POST",
        headers: cronHeaders,
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ingestedCount).toBe(0);
      expect(dbMock.regulatoryUpdate.create).not.toHaveBeenCalled();
    });

    it("returns an honest 502 error when Federal Register API fetch fails (no mock fallback)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 503,
      } as any);

      const request = new Request("http://localhost/api/cron/regulatory-ingest", {
        method: "POST",
        headers: cronHeaders,
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.error).toContain("Federal Register API fetch failed");
      expect(dbMock.regulatoryUpdate.create).not.toHaveBeenCalled();
    });
  });

  describe("Regulatory Ingest Notifications", () => {
    it("filters account memberships by regulatory.review permission and optionally accountId", async () => {
      const mockDocument = {
        document_number: "2026-test-doc",
        title: "Extension of Section 301 Exclusion",
        abstract: "CBP announces exclusion extension",
        publication_date: new Date().toISOString(),
        pdf_url: "https://example.com/pdf",
      };

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ results: [mockDocument] }),
      } as any);

      dbMock.regulatoryUpdate.findUnique.mockResolvedValue(null);
      dbMock.regulatoryUpdate.create.mockResolvedValue({
        id: "update-123",
        title: mockDocument.title,
      } as any);

      dbMock.accountMembership.findMany.mockResolvedValue([
        { id: "mem-1", accountId: "acc-abc", userId: "user-123" },
      ] as any);

      dbMock.notification.create.mockResolvedValue({} as any);

      const request = new Request("http://localhost/api/cron/regulatory-ingest?accountId=acc-abc", {
        method: "POST",
        headers: cronHeaders,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      expect(dbMock.accountMembership.findMany).toHaveBeenCalledWith({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          accountId: "acc-abc",
          roles: {
            some: {
              role: {
                OR: [
                  { name: { in: ["OWNER", "ADMIN"] } },
                  {
                    rolePermissions: {
                      some: {
                        permission: {
                          name: "regulatory.review",
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      });

      expect(dbMock.notification.create).toHaveBeenCalledWith({
        data: {
          accountId: "acc-abc",
          userId: "user-123",
          message: expect.stringContaining("Regulatory Action Required: Extension of Section 301 Exclusion"),
          type: "regulatory_alert",
        },
      });
    });
  });
});
