import { NextResponse, after } from "next/server";
import { Prisma } from "@prisma/client";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import {
  verifyResendWebhook,
  ResendConfigError,
  ResendWebhookVerificationError,
} from "@/lib/inbound/resendClient";
import { normalizeSenderEmail, recipientMatches } from "@/modules/inbound/emailNormalization";
import { runInboundEmailWorkerTick } from "@/modules/documents/processing/inboundEmailWorker";

/**
 * Public, signed entry point for Resend's `email.received` webhook.
 *
 * Does the minimum needed to answer fast and durably: verify the signature,
 * confirm the email was actually addressed to an address we ingest, dedupe
 * the provider event, persist minimal state, and return. No attachment
 * fetch, no storage, no Gemini call happens in this request -- that is
 * `runInboundEmailWorkerTick`'s job, dispatched after the response and
 * backstopped by the `inbound-email-processing` cron tick.
 */
function allowedRecipients(): string[] {
  const configured = process.env.RESEND_ALLOWED_INBOUND_RECIPIENTS;
  const raw = configured && configured.trim() !== "" ? configured : "docs@inbound.qubere.ai";
  return raw.split(",").map((addr) => normalizeSenderEmail(addr)).filter(Boolean);
}

export const POST = withPublicRoute(async ({ req, requestId }) => {
  const rawBody = await req.text();
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "MISSING_SIGNATURE_HEADERS", requestId }, { status: 400 });
  }

  let payload;
  try {
    payload = verifyResendWebhook(rawBody, {
      id: svixId,
      timestamp: svixTimestamp,
      signature: svixSignature,
    });
  } catch (error) {
    if (error instanceof ResendConfigError) {
      console.error("[ResendWebhook] Not configured:", error.message);
      return NextResponse.json({ error: "NOT_CONFIGURED", requestId }, { status: 503 });
    }
    if (error instanceof ResendWebhookVerificationError) {
      return NextResponse.json({ error: "INVALID_SIGNATURE", requestId }, { status: 400 });
    }
    throw error;
  }

  // Only the event this endpoint is meant for is processed; anything else
  // (delivery/open/click events, if ever misconfigured onto this endpoint)
  // is acknowledged and ignored.
  if (payload.type !== "email.received") {
    return NextResponse.json({ status: "IGNORED", requestId });
  }

  const { data } = payload;
  const allowed = allowedRecipients();
  const candidateRecipients = [...(data.to ?? []), ...(data.received_for ?? [])];
  const isAddressedToUs = candidateRecipients.some((candidate) =>
    allowed.some((expected) => recipientMatches(candidate, expected))
  );

  const normalizedFrom = normalizeSenderEmail(data.from);

  try {
    await db.inboundEmail.create({
      data: {
        provider: "resend",
        providerEventId: svixId,
        providerEmailId: data.email_id,
        normalizedFromAddress: normalizedFrom,
        originalFromAddress: data.from,
        toAddresses: candidateRecipients.join(", "),
        subject: data.subject ?? null,
        receivedAt: new Date(data.created_at),
        routingStatus: isAddressedToUs ? "RECEIVED" : "REJECTED",
        quarantineReason: isAddressedToUs ? null : "recipient_not_allowed",
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Duplicate webhook delivery for an event we've already recorded.
      // Idempotent no-op: the original delivery (or the cron backstop) owns
      // processing this email.
      return NextResponse.json({ status: "DUPLICATE", requestId }, { status: 200 });
    }
    throw error;
  }

  if (isAddressedToUs) {
    // Fire-and-forget: keeps this response fast while the durable worker
    // does the slow work (attachment fetch, storage, extraction). The
    // `inbound-email-processing` cron tick is the retry path if this doesn't
    // finish (cold start, timeout, crash).
    after(async () => {
      try {
        await runInboundEmailWorkerTick();
      } catch (err) {
        console.error("[ResendWebhook] Immediate processing tick failed:", err);
      }
    });
  }

  return NextResponse.json({ status: "ACCEPTED", requestId }, { status: 202 });
});
