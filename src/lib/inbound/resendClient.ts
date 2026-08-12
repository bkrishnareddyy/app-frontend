/**
 * Thin wrapper around the `resend` SDK for inbound email ingestion.
 *
 * Webhook payloads from Resend carry attachment metadata only -- never bytes,
 * never the body. Retrieving the actual content always requires a follow-up
 * authenticated call back to Resend, done here and nowhere else.
 */

import { Resend } from "resend";
import type { WebhookEventPayload } from "resend";

export class ResendConfigError extends Error {}
export class ResendWebhookVerificationError extends Error {}

let client: Resend | null = null;

function getClient(): Resend {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new ResendConfigError("RESEND_API_KEY is not configured.");
  }
  client = new Resend(apiKey);
  return client;
}

export interface WebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

/**
 * Verifies a Resend/Svix webhook signature against the raw request body.
 * Callers must pass the exact raw text of the request -- re-serialized JSON
 * will not match the signature.
 */
export function verifyResendWebhook(rawBody: string, headers: WebhookHeaders): WebhookEventPayload {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    throw new ResendConfigError("RESEND_WEBHOOK_SECRET is not configured.");
  }
  try {
    return getClient().webhooks.verify({ payload: rawBody, headers, webhookSecret: secret });
  } catch (error) {
    throw new ResendWebhookVerificationError(
      error instanceof Error ? error.message : "Webhook signature verification failed."
    );
  }
}

export interface ReceivedEmailAttachmentMeta {
  id: string;
  filename: string | null;
  size: number;
  contentType: string;
  contentId: string | null;
  contentDisposition: string | null;
}

export interface ReceivedEmailContent {
  id: string;
  from: string;
  to: string[];
  subject: string;
  receivedFor: string[];
  headers: Record<string, string> | null;
  attachments: ReceivedEmailAttachmentMeta[];
}

/** Fetches full email metadata/headers/attachment-list for a received email. */
export async function getReceivedEmail(emailId: string): Promise<ReceivedEmailContent> {
  const { data, error } = await getClient().emails.receiving.get(emailId);
  if (error || !data) {
    throw new Error(`Failed to fetch received email ${emailId}: ${error?.message ?? "unknown error"}`);
  }
  return {
    id: data.id,
    from: data.from,
    to: data.to,
    subject: data.subject,
    receivedFor: data.received_for,
    headers: data.headers,
    attachments: data.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      contentType: a.content_type,
      contentId: a.content_id,
      contentDisposition: a.content_disposition,
    })),
  };
}

export interface AttachmentDownloadInfo {
  filename: string | null;
  size: number;
  contentType: string;
  contentDisposition: "inline" | "attachment";
  downloadUrl: string;
}

/** Resolves a short-lived (1 hour) signed download URL for one attachment. */
export async function getAttachmentDownloadInfo(
  emailId: string,
  attachmentId: string
): Promise<AttachmentDownloadInfo> {
  const { data, error } = await getClient().emails.receiving.attachments.get({
    emailId,
    id: attachmentId,
  });
  if (error || !data) {
    throw new Error(
      `Failed to fetch attachment ${attachmentId} for email ${emailId}: ${error?.message ?? "unknown error"}`
    );
  }
  return {
    filename: data.filename ?? null,
    size: data.size,
    contentType: data.content_type,
    contentDisposition: data.content_disposition,
    downloadUrl: data.download_url,
  };
}

/** Downloads attachment bytes from a signed URL obtained via `getAttachmentDownloadInfo`. */
export async function downloadAttachmentBytes(downloadUrl: string): Promise<Buffer> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Attachment download failed with status ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}
