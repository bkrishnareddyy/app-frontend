import { describe, it, expect } from "vitest";
import { CrossIngestionService } from "../src/modules/regulatory/crossIngestionService";

describe("Phase 4 Regulatory Intelligence & CROSS Verification Test Suite", () => {
  describe("Anti-Hallucination Citation Verification", () => {
    it("rejects non-existent unverified ruling numbers to prevent AI hallucinated citations", async () => {
      const verification = await CrossIngestionService.verifyCitation("HQ999999999_FAKE");
      expect(verification.verified).toBe(false);
      expect(verification.reason).toContain("Zero-hallucination policy enforced");
    });
  });
});
