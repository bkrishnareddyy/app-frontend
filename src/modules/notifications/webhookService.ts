import crypto from "crypto";

export interface WebhookEventPayload {
  eventId: string;
  eventType: "classification.proposed" | "classification.approved" | "classification.needs_information" | "hts.release_published" | "hts.code_changed";
  accountId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export class WebhookService {
  /**
   * Generates HMAC SHA-256 signature header for webhook payload authentication.
   */
  static generateSignature(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  /**
   * Constructs a signed webhook payload.
   */
  static buildEvent(eventType: WebhookEventPayload["eventType"], accountId: string, data: Record<string, unknown>, secret: string = "whsec_default_key") {
    const eventId = `evt_${crypto.randomBytes(12).toString("hex")}`;
    const timestamp = new Date().toISOString();

    const payload: WebhookEventPayload = {
      eventId,
      eventType,
      accountId,
      timestamp,
      data,
    };

    const payloadString = JSON.stringify(payload);
    const signature = this.generateSignature(payloadString, secret);

    return {
      payload,
      payloadString,
      headers: {
        "Content-Type": "application/json",
        "X-Qubere-Event-Id": eventId,
        "X-Qubere-Signature": `sha256=${signature}`,
        "X-Qubere-Timestamp": timestamp,
      },
    };
  }
}
