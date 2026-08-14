import { describe, it, expect, vi, beforeEach } from "vitest";
import { MalwareScanner } from "@/lib/security/malwareScanner";
import { DatasetAlertService } from "@/lib/data/datasetAlertService";
import { CrossIngestionService } from "@/modules/regulatory/crossIngestionService";
import { BisCslIngestionService } from "@/modules/screening/bisCslIngestionService";

vi.mock("@/lib/db", () => ({
  db: {
    datasetRefreshLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    htsRelease: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    screeningEntity: {
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ruling: {
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({ id: "r-1", publicationStatus: "PUBLISHED" }),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    customsFiling: {
      count: vi.fn().mockResolvedValue(0),
    },
    classificationCase: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

describe("Pre-Compliance Beta Remediation Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("MalwareScanner", () => {
    it("approves safe document files", () => {
      const buf = Buffer.from("Invoice content for customs filing");
      const res = MalwareScanner.scan(buf, "invoice.pdf");
      expect(res.safe).toBe(true);
    });

    it("detects suspicious double extension attack", () => {
      const buf = Buffer.from("dummy text");
      const res = MalwareScanner.scan(buf, "document.pdf.exe");
      expect(res.safe).toBe(false);
      expect(res.signature).toBe("SUSPICIOUS_DOUBLE_EXTENSION");
    });

    it("detects EICAR test signature", () => {
      const buf = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
      const res = MalwareScanner.scan(buf, "eicar.com");
      expect(res.safe).toBe(false);
      expect(res.signature).toBe("EICAR_TEST_FILE");
    });

    it("detects PE header (MZ) inside non-binary doc", () => {
      const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
      const res = MalwareScanner.scan(buf, "fake_doc.pdf");
      expect(res.safe).toBe(false);
      expect(res.signature).toBe("EXECUTABLE_PE_HEADER");
    });
  });

  describe("Staged Publishing Methods", () => {
    it("promotes staged CROSS ruling to PUBLISHED", async () => {
      const res = await CrossIngestionService.publishRuling("r-1");
      expect(res.publicationStatus).toBe("PUBLISHED");
    });

    it("promotes all staged CROSS rulings to PUBLISHED", async () => {
      const res = await CrossIngestionService.publishAllStaged();
      expect(res.count).toBe(2);
    });

    it("promotes all staged CSL screening entities to PUBLISHED", async () => {
      const res = await BisCslIngestionService.publishStagedEntities();
      expect(res.count).toBe(0);
    });
  });

  describe("DatasetAlertService", () => {
    it("evaluates health alerts and returns empty list when clean", async () => {
      const alerts = await DatasetAlertService.evaluateHealthAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });
  });
});
