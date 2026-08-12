/**
 * Inbound email ingestion worker.
 *
 * Same shape as `documentProcessingWorker.ts`'s `runWorkerTick`: a single
 * bounded pass over durable Postgres state, safe to call concurrently from
 * both the webhook's `after()` dispatch and the `inbound-email-processing`
 * cron tick, because every step here re-checks and conditionally advances
 * state rather than assuming where a row was left off.
 *
 * No parsing happens here -- attachments are stored, then handed to the
 * existing `enqueueDocumentParse` pipeline, exactly like a manual upload.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { storeDocumentFile, StorageValidationError } from "@/lib/storage";
import { screenUploadForMalware } from "./malwarePolicy";
import { assertParseableFormat } from "./documentSource";
import { isDocumentParserError } from "../parser/contracts";
import { enqueueDocumentParse } from "./documentProcessingWorker";
import { resolveInboundRoute } from "@/modules/inbound/senderRouting";
import {
  getReceivedEmail,
  getAttachmentDownloadInfo,
  downloadAttachmentBytes,
  type ReceivedEmailAttachmentMeta,
} from "@/lib/inbound/resendClient";

const MAX_EMAILS_PER_TICK = 10;

export interface InboundEmailTickResult {
  claimed: number;
  quarantined: number;
  accepted: number;
  failed: number;
}

function log(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.log(`[InboundEmailWorker] ${event}`, fields);
}

export async function runInboundEmailWorkerTick(): Promise<InboundEmailTickResult> {
  const dueEmails = await db.inboundEmail.findMany({
    where: { routingStatus: { in: ["RECEIVED", "ROUTED"] } },
    orderBy: { createdAt: "asc" },
    take: MAX_EMAILS_PER_TICK,
  });

  const result: InboundEmailTickResult = { claimed: dueEmails.length, quarantined: 0, accepted: 0, failed: 0 };

  for (const email of dueEmails) {
    try {
      const accepted = await processOneEmail(email.id);
      if (accepted === "QUARANTINED") result.quarantined += 1;
      else result.accepted += 1;
    } catch (error) {
      result.failed += 1;
      log("email.tick_error", { inboundEmailId: email.id, error: error instanceof Error ? error.message : String(error) });
      // Left as ROUTED/RECEIVED so the next tick retries -- no state was
      // corrupted, since every downstream write here is itself idempotent.
    }
  }

  return result;
}

async function processOneEmail(inboundEmailId: string): Promise<"QUARANTINED" | "ACCEPTED"> {
  let email = await db.inboundEmail.findUniqueOrThrow({ where: { id: inboundEmailId } });

  if (email.routingStatus === "RECEIVED") {
    const route = await resolveInboundRoute(email.normalizedFromAddress);
    if (!route) {
      await db.inboundEmail.update({
        where: { id: email.id },
        data: { routingStatus: "QUARANTINED", quarantineReason: "unknown_sender" },
      });
      // createAuditLog requires a real accountId (it's a NOT NULL FK to
      // Account) and an unrouted email was never attributed to a tenant --
      // this log line, plus the InboundEmail row itself, is the durable
      // record for this case. A tenant-agnostic quarantine audit trail is
      // out of scope for this slice; see the plan's deferred-scope notes.
      log("email.quarantined", { inboundEmailId: email.id, reason: "unknown_sender" });
      return "QUARANTINED";
    }

    email = await db.inboundEmail.update({
      where: { id: email.id },
      data: { accountId: route.accountId, routingStatus: "ROUTED" },
    });
  }

  if (!email.accountId) {
    // Should be unreachable: ROUTED always has accountId set above.
    throw new Error(`InboundEmail ${email.id} is ROUTED but has no accountId.`);
  }
  const accountId = email.accountId;

  const remote = await getReceivedEmail(email.providerEmailId);
  if (email.authHeaders === null) {
    await db.inboundEmail.update({
      where: { id: email.id },
      data: { authHeaders: remote.headers ?? {} },
    });
  }

  const route = await resolveInboundRoute(email.normalizedFromAddress);
  const defaultAssigneeId = route?.defaultAssignedToUserId ?? null;

  let storedCount = 0;
  for (const attachment of remote.attachments) {
    const stored = await processOneAttachment({ accountId, email, attachment, defaultAssigneeId });
    if (stored) storedCount += 1;
  }

  if (storedCount > 0 && defaultAssigneeId) {
    // Guards against a duplicate notification if a prior tick got far enough
    // to store attachments but crashed before reaching routingStatus:
    // "ACCEPTED" below -- the retry would otherwise recompute storedCount
    // (correctly, from already-STORED rows) and create a second notification
    // for the same email.
    const alreadyNotified = await db.notification.findFirst({
      where: { entityType: "InboundEmail", entityId: email.id },
      select: { id: true },
    });
    if (!alreadyNotified) {
      await db.notification.create({
        data: {
          accountId,
          userId: defaultAssigneeId,
          type: "INBOUND_EMAIL_DOCUMENTS",
          message: `${storedCount} new document${storedCount === 1 ? "" : "s"} from ${email.originalFromAddress}`,
          entityType: "InboundEmail",
          entityId: email.id,
        },
      });
    }
  }

  await db.inboundEmail.update({ where: { id: email.id }, data: { routingStatus: "ACCEPTED" } });
  log("email.accepted", { inboundEmailId: email.id, accountId, attachmentCount: remote.attachments.length, storedCount });
  return "ACCEPTED";
}

async function processOneAttachment(params: {
  accountId: string;
  email: { id: string; providerEmailId: string };
  attachment: ReceivedEmailAttachmentMeta;
  defaultAssigneeId: string | null;
}): Promise<boolean> {
  const { accountId, email, attachment, defaultAssigneeId } = params;

  const existing = await db.inboundAttachment.findUnique({
    where: { inboundEmailId_providerAttachmentId: { inboundEmailId: email.id, providerAttachmentId: attachment.id } },
  });
  // Already processed (or explicitly skipped) in a prior tick -- do not redo work.
  if (existing && existing.processingStatus !== "PENDING") return existing.processingStatus === "STORED";

  const isInline = attachment.contentDisposition === "inline";
  if (isInline) {
    await db.inboundAttachment.upsert({
      where: { inboundEmailId_providerAttachmentId: { inboundEmailId: email.id, providerAttachmentId: attachment.id } },
      create: {
        inboundEmailId: email.id,
        providerAttachmentId: attachment.id,
        originalFilename: attachment.filename ?? "unnamed",
        declaredMimeType: attachment.contentType,
        contentDisposition: attachment.contentDisposition,
        actualSize: attachment.size,
        processingStatus: "SKIPPED_INLINE",
      },
      update: { processingStatus: "SKIPPED_INLINE" },
    });
    return false;
  }

  const attachmentRow = await db.inboundAttachment.upsert({
    where: { inboundEmailId_providerAttachmentId: { inboundEmailId: email.id, providerAttachmentId: attachment.id } },
    create: {
      inboundEmailId: email.id,
      providerAttachmentId: attachment.id,
      originalFilename: attachment.filename ?? "unnamed",
      declaredMimeType: attachment.contentType,
      contentDisposition: attachment.contentDisposition,
      actualSize: attachment.size,
      processingStatus: "PENDING",
    },
    update: {},
  });

  const correlationId = randomUUID();
  const filename = attachment.filename ?? `attachment-${attachment.id}`;

  try {
    const download = await getAttachmentDownloadInfo(email.providerEmailId, attachment.id);
    const bytes = await downloadAttachmentBytes(download.downloadUrl);

    try {
      assertParseableFormat(bytes);
    } catch (error) {
      const reason = isDocumentParserError(error) ? error.message : "Unreadable file format.";
      await rejectAttachment(attachmentRow.id, reason);
      return false;
    }

    const scan = await screenUploadForMalware({ fileName: filename, byteSize: bytes.byteLength, bytes });
    if (scan.verdict === "QUARANTINE") {
      await rejectAttachment(attachmentRow.id, scan.reason);
      await createAuditLog({
        accountId,
        action: "inbound_email.attachment_quarantined",
        entity: "InboundAttachment",
        entityId: attachmentRow.id,
        metadata: { fileName: filename, reason: scan.reason },
        correlationId,
        success: false,
      });
      return false;
    }

    // A fresh Uint8Array copy: File/Blob do not accept a Node Buffer's
    // underlying ArrayBuffer view directly across every runtime.
    const file = new File([new Uint8Array(bytes)], filename, {
      type: download.contentType || attachment.contentType,
    });
    let storageResult;
    try {
      storageResult = await storeDocumentFile(file, filename);
    } catch (error) {
      const reason = error instanceof StorageValidationError ? error.message : "Storage failed.";
      await rejectAttachment(attachmentRow.id, reason);
      return false;
    }

    const { DocumentTypeCatalog } = await import("@/modules/intake/documentTypeCatalog");
    const docType = DocumentTypeCatalog.matchDocumentType(filename).name;

    const document = await db.shipmentDocument.create({
      data: {
        accountId,
        shipmentId: null,
        source: "EMAIL",
        assignedToUserId: defaultAssigneeId,
        docType,
        fileName: filename,
        fileUrl: storageResult.url,
        checksum: storageResult.checksum,
        byteSize: bytes.byteLength,
        mimeType: file.type || null,
      },
    });

    await db.inboundAttachment.update({
      where: { id: attachmentRow.id },
      data: { processingStatus: "STORED", checksum: storageResult.checksum, shipmentDocumentId: document.id },
    });

    await createAuditLog({
      accountId,
      action: "inbound_email.document_stored",
      entity: "ShipmentDocument",
      entityId: document.id,
      metadata: {
        fileName: filename,
        docType,
        byteSize: bytes.byteLength,
        sha256: storageResult.checksum,
        mimeType: file.type || null,
        storageProvider: storageResult.provider,
        malwareScan: scan.verdict,
        inboundEmailId: email.id,
        inboundAttachmentId: attachmentRow.id,
      },
      correlationId,
    });

    await enqueueDocumentParse({
      accountId,
      documentId: document.id,
      contentSha256: storageResult.checksum,
      profile: "STANDARD",
      reason: "INITIAL",
      correlationId,
    });
    return true;
  } catch (error) {
    await rejectAttachment(
      attachmentRow.id,
      error instanceof Error ? error.message : "Unexpected error while processing this attachment."
    );
    return false;
  }
}

async function rejectAttachment(attachmentId: string, reason: string): Promise<void> {
  await db.inboundAttachment.update({
    where: { id: attachmentId },
    data: { processingStatus: "REJECTED", rejectionReason: reason },
  });
}
