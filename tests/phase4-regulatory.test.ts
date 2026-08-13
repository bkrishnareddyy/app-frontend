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
    }
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
  });

  describe("Anti-Hallucination Citation Verification", () => {
    it("rejects non-existent unverified ruling numbers to prevent AI hallucinated citations", async () => {
      dbMock.ruling.findUnique.mockResolvedValue(null);

      const verification = await CrossIngestionService.verifyCitation("HQ999999999_FAKE");
      expect(verification.verified).toBe(false);
      expect(verification.reason).toContain("Zero-hallucination policy enforced");
    });
  });

  describe("Regulatory Ingest Cron Notifications", () => {
    it("filters account memberships by regulatory.review permission and optionally accountId", async () => {
      // Stub fetch to return a mock Federal Register response that triggers heuristic fallback
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

      // Mock DB calls
      dbMock.regulatoryUpdate.findUnique.mockResolvedValue(null);
      dbMock.regulatoryUpdate.create.mockResolvedValue({
        id: "update-123",
        title: mockDocument.title,
      } as any);

      dbMock.accountMembership.findMany.mockResolvedValue([
        { id: "mem-1", accountId: "acc-abc", userId: "user-123" },
      ] as any);

      dbMock.notification.create.mockResolvedValue({} as any);

      // Call POST with accountId query parameter
      const request = new Request("http://localhost/api/cron/regulatory-ingest?accountId=acc-abc", {
        method: "POST",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // Verify database query to find memberships was scoped with the correct filters
      expect(dbMock.accountMembership.findMany).toHaveBeenCalledWith({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          accountId: "acc-abc",
          roles: {
            some: {
              role: {
                rolePermissions: {
                  some: {
                    permission: {
                      name: "regulatory.review",
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Verify notification was created
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
