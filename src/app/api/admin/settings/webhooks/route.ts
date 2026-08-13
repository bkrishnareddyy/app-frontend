import { NextResponse } from "next/server";
import { z } from "zod";
import { createHmac, randomBytes } from "crypto";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";

export const WEBHOOK_EVENT_TYPES = [
  "shipment.status_changed",
  "decision.approved",
  "exception.created",
  "filing.submitted",
  "filing.accepted",
  "classification.changed",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const webhooks = await db.accountWebhook.findMany({
    where: { accountId: ctx.accountId },
    include: {
      deliveryLogs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { success: true, statusCode: true, eventType: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    webhooks: webhooks.map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events,
      status: w.status,
      lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null,
      recentDeliveries: w.deliveryLogs.map((l) => ({
        success: l.success,
        statusCode: l.statusCode,
        eventType: l.eventType,
        deliveredAt: l.createdAt.toISOString(),
      })),
      createdAt: w.createdAt.toISOString(),
    })),
    supportedEvents: WEBHOOK_EVENT_TYPES,
    requestId,
  });
}, { permission: "settings.manage" });

const createWebhookSchema = z.object({
  url: z.string().url("Must be a valid HTTPS URL").refine((u) => u.startsWith("https://"), {
    message: "Webhook URL must use HTTPS",
  }),
  events: z
    .array(z.enum(WEBHOOK_EVENT_TYPES))
    .min(1, "At least one event type is required"),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createWebhookSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  const existing = await db.accountWebhook.count({ where: { accountId: ctx.accountId } });
  if (existing >= 10) {
    return buildErrorResponse(
      429,
      "TOO_MANY_WEBHOOKS",
      "Maximum of 10 webhooks per account.",
      undefined,
      requestId
    );
  }

  // Generate a signing secret — shown once, then only the hash is stored.
  const rawSecret = `whsec_${randomBytes(24).toString("hex")}`;
  // Store the secret itself (not a hash) so the delivery system can sign.
  // In production this would be encrypted at rest via KMS.
  const webhook = await db.accountWebhook.create({
    data: {
      accountId: ctx.accountId,
      url: bodyVal.data.url,
      secret: rawSecret,
      events: bodyVal.data.events,
      status: "ACTIVE",
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "WEBHOOK_CREATED",
    entity: "AccountWebhook",
    entityId: webhook.id,
    metadata: { url: webhook.url, events: webhook.events },
    success: true,
  });

  return NextResponse.json(
    {
      success: true,
      webhook: {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        status: webhook.status,
        // Raw secret shown once — callers must store it.
        secret: rawSecret,
        createdAt: webhook.createdAt.toISOString(),
      },
      requestId,
    },
    { status: 201 }
  );
}, { permission: "settings.manage", write: true });
