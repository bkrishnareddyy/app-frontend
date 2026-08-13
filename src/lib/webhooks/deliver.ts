/**
 * Outbound webhook delivery with HMAC-SHA256 signing and exponential-backoff retry.
 * Three attempts; delivery logs written after each attempt.
 */
import { createHmac, randomUUID } from "crypto";
import { db } from "@/lib/db";

export type WebhookEventType =
  | "shipment.status_changed"
  | "decision.approved"
  | "exception.created"
  | "filing.submitted"
  | "filing.accepted"
  | "classification.changed";

export interface WebhookPayload {
  id: string;            // idempotency key — stable across retries
  event: WebhookEventType;
  accountId: string;
  createdAt: string;
  data: Record<string, unknown>;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

async function attempt(
  webhook: { id: string; url: string; secret: string },
  payload: WebhookPayload,
  attemptNumber: number
): Promise<{ success: boolean; statusCode: number | null; responseBody: string | null }> {
  const body = JSON.stringify(payload);
  const signature = sign(webhook.secret, body);
  const timestamp = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Qubere-Signature": `t=${timestamp},v1=${signature}`,
        "X-Qubere-Event": payload.event,
        "X-Qubere-Delivery": payload.id,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    const responseText = await res.text().catch(() => "");
    const truncated = responseText.slice(0, 2048);
    const success = res.status >= 200 && res.status < 300;

    await db.webhookDeliveryLog.create({
      data: {
        webhookId: webhook.id,
        eventType: payload.event,
        eventId: payload.id,
        payload: payload as unknown as Parameters<typeof db.webhookDeliveryLog.create>[0]["data"]["payload"],
        attempt: attemptNumber,
        statusCode: res.status,
        responseBody: truncated,
        success,
        deliveredAt: new Date(),
      },
    });

    if (success) {
      await db.accountWebhook.update({
        where: { id: webhook.id },
        data: { lastDeliveryAt: new Date() },
      });
    }

    return { success, statusCode: res.status, responseBody: truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    await db.webhookDeliveryLog.create({
      data: {
        webhookId: webhook.id,
        eventType: payload.event,
        eventId: payload.id,
        payload: payload as unknown as Parameters<typeof db.webhookDeliveryLog.create>[0]["data"]["payload"],
        attempt: attemptNumber,
        statusCode: null,
        responseBody: message.slice(0, 2048),
        success: false,
      },
    });
    return { success: false, statusCode: null, responseBody: message };
  }
}

/** Deliver an event to all active webhooks subscribed to it. Retries up to 3x with backoff. */
export async function deliverWebhookEvent(
  accountId: string,
  event: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  const webhooks = await db.accountWebhook.findMany({
    where: {
      accountId,
      status: "ACTIVE",
      events: { has: event },
    },
  });

  const payload: WebhookPayload = {
    id: randomUUID(),
    event,
    accountId,
    createdAt: new Date().toISOString(),
    data,
  };

  const BACKOFF_MS = [0, 30_000, 300_000]; // immediate, 30s, 5min

  for (const webhook of webhooks) {
    let success = false;
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
      }
      const result = await attempt(webhook, payload, i + 1);
      if (result.success) {
        success = true;
        break;
      }
    }
    if (!success) {
      console.warn(`[webhook] Failed to deliver ${event} to ${webhook.url} after 3 attempts`);
    }
  }
}
