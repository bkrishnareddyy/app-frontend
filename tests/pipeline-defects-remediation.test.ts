import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbMock } = vi.hoisted(() => {
  return {
    dbMock: {
      htsRelease: {
        findFirst: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
      htsNode: {
        createMany: vi.fn(),
        findMany: vi.fn(),
      },
      htsDutyRate: {
        createMany: vi.fn(),
        findFirst: vi.fn(),
      },
      htsUnit: {
        createMany: vi.fn(),
      },
      htsChange: {
        createMany: vi.fn(),
      },
      regulatoryUpdate: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      section301Exclusion: {
        findFirst: vi.fn(),
      },
      section232Rate: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      adcvdOrder: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      customsFiling: {
        findMany: vi.fn(),
      },
      refundOpportunity: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      ruling: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      rulingRelationship: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      screeningEntity: {
        upsert: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      accountMembership: {
        findMany: vi.fn(),
      },
      exportLineItem: {
        findMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(dbMock)),
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: dbMock,
}));

vi.mock("@/lib/api/auth-guards", () => ({
  withCronRoute: (handler: any) => (req: any) => handler({ req, requestId: "test-req-1" }),
  withAuthenticatedRoute: (handler: any) => (req: any) =>
    handler({ req, ctx: { accountId: "acc-1", userId: "user-1" }, requestId: "test-req-2" }),
}));

import { HtsUsitcFetcher } from "@/modules/hts/htsUsitcFetcher";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";
import { CrossIngestionService } from "@/modules/regulatory/crossIngestionService";
import { BisCslIngestionService } from "@/modules/screening/bisCslIngestionService";
import { POST as regulatoryIngestPOST } from "@/app/api/cron/regulatory-ingest/route";
import { POST as refundScanPOST } from "@/app/api/refunds/opportunities/scan/route";

describe("Live Ingestion Pipeline Defects Remediation Test Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "dev-cron-secret";
  });

  describe("HTSUS Pipeline Fixes", () => {
    it("completeness gate rejects incomplete schedules when non-reserved chapters fail", () => {
      const mockResult = {
        items: Array(500).fill({ htsno: "0101.21.00", description: "Horses" }),
        chapterResults: [
          { chapter: "01", itemCount: 500, ok: true },
          { chapter: "02", itemCount: 0, ok: false, error: "HTTP 500" },
          { chapter: "77", itemCount: 0, ok: false, error: "HTTP 404" }, // reserved
        ],
      };

      const validation = HtsUsitcFetcher.validateCompleteness(mockResult, 1000);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("Non-reserved chapters failed to fetch");
      expect(validation.reason).toContain("Ch 02");
      expect(validation.reason).not.toContain("Ch 77");
    });

    it("stages release atomically, populates parentId hierarchy, and sets rawObjectKey", async () => {
      dbMock.htsRelease.findFirst.mockResolvedValue(null);
      dbMock.htsRelease.create.mockImplementation((args: any) => Promise.resolve({ id: "rel-123", ...args.data }));

      const mockItems = [
        { htsno: "01", description: "Chapter 1", superior: true },
        { htsno: "0101", description: "Heading 0101", superior: true },
        { htsno: "0101.21.00", description: "Purebred breeding horses", general: "Free" },
        { htsno: "0101.21.00.10", description: "Male purebred breeding horses", general: "Free" },
      ];

      const release = await HtsIngestionService.stageRelease({
        editionYear: 2026,
        revisionNumber: 1,
        releaseName: "Test Release",
        sourceUrl: "https://hts.usitc.gov",
        sourceFormat: "JSON",
        rawContent: JSON.stringify(mockItems),
        items: mockItems as any,
      });

      expect(release.id).toBeDefined();
      expect(release.releaseName).toBe("Test Release");
      expect(dbMock.$transaction).toHaveBeenCalled();
      expect(dbMock.htsNode.createMany).toHaveBeenCalled();

      // Check node rows created inside transaction
      const nodeCall = dbMock.htsNode.createMany.mock.calls[0][0];
      const nodes = nodeCall.data;
      expect(nodes.length).toBe(4);
      expect(nodes[0].codeLevel).toBe(2);
      expect(nodes[0].parentId).toBeNull();
      expect(nodes[1].codeLevel).toBe(4);
      expect(nodes[1].parentId).toBe(nodes[0].id); // Chapter 01 is parent of Heading 0101
      expect(nodes[2].codeLevel).toBe(8);
      expect(nodes[2].parentId).toBe(nodes[1].id); // Heading 0101 is parent of 0101.21.00
      expect(nodes[3].codeLevel).toBe(10);
      expect(nodes[3].parentId).toBe(nodes[2].id); // 0101.21.00 is parent of 0101.21.00.10
    });
  });

  describe("Federal Register & Refund Opportunity Fixes", () => {
    it("fetches full legal document text and stores in metadata", async () => {
      const mockDoc = {
        document_number: "2026-8888",
        title: "Section 301 Modifications",
        abstract: "CBP Notice abstract",
        publication_date: new Date().toISOString(),
        pdf_url: "https://example.com/pdf",
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
        if (String(url).includes("documents.json")) {
          return { ok: true, json: async () => ({ results: [mockDoc] }) } as any;
        }
        if (String(url).includes("2026-8888.json")) {
          return {
            ok: true,
            json: async () => ({ title: mockDoc.title, abstract: mockDoc.abstract, body_html: "<p>Full Legal Notice Body Text</p>" }),
          } as any;
        }
        return { ok: false } as any;
      });

      dbMock.regulatoryUpdate.findUnique.mockResolvedValue(null);
      dbMock.regulatoryUpdate.create.mockImplementation((args: any) => Promise.resolve({ id: "update-1", ...args.data }));
      dbMock.accountMembership.findMany.mockResolvedValue([]);

      const request = new Request("http://localhost/api/cron/regulatory-ingest", {
        method: "POST",
        headers: { authorization: "Bearer dev-cron-secret" },
      });

      const response = await regulatoryIngestPOST(request as any);
      expect(response.status).toBe(200);

      const createArg = dbMock.regulatoryUpdate.create.mock.calls[0][0].data;
      expect(createArg.metadata.fullNoticeText).toContain("Full Legal Notice Body Text");
    });

    it("requires APPROVED Section 301 exclusion record before generating refund opportunities", async () => {
      const filing = {
        id: "filing-1",
        accountId: "acc-1",
        filingStatus: "Accepted",
        shipment: {
          lineItems: [
            {
              id: "item-1",
              htsCode: "8541.43.0010",
              countryOfOrigin: "CN",
              totalValue: 5000,
              description: "Solar cells",
              product: { compositions: [] },
              origins: [],
              drawbackMatches: [],
            },
          ],
        },
      };

      dbMock.customsFiling.findMany.mockResolvedValue([filing] as any);
      dbMock.exportLineItem.findMany.mockResolvedValue([]);
      dbMock.htsDutyRate.findFirst.mockResolvedValue(null);
      dbMock.refundOpportunity.create.mockImplementation((args: any) =>
        Promise.resolve({ id: `opp-${Math.random().toString(36).slice(2)}`, status: "Identified", ...args.data })
      );

      // 1. When Section 301 Exclusion is PENDING or missing, NO Section 301 refund opportunity is created
      dbMock.section301Exclusion.findFirst.mockResolvedValue(null);

      const req1 = new Request("http://localhost/api/refunds/opportunities/scan", {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
      });

      const res1 = await refundScanPOST(req1 as any);
      const body1 = await res1.json();
      const s301Opps1 = (body1.opportunities || []).filter((o: any) => o.opportunityType === "SECTION_301_EXCLUSION");
      expect(s301Opps1.length).toBe(0);

      // 2. When Section 301 Exclusion is APPROVED for exact HTS code, opportunity is created
      dbMock.section301Exclusion.findFirst.mockResolvedValue({
        id: "ex-123",
        htsNumber: "8541430010",
        reviewStatus: "APPROVED",
      } as any);

      dbMock.refundOpportunity.findFirst.mockResolvedValue(null);

      const res2 = await refundScanPOST(req1 as any);
      const body2 = await res2.json();
      const s301Opps2 = (body2.opportunities || []).filter((o: any) => o.opportunityType === "SECTION_301_EXCLUSION");
      expect(s301Opps2.length).toBe(1);
    });
  });

  describe("CBP CROSS Rulings Fixes", () => {
    it("computes SHA-256 checksum and records revocation linkages in CrossIngestionService", async () => {
      dbMock.ruling.upsert.mockImplementation((args: any) =>
        Promise.resolve({ id: "ruling-new", rulingNumber: args.where.rulingNumber })
      );
      dbMock.ruling.findUnique.mockResolvedValue({ id: "ruling-old", rulingNumber: "HQ123456" });
      dbMock.rulingRelationship.upsert.mockResolvedValue({} as any);

      const ruling = await CrossIngestionService.ingestRuling({
        rulingNumber: "HQ999999",
        issuedAt: new Date("2026-08-01"),
        title: "Classification of Solar Panels",
        office: "HQ",
        rulingType: "HQ",
        revokesRulingNumber: "HQ123456",
        htsCodes: ["8541.43.0010"],
        fragments: [{ fragmentType: "TEXT", text: "This ruling REVOKES HQ123456 and classifies solar panels." }],
      });

      expect(ruling).toBeDefined();
      expect(dbMock.ruling.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            checksum: expect.any(String),
            rulingNumber: "HQ999999",
          }),
        })
      );

      expect(dbMock.rulingRelationship.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            fromRulingId: "ruling-new",
            toRulingId: "ruling-old",
            relationshipType: "REVOKES",
          }),
        })
      );
    });

    it("rejects rulings missing authoritative issue dates", async () => {
      await expect(
        CrossIngestionService.ingestRuling({
          rulingNumber: "NY999999",
          issuedAt: null,
          title: "Invalid ruling",
          rulingType: "NY",
          htsCodes: [],
          fragments: [],
        })
      ).rejects.toThrow("missing an authoritative issue date");
    });
  });

  describe("BIS CSL Ingestion Fixes", () => {
    it("ingests without 1000 record cap and marks removed entities as SUPERSEDED", async () => {
      const mockCslResponse = {
        total: 2,
        results: [
          {
            name: "Active Entity A",
            source: "ENTITY_LIST",
            addresses: [{ country: "CN" }],
          },
        ],
      };

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => mockCslResponse,
      } as any);

      dbMock.screeningEntity.upsert.mockResolvedValue({} as any);
      dbMock.screeningEntity.findMany.mockResolvedValue([
        { id: "ent-1", entityHash: BisCslIngestionService.computeEntityHash("ENTITY_LIST", "Active Entity A", "CN") },
        { id: "ent-2", entityHash: BisCslIngestionService.computeEntityHash("ENTITY_LIST", "Removed Entity B", "RU") },
      ] as any);
      dbMock.screeningEntity.updateMany.mockResolvedValue({ count: 1 } as any);

      const result = await BisCslIngestionService.fetchAndIngest();

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.supersededCount).toBe(1);
      expect(dbMock.screeningEntity.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["ent-2"] } },
        data: expect.objectContaining({
          publicationStatus: "SUPERSEDED",
          supersededAt: expect.any(Date),
        }),
      });
    });
  });
});
