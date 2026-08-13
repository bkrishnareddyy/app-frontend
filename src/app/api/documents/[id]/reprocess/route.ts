import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { PROCESSING_PROFILES } from "@/modules/documents/parser/contracts";
import { enqueueDocumentParse } from "@/modules/documents/processing/documentProcessingWorker";
import { advanceDocumentProcessing } from "@/modules/documents/processing/advanceProcessing";
import { runReconciliationEngine, type DocumentGroup } from "@/lib/reconciliation/reconciliationEngine";
import { computeReadinessBreakdown } from "@/lib/shipmentReadiness";
import { recomputeShipmentDeadlines } from "@/modules/deadlines/deadline.service";

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * fromStep controls which part of the pipeline to (re)run:
 * - "full"       (default) — OCR + extraction + classification + reconciliation
 * - "reconcile"  — skip OCR/extraction; re-run cross-doc reconciliation +
 *                  readiness score only. Use after a field correction where
 *                  extraction data is already fresh.
 */
export const REPROCESS_STEPS = ["full", "reconcile"] as const;
export type ReprocessStep = (typeof REPROCESS_STEPS)[number];

const bodySchema = z.object({
  profile: z.enum(PROCESSING_PROFILES).default("FULL_PAGE_OCR"),
  /** Free-text justification, recorded in the audit trail. */
  note: z.string().max(500).optional(),
  fromStep: z.enum(REPROCESS_STEPS).default("full"),
});

/**
 * Requests a new processing run for a document.
 *
 * Reprocessing always creates a NEW run. It never mutates, reruns, or deletes a
 * historical one: prior parser artifacts, extraction runs, facts and
 * reconciliation evidence all survive, and the new run only becomes
 * authoritative once it completes and passes the quality policy.
 *
 * Defaults to FULL_PAGE_OCR because a manual reprocess almost always follows a
 * parse that missed something a text layer did not contain. The caller can pick
 * a different profile explicitly.
 *
 * Requires `decisions.reevaluate`, which is the existing capability for "run an
 * agent again over this work" and is withheld from viewers.
 */

// Budget for the `after()` drain that follows the 202, not for the handler.
export const maxDuration = 60;

