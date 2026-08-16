/**
 * POST /api/v1/screening/restricted-party
 *
 * Partner-facing entry point over the deterministic Restricted/Denied-Party
 * Screening engine (src/modules/agents/compliance/restrictedParty/*). Screens
 * an ad-hoc identity -- never a persisted party or shipment -- against the
 * denial-order lists and red-flag words, and persists an immutable result.
 * Authenticated via API key, same as the other /api/v1/* endpoints.
 *
 * Requires the `compliance.restrictedParty.screen` scope. Supports the
 * `Idempotency-Key` header so ERP-side retries never duplicate immutable
 * screening history. Rate-limited per API key (checkRestrictedPartyRate).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey, apiKeyHasScope } from "@/lib/api/api-key-auth";
import { generateRequestId, handleApiError } from "@/lib/api/error";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { checkRestrictedPartyRate } from "@/lib/api/restrictedPartyRateLimit";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { runRestrictedPartyScreening } from "@/modules/agents/compliance/restrictedParty/restrictedPartyScreening";
import { persistScreeningRun } from "@/modules/agents/compliance/restrictedParty/persistResult";

const partySchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  contactName: z.string().optional(),
});

const bodySchema = z.object({
  externalReference: z.string().optional(),
  party: partySchema,
  threshold: z.number().int().min(0).max(100).optional(),
  addressThreshold: z.number().int().min(0).max(100).optional(),
  countryMatch: z.boolean().optional(),
  redFlagCheck: z.boolean().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const requestId = generateRequestId();
  const apiCtx = await authenticateApiKey(req);
  if (!apiCtx) {
    return NextResponse.json({ error: "Unauthorized: valid API key required", requestId }, { status: 401 });
  }
  if (!apiKeyHasScope(apiCtx, "compliance.restrictedParty.screen")) {
    return NextResponse.json(
      { error: "Forbidden: key does not have compliance.restrictedParty.screen scope", requestId },
      { status: 403 }
    );
  }

  const rate = checkRestrictedPartyRate(apiCtx.keyId);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfterSeconds: rate.retryAfterSeconds, requestId },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  const idempotency = await checkIdempotency(req, apiCtx.accountId, requestId);
  if (idempotency.errorResponse) return idempotency.errorResponse;
  if (idempotency.cachedResponse) return idempotency.cachedResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", requestId }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error", issues: parsed.error.issues, requestId }, { status: 400 });
  }
  const { externalReference, party, threshold, addressThreshold, countryMatch, redFlagCheck } = parsed.data;

  try {
    const input = {
      accountId: apiCtx.accountId,
      source: "PUBLIC_API" as const,
      externalReference: externalReference ?? null,
      identity: {
        name: party.name,
        address: party.address ?? null,
        city: party.city ?? null,
        country: party.country ?? null,
        contactName: party.contactName ?? null,
      },
      nameThreshold: threshold,
      addressThreshold,
      countryMatchRequired: countryMatch,
      redFlagCheckEnabled: redFlagCheck,
    };

    const runResult = await runRestrictedPartyScreening(input);
    const persisted = await persistScreeningRun(input, runResult);

    await createAuditLog({
      accountId: apiCtx.accountId,
      userId: null,
      action: AuditAction.RESTRICTED_PARTY_SCREENING_QUERIED,
      entity: "RestrictedPartyScreeningResult",
      entityId: runResult.correlationId,
      source: "API",
      metadata: { externalReference: externalReference ?? null, partyName: party.name },
      requestId,
    });

    const responseBody = {
      success: true,
      correlationId: runResult.correlationId,
      results: persisted.map((r) => ({
        id: r.id,
        passType: r.passType,
        status: r.status,
        hitCount: r.hitCount,
        redFlagCount: r.redFlagCount,
        matches: r.matches.map((m) => ({
          matchedName: m.matchedName,
          nameScore: m.nameScore,
          matchMethod: m.matchMethod,
          sourceList: m.sourceList,
          programCodes: m.programCodes,
          suppressedByApprovedParty: m.suppressedByApprovedParty,
        })),
        redFlagHits: r.redFlagHits.map((h) => ({ matchedWord: h.matchedWord })),
      })),
      requestId,
    };

    if (idempotency.idempotencyKey && idempotency.requestHash) {
      await persistIdempotency(apiCtx.accountId, idempotency.idempotencyKey, idempotency.requestHash, 200, responseBody);
    }

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
