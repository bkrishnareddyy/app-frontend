import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const verifyMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function MockResend() {
    return { webhooks: { verify: verifyMock } };
  }),
}));

describe("Resend webhook signature verification", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    verifyMock.mockReset();
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test_secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const headers = { id: "msg_1", timestamp: "1700000000", signature: "v1,abc" };

  it("returns the verified payload on a valid signature", async () => {
    const payload = { type: "email.received", created_at: "now", data: { email_id: "e1" } };
    verifyMock.mockReturnValue(payload);

    const { verifyResendWebhook } = await import("@/lib/inbound/resendClient");
    const result = verifyResendWebhook("raw-body", headers);

    expect(result).toEqual(payload);
    expect(verifyMock).toHaveBeenCalledWith({
      payload: "raw-body",
      headers,
      webhookSecret: "whsec_test_secret",
    });
  });

  it("wraps a rejected/invalid signature in ResendWebhookVerificationError", async () => {
    verifyMock.mockImplementation(() => {
      throw new Error("No matching signature found");
    });

    const { verifyResendWebhook, ResendWebhookVerificationError } = await import("@/lib/inbound/resendClient");
    expect(() => verifyResendWebhook("tampered-body", headers)).toThrow(ResendWebhookVerificationError);
  });

  it("refuses to verify (rather than silently skip) when the secret is not configured", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;

    const { verifyResendWebhook, ResendConfigError } = await import("@/lib/inbound/resendClient");
    expect(() => verifyResendWebhook("raw-body", headers)).toThrow(ResendConfigError);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("a replayed body with the same headers verifies identically -- replay detection is the caller's job (event-id dedup), not the signature check's", async () => {
    const payload = { type: "email.received", created_at: "now", data: { email_id: "e1" } };
    verifyMock.mockReturnValue(payload);

    const { verifyResendWebhook } = await import("@/lib/inbound/resendClient");
    const first = verifyResendWebhook("raw-body", headers);
    const second = verifyResendWebhook("raw-body", headers);
    expect(first).toEqual(second);
  });
});