export const POST = withAuthenticatedRoute<{ id: string }>(
  async ({ req, ctx, requestId, params }) => {
    const paramsVal = validatePathParams(params, paramsSchema, requestId);
    if ("response" in paramsVal) return paramsVal.response;

    const body = await parseAndValidateBody(req, bodySchema, requestId).catch(() => null);
    // An empty body is a valid request meaning "use the defaults".
    const parsed = body !== null && "data" in body ? body.data : bodySchema.parse({});

    const document = await db.shipmentDocument.findFirst({
      where: { id: paramsVal.data.id, accountId: ctx.accountId },
      select: { id: true, fileName: true, checksum: true, fileUrl: true, shipmentId: true },
});

    if (!document) {
      return buildErrorResponse(404, "NOT_FOUND", "Document not found.", undefined, requestId);
    }

    // F-2: reconcile-only path — skip OCR and re-run cross-doc reconciliation
    // + readiness score for the document's shipment. Useful after a field
    // correction where the parsed content is already fresh.
    if (parsed.fromStep === "reconcile" && document.shipmentId) {
      const shipmentId = document.shipmentId;
      const shipment = await db.shipment.findFirst({
        where: { id: shipmentId, accountId: ctx.accountId, deletedAt: null },
        include: {
          documents: { include: { extractionFields: true } },
          lineItems: true,
          exceptionItems: { where: { status: { not: "Resolved" } } },
        },
      });

      if (shipment) {
        const documentGroups: DocumentGroup[] = shipment.documents
          .filter((d) => d.extractionFields.length > 0)
          .map((d) => ({
            documentId: d.id,
            docType: d.docType,
            fields: d.extractionFields.map((f) => ({
              fieldName: f.fieldName,
              value: f.value,
              confidence: f.confidence,
            })),
          }));

        const { results, evaluatedRuleIds } = runReconciliationEngine(documentGroups);
        const severityMap: Record<string, string> = { BLOCKING: "Critical", WARNING: "Warning", INFO: "Info" };
        const openIssues = await db.reconciliationIssue.findMany({
          where: { shipmentId, accountId: ctx.accountId, status: "Open" },
        });
        const evaluatedFields = new Set(evaluatedRuleIds);

        for (const result of results) {
          const existing = openIssues.find((i) => i.field === result.ruleId);
          const data = {
            field: result.ruleId,
            severity: severityMap[result.severity] ?? "Warning",
            expectedValue: `${result.valueA} (${result.docTypeA})`,
            actualValue: `${result.valueB} (${result.docTypeB})`,
            sourceDocuments: [result.docTypeA, result.docTypeB],
          };
          if (existing) {
            await db.reconciliationIssue.update({ where: { id: existing.id }, data });
          } else {
            await db.reconciliationIssue.create({
              data: { ...data, shipmentId, accountId: ctx.accountId, status: "Open" },
            });
          }
        }

        const resolvedRuleIds = new Set(results.map((r) => r.ruleId));
        const staleIds = openIssues
          .filter((i) => evaluatedFields.has(i.field) && !resolvedRuleIds.has(i.field))
          .map((i) => i.id);
        if (staleIds.length > 0) {
          await db.reconciliationIssue.updateMany({
            where: { id: { in: staleIds } },
            data: { status: "Resolved", resolvedAt: new Date() },
          });
        }

        const remainingOpen = await db.reconciliationIssue.findMany({
          where: { shipmentId, accountId: ctx.accountId, status: "Open" },
        });
        const blockingCount = remainingOpen.filter((i) => i.severity === "Critical").length;

        const allFields = shipment.documents.flatMap((d) => d.extractionFields);
        const avgConf =
          allFields.length === 0
            ? undefined
            : allFields.reduce((s, f) => s + (f.confidence ?? 0), 0) / allFields.length;

        const { totalScore } = computeReadinessBreakdown({
          documents: shipment.documents.map((d) => ({ docType: d.docType ?? "", status: d.status ?? "" })),
          lineItems: shipment.lineItems.map((li) => ({
            htsCode: li.htsCode ?? "",
            countryOfOrigin: li.countryOfOrigin ?? "",
            quantity: Number(li.quantity),
            unitPrice: li.unitPrice,
            status: li.status,
          })),
          exceptionItems: shipment.exceptionItems.map((e) => ({
            status: e.status ?? "Open",
            severity: e.severity ?? "Medium",
            blocking: e.severity === "Critical" || e.severity === "High",
          })),
          avgExtractionConfidence: avgConf,
          blockingReconciliationIssues: blockingCount,
        });

        const healthStatus =
          totalScore >= 80 ? "Healthy" : totalScore >= 50 ? "At Risk" : "Critical";
        await db.shipment.update({ where: { id: shipmentId }, data: { readinessScore: totalScore, healthStatus } });
        await recomputeShipmentDeadlines(shipmentId);
      }

      return NextResponse.json({
        status: "ACCEPTED",
        requestId,
        documentId: document.id,
        fromStep: "reconcile",
      });
    }

    if (document.fileUrl === null) {
      return buildErrorResponse(
        409,
        "NO_SOURCE_FILE",
        "This document has no stored file, so it cannot be reprocessed.",
        undefined,
        requestId
      );
    }
    if (document.checksum === null) {
      // The idempotency key is derived from the content hash. Without it, a
      // reprocess could not be deduplicated, so it is refused rather than made
      // unsafe.
      return buildErrorResponse(
        409,
        "NO_CONTENT_HASH",
        "This document has no recorded content hash, so a reprocessing run cannot be identified idempotently. Re-upload the file to record one.",
        undefined,
        requestId
      );
    }

    const correlationId = randomUUID();
    const queued = await enqueueDocumentParse({
      accountId: ctx.accountId,
      documentId: document.id,
      contentSha256: document.checksum,
      profile: parsed.profile,
      reason: "MANUAL_REPROCESS",
      correlationId,
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "document.processing.reprocess_requested",
      entity: "DocumentParseVersion",
      entityId: queued.runId ?? document.id,
      source: "UI",
      metadata: {
        documentId: document.id,
        fileName: document.fileName,
        profile: parsed.profile,
        note: parsed.note ?? null,
        created: queued.created,
        blocker: queued.blocker,
      },
      correlationId,
      requestId,
      success: queued.blocker === null,
    });

    if (queued.blocker !== null) {
      return buildErrorResponse(
        503,
        "PARSER_NOT_CONFIGURED",
        queued.blocker,
        undefined,
        requestId
      );
    }

    // Same reasoning as the upload route: the run is recorded, and this request
    // is what submits it. Cron runs once a day and would leave it queued.
    advanceDocumentProcessing({ reason: "document.reprocess" });

    return NextResponse.json(
      {
        status: "ACCEPTED",
        requestId,
        correlationId,
        documentId: document.id,
        processing: {
          runId: queued.runId,
          // false means an identical run already exists for this profile and
          // configuration -- the existing one is being observed, not a new one.
          created: queued.created,
          profile: parsed.profile,
          statusUrl: `/api/documents/${document.id}/processing`,
        },
      },
      { status: 202 }
    );
  
}, { permission: "documents.create", write: true });
