/**
 * Compliance tools that answer reference-data questions without pretending a
 * shipment exists. Country-pair screening delegates to the same deterministic
 * matcher used by the Compliance Agent; the Copilot only projects its result.
 */

import { z } from "zod";
import { doEmbargoCheck } from "@/modules/agents/compliance/embargo/doEmbargoCheck";
import { getAccountEmbargoConfig } from "@/modules/agents/compliance/embargo/embargoRepository";
import { defineTool } from "../copilotToolTypes";
import { params, stringParam } from "../copilotToolSchema";

const COMPLIANCE_NAV = "/app/compliance";

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

export const complianceTools = [getCountryEmbargoScreeningTool];
