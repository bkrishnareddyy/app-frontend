import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findManyMock = vi.fn();
const createDeliveryLogMock = vi.fn();
const updateWebhookMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    accountWebhook: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      update: (...args: unknown[]) => updateWebhookMock(...args),
    },
    webhookDeliveryLog: {
      create: (...args: unknown[]) => createDeliveryLogMock(...args),
    },
  },
}));

describe("Outbound Webhook Delivery - All 6 Event Types", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    findManyMock.mockReset();
    createDeliveryLogMock.mockReset();
    updateWebhookMock.mockReset();

    findManyMock.mockResolvedValue([
      {
        id: "wh_123",
        url: "https://example.com/webhook",
        secret: "whsec_test_secret_key_12345",
      },
    ]);

    createDeliveryLogMock.mockResolvedValue({ id: "log_1" });
    updateWebhookMock.mockResolvedValue({ id: "wh_123" });

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue("OK"),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const eventTypes = [
    "shipment.status_changed",
    "decision.approved",
    "exception.created",
    "filing.submitted",
    "filing.accepted",
    "classification.changed",
  ] as const;

  for (const eventType of eventTypes) {
    it(`successfully delivers event: ${eventType}`, async () => {
      const { deliverWebhookEvent } = await import("@/lib/webhooks/deliver");

      const eventData = {
        sampleKey: `sample_value_for_${eventType}`,
        timestamp: new Date().toISOString(),
      };

      await deliverWebhookEvent("acc_999", eventType, eventData);

      expect(findManyMock).toHaveBeenCalledWith({
        where: {
          accountId: "acc_999",
          status: "ACTIVE",
          events: { has: eventType },
        },
      });

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [targetUrl, options] = (globalThis.fetch as any).mock.calls[0];

      expect(targetUrl).toBe("https://example.com/webhook");
      expect(options.method).toBe("POST");
      expect(options.headers["X-Qubere-Event"]).toBe(eventType);
      expect(options.headers["X-Qubere-Signature"]).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);

      const body = JSON.parse(options.body);
      expect(body.event).toBe(eventType);
      expect(body.accountId).toBe("acc_999");
      expect(body.data).toEqual(eventData);

      expect(createDeliveryLogMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          webhookId: "wh_123",
          eventType,
          statusCode: 200,
          success: true,
        }),
      });

      expect(updateWebhookMock).toHaveBeenCalledWith({
        where: { id: "wh_123" },
        data: { lastDeliveryAt: expect.any(Date) },
      });
    });
  }
});
