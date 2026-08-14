// Country Embargo Screening -- shared read/presentation layer over persisted
// evidence.
//
// Country Embargo Screening (countryEmbargoScreening.ts) is a deterministic
// engine, never an LLM. Every "Compliance Agent" pipeline run persists its
// full CountryEmbargoScreeningResult as
// AgentDecision.evidenceItems.countryEmbargoScreening (complianceAuditAgent.ts).
//
// This module is the single place that reads and shapes that evidence for
// presentation to a caller -- it never re-derives or guesses an embargo
// determination itself. Both the Qubere chat assistant
// (src/modules/assistant/tools.ts) and the partner-facing v1 API
// (src/app/api/v1/compliance/embargo-screening/route.ts) call into this
// module so the two surfaces can never drift apart on status semantics,
// audit-count/finding-count conflation, or party-screening honesty.
import { db } from "@/lib/db";
import type { CountryEmbargoScreeningResult, EmbargoCheckResult } from "./types";

export async function resolveOwnedShipmentId(
  accountId: string,
  shipmentIdOrNumber: string
): Promise<{ id: string; shipmentNumber: string } | null> {
  return db.shipment.findFirst({
    where: {
      accountId,
      OR: [{ id: shipmentIdOrNumber }, { shipmentNumber: shipmentIdOrNumber }],
    },
    select: { id: true, shipmentNumber: true },
  });
}

export async function latestEmbargoScreening(
  accountId: string,
  shipmentId: string
): Promise<{ decisionId: string; screenedAt: string; screening: CountryEmbargoScreeningResult } | null> {
  const decision = await db.agentDecision.findFirst({
    where: { accountId, shipmentId, agentName: "Compliance Agent" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, evidenceItems: true },
  });
  const screening = (
    decision?.evidenceItems as { countryEmbargoScreening?: CountryEmbargoScreeningResult } | null | undefined
  )?.countryEmbargoScreening;
  if (!decision || !screening) return null;
  return { decisionId: decision.id, screenedAt: decision.createdAt.toISOString(), screening };
}

// The deterministic engine only reports PARTIAL when a run produced both a HIT
// and an ERROR (countryEmbargoScreening.ts) -- it does not currently downgrade
// an otherwise-clean CLEAR run that skipped one or more checks (e.g. a party
// with no country on file). What's told to any caller must reflect that gap,
// so the presented status is computed here rather than trusted verbatim -- the
// engine's own status is still returned unchanged alongside it so nothing is
// hidden.
export function presentedStatus(screening: CountryEmbargoScreeningResult): CountryEmbargoScreeningResult["status"] {
  if (screening.status === "CLEAR" && screening.skippedChecks.length > 0) return "PARTIAL";
  return screening.status;
}

export function summarizeHit(hit: CountryEmbargoScreeningResult["hits"][number]) {
  return {
    screeningLevel: hit.screeningLevel,
    type: hit.type,
    complianceCountry: hit.complianceCountry,
    country: hit.country,
    matcher: hit.matcher,
    reason: hit.reason,
    ruleId: hit.ruleId ?? null,
    partyId: hit.partyId ?? null,
    lineItemId: hit.lineItemId ?? null,
  };
}

export interface EmbargoScreeningDetailsFilters {
  lineItemId?: string;
  partyId?: string;
  screeningLevel?: EmbargoCheckResult["screeningLevel"];
  type?: EmbargoCheckResult["type"];
  result?: EmbargoCheckResult["result"];
}

export function buildScreeningDetails(
  shipment: { id: string; shipmentNumber: string },
  evidence: { screenedAt: string; screening: CountryEmbargoScreeningResult } | null,
  filters: EmbargoScreeningDetailsFilters = {}
) {
  if (!evidence) {
    return {
      shipmentId: shipment.id,
      shipmentNumber: shipment.shipmentNumber,
      screeningPerformed: false as const,
      message: "No Country Embargo Screening result is available for this shipment yet.",
    };
  }

  const { screening } = evidence;
  const { lineItemId, partyId, screeningLevel, type, result } = filters;
  const matchesFilter = (c: EmbargoCheckResult) =>
    (!lineItemId || c.context.lineItemId === lineItemId) &&
    (!partyId || c.context.partyId === partyId) &&
    (!screeningLevel || c.screeningLevel === screeningLevel) &&
    (!type || c.type === type) &&
    (!result || c.result === result);

  const filteredChecks = screening.checks.filter(matchesFilter);
  const partyChecks = screening.checks.filter((c) => c.screeningLevel === "PARTY");
  const partySkips = screening.skippedChecks.filter((s) => s.screeningLevel === "PARTY");

  return {
    shipmentId: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    screeningPerformed: true as const,
    screenedAt: evidence.screenedAt,
    engineStatus: screening.status,
    status: presentedStatus(screening),
    // Audit line counts (how many checks ran, P/F) are distinct from finding
    // counts (deduplicated hits) -- never conflate the two when presenting.
    auditSummary: {
      totalChecksPerformed: screening.checks.length,
      passed: screening.checks.filter((c) => c.result === "CLEAR").length,
      failed: screening.checks.filter((c) => c.result === "HIT").length,
      skipped: screening.skippedChecks.length,
      errored: screening.checks.filter((c) => c.result === "ERROR").length,
    },
    findingCount: screening.hits.length,
    partiesScreenedCount: partyChecks.length,
    partySkipReasons: partySkips,
    partyScreeningNote:
      partyChecks.length === 0 && partySkips.length === 0
        ? "No transaction parties were available on this shipment to screen."
        : null,
    matchingChecks: filteredChecks.map((c) => ({
      screeningLevel: c.screeningLevel,
      type: c.type,
      result: c.result,
      complianceCountry: c.complianceCountry,
      screenedCountry: c.screenedCountry,
      matcher: c.matcher,
      reason: c.reason ?? null,
      ruleId: c.ruleId ?? null,
      partyId: c.context.partyId ?? null,
      lineItemId: c.context.lineItemId ?? null,
      eccn: c.eccn ?? null,
    })),
    hits: screening.hits.map(summarizeHit),
    skippedChecks: screening.skippedChecks,
    errors: screening.errors,
  };
}

export function buildScreeningResult(
  shipment: { id: string; shipmentNumber: string },
  evidence: { screenedAt: string; screening: CountryEmbargoScreeningResult } | null,
  opts: { rescreened: boolean; rescreenDenied: boolean }
) {
  if (!evidence) {
    return {
      shipmentId: shipment.id,
      shipmentNumber: shipment.shipmentNumber,
      screeningPerformed: false as const,
      status: "NOT_SCREENED" as const,
      message: opts.rescreenDenied
        ? "This shipment has never been screened, and rerunning embargo screening requires a permission/scope this caller does not have."
        : "No Country Embargo Screening result is available for this shipment yet.",
    };
  }

  const { screening } = evidence;
  return {
    shipmentId: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    screeningPerformed: true as const,
    rescreened: opts.rescreened,
    ...(opts.rescreenDenied && {
      rescreenDenied: true,
      message:
        "Rerunning embargo screening requires a permission/scope this caller does not have -- showing the most recent result instead.",
    }),
    screenedAt: evidence.screenedAt,
    engineStatus: screening.status,
    status: presentedStatus(screening),
    checksPerformed: screening.checks.length,
    hitCount: screening.hits.length,
    hits: screening.hits.map(summarizeHit),
    skippedCheckCount: screening.skippedChecks.length,
    skippedChecks: screening.skippedChecks,
    errorCount: screening.errors.length,
    errors: screening.errors,
  };
}
