/**
 * Compliance tools that answer reference-data questions without pretending a
 * shipment exists. Country-pair screening delegates to the same deterministic
 * matcher used by the Compliance Agent; the Copilot only projects its result.
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { doEmbargoCheck } from "@/modules/agents/compliance/embargo/doEmbargoCheck";
import { getAccountEmbargoConfig } from "@/modules/agents/compliance/embargo/embargoRepository";
import {
  rescreenParty,
  PartyHasNoActiveNameError,
} from "@/modules/agents/compliance/restrictedParty/partyScreeningLifecycle";
import { runRestrictedPartyScreening } from "@/modules/agents/compliance/restrictedParty/restrictedPartyScreening";
import { persistScreeningRun } from "@/modules/agents/compliance/restrictedParty/persistResult";
import { partyDisplayName } from "@/modules/party/partyDisplay";
import { defineTool } from "../copilotToolTypes";
import { params, stringParam } from "../copilotToolSchema";

const COMPLIANCE_NAV = "/app/compliance";
const PARTIES_NAV = "/app/parties";

const countryPairInput = z.object({
  shipFromCountry: z.string().trim().min(2).max(80),
  shipToCountry: z.string().trim().min(2).max(80),
});

export const getCountryEmbargoScreeningTool = defineTool<z.infer<typeof countryPairInput>>({
  name: "getCountryEmbargoScreening",
  description:
    "Screen a hypothetical export country pair directly against Qubere's deterministic embargo reference data. Use this when the user names a ship-from/compliance country and a ship-to/destination country but does not name a shipment. Do not search shipments for this question.",
  progressLabel: "Checking country embargo",
  access: { navHref: COMPLIANCE_NAV },
  input: countryPairInput,
  parameters: params(
    {
      shipFromCountry: stringParam("Ship-from or compliance country name/code, for example US."),
      shipToCountry: stringParam("Ship-to or destination country name/code, for example Iran."),
    },
    ["shipFromCountry", "shipToCountry"]
  ),

  async execute(ctx, input) {
    const accountConfig = await getAccountEmbargoConfig(ctx.actor.accountId);

    if (!accountConfig.embargoScreeningEnabled) {
      return {
        ok: true,
        data: {
          status: "SKIPPED",
          screeningPerformed: false,
          isEmbargoed: null,
          shipFromCountry: input.shipFromCountry,
          shipToCountry: input.shipToCountry,
          reason: "EMBARGO_SCREENING_DISABLED",
          scope: "COUNTRY_PAIR_ONLY",
          scopeNote:
            "Account-level embargo screening is disabled. No country-pair verdict was produced.",
        },
      };
    }

    const checkedAt = new Date();
    const check = await doEmbargoCheck({
      accountId: ctx.actor.accountId,
      // The matcher contract carries shipmentId for shipment audit context, but
      // this read-only Copilot check does not persist an audit header or line.
      shipmentId: "copilot-country-pair",
      screeningLevel: "TRANSACTION",
      complianceCountry: input.shipFromCountry,
      targetCountry: input.shipToCountry,
      type: "D",
      screeningDate: checkedAt,
      accountConfig,
    });

    const evidence = check.evidence ?? {};
    return {
      ok: true,
      data: {
        status: check.result,
        screeningPerformed: check.result !== "SKIPPED",
        isEmbargoed:
          check.result === "HIT" ? true : check.result === "CLEAR" ? false : null,
        shipFromCountry: check.complianceCountry,
        shipToCountry: check.screenedCountry,
        direction: "DESTINATION",
        matcher: check.matcher,
        reason: check.reason ?? null,
        referenceRuleId: check.ruleId ?? null,
        sanctionIndicators: {
          national: evidence.nationalSanction ?? null,
          eu: evidence.euSanction ?? null,
          un: evidence.unSanction ?? null,
        },
        checkedAt: checkedAt.toISOString(),
        scope: "COUNTRY_PAIR_ONLY",
        scopeNote:
          "This checks only the named country pair. It does not screen transaction parties, goods, HTS classifications, ECCNs, end use, licences, or shipment-specific facts.",
      },
    };
  },
});

const screenRestrictedPartyInput = z.object({
  partyId: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  contactName: z.string().trim().max(200).optional(),
});

export const screenRestrictedPartyTool = defineTool<z.infer<typeof screenRestrictedPartyInput>>({
  name: "screenRestrictedParty",
  description:
    "Screen a party against restricted/denied-party denial-order lists (OFAC SDN, BIS DPL, and related lists) plus Know-Your-Customer red-flag words. Pass an existing partyId to rescreen a Party Master record's current name/address/contact, or pass ad-hoc name/address/country/contactName fields to screen a hypothetical identity that is not in Party Master. Never fabricate a match, citation, or clearance -- only report what this tool returns.",
  progressLabel: "Screening restricted party",
  access: { permission: "compliance.restrictedParty.screen" },
  input: screenRestrictedPartyInput,
  parameters: params(
    {
      partyId: stringParam("An existing Qubere party id to rescreen using its current Party Master identity. Omit to screen ad-hoc fields instead."),
      name: stringParam("Party name to screen. Required when partyId is omitted."),
      address: stringParam("Street address, if known."),
      city: stringParam("City, if known."),
      country: stringParam("Country, if known."),
      contactName: stringParam("A named contact for this party, if known. Screened as an independent pass."),
    },
    []
  ),

  async execute(ctx, input) {
    if (input.partyId) {
      const party = await db.party.findFirst({
        where: { id: input.partyId, accountId: ctx.actor.accountId },
        select: { id: true, internalPartyCode: true, names: { select: { rawName: true, isPrimary: true, nameType: true } } },
      });
      if (!party) {
        return { ok: false, code: "NOT_FOUND", message: "No such party in this account." };
      }

      try {
        const { overallStatus, results } = await rescreenParty(ctx.actor.accountId, party.id);
        const label = partyDisplayName(party);
        ctx.ledger.recordEntity("PARTY", party.id, label);

        return {
          ok: true,
          data: {
            partyId: party.id,
            overallStatus,
            results: results.map((r) => ({
              passType: r.passType,
              status: r.status,
              hitCount: r.hitCount,
              redFlagCount: r.redFlagCount,
              matches: r.matches
                .filter((m) => !m.suppressedByApprovedParty)
                .map((m) => ({
                  matchedName: m.matchedName,
                  nameScore: m.nameScore,
                  matchMethod: m.matchMethod,
                  sourceList: m.sourceList,
                  programCodes: m.programCodes,
                })),
              redFlagHits: r.redFlagHits.map((h) => ({ matchedWord: h.matchedWord })),
            })),
          },
        };
      } catch (error) {
        if (error instanceof PartyHasNoActiveNameError) {
          return { ok: false, code: "INVALID_ARGUMENTS", message: error.message };
        }
        throw error;
      }
    }

    if (!input.name) {
      return {
        ok: false,
        code: "INVALID_ARGUMENTS",
        message: "Either partyId or name must be provided.",
      };
    }

    const screeningInput = {
      accountId: ctx.actor.accountId,
      source: "COPILOT" as const,
      identity: {
        name: input.name,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        contactName: input.contactName ?? null,
      },
    };

    const runResult = await runRestrictedPartyScreening(screeningInput);
    const persisted = await persistScreeningRun(screeningInput, runResult);

    return {
      ok: true,
      data: {
        correlationId: runResult.correlationId,
        results: persisted.map((r) => ({
          screeningId: r.id,
          passType: r.passType,
          status: r.status,
          hitCount: r.hitCount,
          redFlagCount: r.redFlagCount,
          matches: r.matches
            .filter((m) => !m.suppressedByApprovedParty)
            .map((m) => ({
              matchedName: m.matchedName,
              nameScore: m.nameScore,
              matchMethod: m.matchMethod,
              sourceList: m.sourceList,
              programCodes: m.programCodes,
            })),
          redFlagHits: r.redFlagHits.map((h) => ({ matchedWord: h.matchedWord })),
        })),
      },
    };
  },
});

const partyIdOnlyInput = z.object({ partyId: z.string().trim().min(1).max(64) });

const screeningIdInput = z.object({ screeningId: z.string().trim().min(1).max(64) });

export const getRestrictedPartyScreeningDetailsTool = defineTool<z.infer<typeof screeningIdInput>>({
  name: "getRestrictedPartyScreeningDetails",
  description:
    "Full detail for one persisted restricted/denied-party screening result: the screened identity, thresholds used, matched denial-order entries, and red-flag hits. Requires a screeningId returned by screenRestrictedParty or by a party's screening history.",
  progressLabel: "Reading screening result",
  access: { permission: "compliance.restrictedParty.read" },
  input: screeningIdInput,
  parameters: params({ screeningId: stringParam("The Qubere restricted-party screening result id.") }, ["screeningId"]),

  async execute(ctx, input) {
    const result = await db.restrictedPartyScreeningResult.findFirst({
      where: { id: input.screeningId, accountId: ctx.actor.accountId },
      include: { matches: true, redFlagHits: true, disposition: true },
    });
    if (!result) {
      return { ok: false, code: "NOT_FOUND", message: "No such screening result in this account." };
    }

    if (result.partyId) {
      ctx.ledger.recordEntity("PARTY", result.partyId, result.screenedName);
    }

    return {
      ok: true,
      data: {
        screeningId: result.id,
        source: result.source,
        passType: result.passType,
        screenedName: result.screenedName,
        screenedAddress: result.screenedAddress,
        screenedCity: result.screenedCity,
        screenedCountry: result.screenedCountry,
        nameThreshold: result.nameThreshold,
        countryMatchRequired: result.countryMatchRequired,
        status: result.status,
        screeningDate: result.screeningDate.toISOString(),
        matches: result.matches.map((m) => ({
          matchedName: m.matchedName,
          nameScore: m.nameScore,
          matchMethod: m.matchMethod,
          sourceList: m.sourceList,
          programCodes: m.programCodes,
          suppressedByApprovedParty: m.suppressedByApprovedParty,
        })),
        redFlagHits: result.redFlagHits.map((h) => ({ matchedWord: h.matchedWord })),
        disposition: result.disposition
          ? { status: result.disposition.status, reviewedAt: result.disposition.reviewedAt?.toISOString() ?? null, notes: result.disposition.notes }
          : null,
      },
    };
  },
});

export const getPartyRestrictedPartyScreeningHistoryTool = defineTool<z.infer<typeof partyIdOnlyInput>>({
  name: "getPartyRestrictedPartyScreeningHistory",
  description:
    "The current restricted/denied-party screening status and screening history for one Party Master record. Use this to answer questions like 'when was this party last screened' or 'has this party ever hit a denial list'.",
  progressLabel: "Reading party screening history",
  access: { navHref: PARTIES_NAV, permission: "compliance.restrictedParty.read" },
  input: partyIdOnlyInput,
  parameters: params({ partyId: stringParam("The Qubere party id.") }, ["partyId"]),

  async execute(ctx, input) {
    const party = await db.party.findFirst({
      where: { id: input.partyId, accountId: ctx.actor.accountId },
      select: { id: true, internalPartyCode: true, names: { select: { rawName: true, isPrimary: true, nameType: true } } },
    });
    if (!party) {
      return { ok: false, code: "NOT_FOUND", message: "No such party in this account." };
    }

    const label = partyDisplayName(party);
    ctx.ledger.recordEntity("PARTY", party.id, label);

    const [summary, results] = await Promise.all([
      db.partyScreeningSummary.findUnique({ where: { partyId: party.id } }),
      db.restrictedPartyScreeningResult.findMany({
        where: { partyId: party.id, accountId: ctx.actor.accountId },
        orderBy: { screeningDate: "desc" },
        take: 20,
      }),
    ]);

    return {
      ok: true,
      data: {
        partyId: party.id,
        currentStatus: summary?.screeningStatus ?? null,
        lastScreenedAt: summary?.lastScreenedAt?.toISOString() ?? null,
        history: results.map((r) => ({
          screeningId: r.id,
          passType: r.passType,
          status: r.status,
          hitCount: r.hitCount,
          redFlagCount: r.redFlagCount,
          screeningDate: r.screeningDate.toISOString(),
        })),
      },
    };
  },
});

export const complianceTools = [
  getCountryEmbargoScreeningTool,
  screenRestrictedPartyTool,
  getRestrictedPartyScreeningDetailsTool,
  getPartyRestrictedPartyScreeningHistoryTool,
];
