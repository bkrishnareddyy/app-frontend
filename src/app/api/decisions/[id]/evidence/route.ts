import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId, handleApiError } from "@/lib/api/error";
import { db } from "@/lib/db";
import {
  additionalDuties,
  compareDutyRates,
  htsDigits,
} from "@/modules/decisions/classificationEvidence";

/**
 * Everything the tariff and rulings tables actually hold about the codes a
 * decision names. A code with no HTS record returns a null block rather than a
 * fabricated description or rate, so the screen can say the code is not in the
 * loaded tariff release instead of implying it was checked.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId();

  try {
    const { ctx, errorResponse } = await authorizeRequest();
    if (errorResponse) return errorResponse;
    if (!ctx) {
      return buildErrorResponse(401, "UNAUTHENTICATED", "Authentication required", requestId);
    }

    const { id } = await context.params;

    const decision = await db.agentDecision.findFirst({
      where: { id, accountId: ctx.accountId },
      select: {
        id: true,
        proposedHtsCode: true,
        currentHtsCode: true,
        proposedDescription: true,
        modelVersion: true,
        rulesApplied: true,
        regulations: true,
        dataSources: true,
      },
    });
    if (!decision) {
      return buildErrorResponse(404, "DECISION_NOT_FOUND", "Decision not found", requestId);
    }

    const proposedDigits = htsDigits(decision.proposedHtsCode);
    const currentDigits = htsDigits(decision.currentHtsCode);

    const wanted = [proposedDigits, currentDigits].filter(
      (value): value is string => value !== null
    );

    // The tariff table is reference data shared by every tenant, so it is not
    // account-scoped. The decision that named these codes was.
    const records =
      wanted.length === 0
        ? []
        : await db.hTSCode.findMany({ where: { htsCode10: { in: wanted } } });

    const byCode = new Map(records.map((r) => [r.htsCode10, r]));

    const describe = (digits: string | null, display: string | null) => {
      if (digits === null) return null;
      const record = byCode.get(digits);
      if (!record) {
        return {
          code: display,
          found: false as const,
          description: null,
          generalDutyRate: null,
          column2DutyRate: null,
          specialRatePrograms: null,
          additionalDuties: [],
          effectiveDate: null,
          expirationDate: null,
          sourceRevision: null,
        };
      }
      return {
        code: display,
        found: true as const,
        description: record.description,
        generalDutyRate: record.generalDutyRate,
        column2DutyRate: record.column2DutyRate,
        specialRatePrograms: record.specialRatePrograms,
        additionalDuties: additionalDuties(record),
        effectiveDate: record.effectiveDate.toISOString(),
        expirationDate: record.expirationDate?.toISOString() ?? null,
        sourceRevision: record.sourceRevision,
      };
    };

    const proposed = describe(proposedDigits, decision.proposedHtsCode);
    const current = describe(currentDigits, decision.currentHtsCode);

    const duty =
      proposed === null || current === null
        ? {
            comparable: false,
            deltaPercent: null,
            reason:
              proposed === null && current === null
                ? "The decision names neither a current nor a proposed code."
                : proposed === null
                ? "The decision names no proposed code."
                : "The decision names no code that the proposed code would replace.",
            current: null,
            proposed: null,
          }
        : compareDutyRates(current.generalDutyRate, proposed.generalDutyRate);

    // Rulings are linked to a code as published, with dots, so both spellings
    // are offered to the lookup rather than guessing which one was stored.
    const rulingCodes = [decision.proposedHtsCode, proposedDigits].filter(
      (value): value is string => typeof value === "string" && value !== ""
    );

    const rulings =
      rulingCodes.length === 0
        ? []
        : await db.ruling.findMany({
            where: { htsReferences: { some: { htsNumberDisplay: { in: rulingCodes } } } },
            orderBy: { issuedAt: "desc" },
            take: 10,
            select: {
              id: true,
              rulingNumber: true,
              title: true,
              issuedAt: true,
              rulingType: true,
              sourceProvider: true,
              sourceUrl: true,
              modifiedOrRevokedStatus: true,
            },
          });

    return NextResponse.json({
      decisionId: decision.id,
      proposed,
      current,
      duty,
      // GRI and other rules the agent says it applied. These are the agent's own
      // record, not a citation resolved against a stored authority.
      rulesApplied: decision.rulesApplied,
      regulations: decision.regulations,
      dataSources: decision.dataSources,
      modelVersion: decision.modelVersion,
      rulings: rulings.map((r) => ({
        ...r,
        issuedAt: r.issuedAt.toISOString(),
      })),
      requestId,
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
