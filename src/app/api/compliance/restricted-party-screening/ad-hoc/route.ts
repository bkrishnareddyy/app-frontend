/**
 * POST /api/compliance/restricted-party-screening/ad-hoc
 *
 * Standalone, walk-up screening: a country-pair embargo check plus a
 * restricted/denied-party name screen against an identity that is not
 * (yet) a persisted Party Master record or Shipment. Backs the
 * /app/compliance/screen page. Persists an immutable
 * RestrictedPartyScreeningResult (source MANUAL) exactly like every other
 * entry point into the engine. Requires `compliance.restrictedParty.screen`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { runRestrictedPartyScreening } from "@/modules/agents/compliance/restrictedParty/restrictedPartyScreening";
import { persistScreeningRun } from "@/modules/agents/compliance/restrictedParty/persistResult";
import { checkCountryPair } from "@/modules/agents/compliance/embargo/adHocPairCheck";

const bodySchema = z.object({
  complianceCountry: z.string().min(1),
  ultimateDestination: z.string().min(1),
  referenceId: z.string().optional(),
  party: z.object({
    name: z.string().min(1),
    address: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    contactName: z.string().optional(),
  }),
  threshold: z.number().int().min(50).max(100).optional(),
  countryMatch: z.boolean().optional(),
  redFlagCheck: z.boolean().optional(),
});

export const POST = withAuthenticatedRoute(
  async ({ req, ctx, requestId }) => {
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
    const { complianceCountry, ultimateDestination, referenceId, party, threshold, countryMatch, redFlagCheck } =
      parsed.data;

    const embargo = await checkCountryPair(complianceCountry, ultimateDestination);

    const input = {
      accountId: ctx.accountId,
      source: "MANUAL" as const,
      externalReference: referenceId ?? null,
      identity: {
        name: party.name,
        address: party.address ?? null,
        city: party.city ?? null,
        country: party.country ?? null,
        contactName: party.contactName ?? null,
      },
      nameThreshold: threshold,
      countryMatchRequired: countryMatch,
      redFlagCheckEnabled: redFlagCheck,
    };

    const runResult = await runRestrictedPartyScreening(input);
    const persisted = await persistScreeningRun(input, runResult);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: AuditAction.RESTRICTED_PARTY_SCREENING_QUERIED,
      entity: "RestrictedPartyScreeningResult",
      entityId: runResult.correlationId,
      source: "UI",
      metadata: { externalReference: referenceId ?? null, partyName: party.name, complianceCountry, ultimateDestination },
      requestId,
    });

    return NextResponse.json(
      {
        success: true,
        requestId,
        embargo,
        party: {
          correlationId: runResult.correlationId,
          passes: persisted.map((r) => ({
            id: r.id,
            passType: r.passType,
            status: r.status,
            screenedName: r.screenedName,
            hitCount: r.hitCount,
            redFlagCount: r.redFlagCount,
            matches: r.matches.map((m) => ({
              matchedName: m.matchedName,
              matchedAddress: m.matchedAddress,
              nameScore: m.nameScore,
              matchMethod: m.matchMethod,
              countryMatch: m.countryMatch,
              sourceList: m.sourceList,
              entityType: m.entityType,
              programCodes: m.programCodes,
              citation: m.citation,
              agency: m.agency,
              effectiveDate: m.effectiveDate,
              expirationDate: m.expirationDate,
              listDate: m.screeningEntity.sourcePublishedAt,
            })),
            redFlagHits: r.redFlagHits.map((h) => ({ matchedWord: h.matchedWord })),
          })),
        },
      },
      { status: 200 }
    );
  },
  { permission: "compliance.restrictedParty.screen", write: true }
);
