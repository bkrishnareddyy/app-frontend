import { describe, it, expect } from "vitest";
import { WebhookService } from "../src/modules/notifications/webhookService";

describe("Phase 3 Commercial Workflows & Webhooks Test Suite", () => {
  describe("WebhookService Event Signing", () => {
    it("builds structured event payload with HMAC SHA-256 signature headers", () => {
      const secret = "whsec_test_secret_123";
      const event = WebhookService.buildEvent("classification.approved", "acc_1", { caseId: "case_101", htsCode: "8481.80.5090" }, secret);

      expect(event.payload.eventType).toBe("classification.approved");
      expect(event.headers["X-Qubere-Signature"]).toContain("sha256=");
      expect(event.headers["X-Qubere-Event-Id"]).toBeDefined();

      const calculatedSig = WebhookService.generateSignature(event.payloadString, secret);
      expect(event.headers["X-Qubere-Signature"]).toBe(`sha256=${calculatedSig}`);
    });
  });
});
