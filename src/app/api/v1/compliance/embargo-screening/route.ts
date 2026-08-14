/**
 * GET/POST /api/v1/compliance/embargo-screening
 *
 * Partner-facing read/explain layer over the deterministic Country Embargo
 * Screening engine (src/modules/agents/compliance/embargo/*). Authenticated
 * via API key (Bearer or X-Api-Key header), same as the other /api/v1/*
 * endpoints. This route never determines embargo status itself -- it only
 * reads and (for POST) triggers the same persisted-evidence pipeline the
 * Qubere chat assistant tools use (screeningQuery.ts), so both surfaces stay
 * in lockstep on status semantics, audit-count/finding-count separation, and
 * party-screening honesty.
 *
 * GET  -- read the current persisted screening result (optionally filtered
 *         to a line item / party / screening level / direction / outcome).
 *         Never reruns screening. Requires the `embargo.read` scope.
 * POST -- get the current result, reusing it unless forceRescreen is true or
 *         the shipment has never been screened. Reusing an existing result
 *         only requires `embargo.read`; actually triggering a fresh run
 *         additionally requires the `embargo.screen` scope -- a key without
 *         it gets rescreenDenied: true rather than a silent no-op.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey, apiKeyHasScope } from "@/lib/api/api-key-auth";
import { generateRequestId } from "@/lib/api/error";
import { createAuditLog, AuditAction } from "@/lib/audit";
import {
  resolveOwnedShipmentId,
  latestEmbargoScreening,
  buildScreeningResult,
  buildScreeningDetails,
} from "@/modules/agents/compliance/embargo/screeningQuery";
const getPipelineOrchestrator = () => import("@/modules/agents/pipelineOrchestrator");

const screeningLevelEnum = z.enum(["TRANSACTION", "PARTY", "LINE"]);
const directionEnum = z.enum(["D", "O"]);
const checkResultEnum = z.enum(["HIT", "CLEAR", "SKIPPED", "ERROR"]);

const detailsQuerySchema = z.object({
  shipmentId: z.string().min(1),
  lineItemId: z.string().optional(),
  partyId: z.string().optional(),
  screeningLevel: screeningLevelEnum.optional(),
  type: directionEnum.optional(),
  result: checkResultEnum.optional(),
});

const rescreenBodySchema = z.object({
  shipmentId: z.string().min(1),
  forceRescreen: z.boolean().optional().default(false),
});

export async function GET(req: Request): Promise<Response> {
  const requestId = generateRequestId();
  const apiCtx = await authenticateApiKey(req);
  if (!apiCtx) {
    return NextResponse.json({ error: "Unauthorized: valid API key required", requestId }, { status: 401 });
  }
  if (!apiKeyHasScope(apiCtx, "embargo.read")) {
    return NextResponse.json({ error: "Forbidden: key does not have embargo.read scope", requestId }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = detailsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error", issues: parsed.error.issues, requestId }, { status: 400 });
  }
  const { shipmentId: rawShipmentId, lineItemId, partyId, screeningLevel, type, result } = parsed.data;

  const shipment = await resolveOwnedShipmentId(apiCtx.accountId, rawShipmentId);
  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found", requestId }, { status: 404 });
  }

  const evidence = await latestEmbargoScreening(apiCtx.accountId, shipment.id);
  const details = buildScreeningDetails(shipment, evidence, { lineItemId, partyId, screeningLevel, type, result });

  await createAuditLog({
    accountId: apiCtx.accountId,
    userId: null,
    action: AuditAction.EMBARGO_SCREENING_QUERIED,
    entity: "Shipment",
    entityId: shipment.id,
    source: "API",
    metadata: { shipmentId: shipment.id, filters: { lineItemId, partyId, screeningLevel, type, result } },
    requestId,
  });

  return NextResponse.json({ success: true, ...details, requestId }, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  const requestId = generateRequestId();
  const apiCtx = await authenticateApiKey(req);
  if (!apiCtx) {
    return NextResponse.json({ error: "Unauthorized: valid API key required", requestId }, { status: 401 });
  }
  if (!apiKeyHasScope(apiCtx, "embargo.read")) {
    return NextResponse.json({ error: "Forbidden: key does not have embargo.read scope", requestId }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", requestId }, { status: 400 });
  }

  const parsed = rescreenBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error", issues: parsed.error.issues, requestId }, { status: 400 });
  }
  const { shipmentId: rawShipmentId, forceRescreen } = parsed.data;

  const shipment = await resolveOwnedShipmentId(apiCtx.accountId, rawShipmentId);
  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found", requestId }, { status: 404 });
  }

  let evidence = await latestEmbargoScreening(apiCtx.accountId, shipment.id);
  let rescreened = false;
  let rescreenDenied = false;

  if (forceRescreen || !evidence) {
    if (apiKeyHasScope(apiCtx, "embargo.screen")) {
      const { PipelineOrchestrator } = await getPipelineOrchestrator();
      await PipelineOrchestrator.processEvent({
        shipmentId: shipment.id,
        accountId: apiCtx.accountId,
        triggerEvent: "RECONCILIATION_REQUESTED",
      });
      evidence = await latestEmbargoScreening(apiCtx.accountId, shipment.id);
      rescreened = true;

      await createAuditLog({
        accountId: apiCtx.accountId,
        userId: null,
        action: AuditAction.EMBARGO_SCREENING_RESCREENED,
        entity: "Shipment",
        entityId: shipment.id,
        source: "API",
        metadata: { shipmentId: shipment.id },
        requestId,
      });
    } else if (forceRescreen) {
      rescreenDenied = true;
    }
  }

  const result = buildScreeningResult(shipment, evidence, { rescreened, rescreenDenied });
  return NextResponse.json({ success: true, ...result, requestId }, { status: 200 });
}
