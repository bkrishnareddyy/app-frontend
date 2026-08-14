// Country Embargo Screening -- audit persistence.
//
// Qubere-native equivalent of the source SERVICE_USAGE / SERVICE_USAGE_LINES
// header+detail audit pattern (EmbargoUsageHeader / EmbargoUsageLine models).
// One header per screening invocation; detail lines only when detailed audit
// is enabled for the account. Kept isolated from matcher/screening logic so
// audit writes are never scattered through business-rule code, and so audit
// persistence failures never turn a real screening determination into CLEAR.
import { db } from "@/lib/db";
import { logAgentError } from "@/modules/agents/agentLogger";
import type { AccountEmbargoConfig, EmbargoCheckResult, AuditResultCode } from "./types";
import type { Prisma } from "@prisma/client";

export interface EmbargoAuditContext {
  usageId?: string;
  audited: boolean;
  writeDetailedLines: boolean;
}

export function buildEmbargoAuditContext(accountConfig: AccountEmbargoConfig): EmbargoAuditContext {
  return {
    audited: accountConfig.audited,
    writeDetailedLines: accountConfig.emailAlertEnabled || accountConfig.generalAuditLogEnabled,
  };
}

/** Creates exactly one usage header for the screening invocation, if the account is audited. Never one per check. */
export async function createEmbargoUsageHeader(params: {
  accountId: string;
  shipmentId: string;
  transactionId?: string;
  correlationId?: string;
}): Promise<string | null> {
  try {
    const header = await db.embargoUsageHeader.create({
      data: {
        accountId: params.accountId,
        shipmentId: params.shipmentId,
        transactionId: params.transactionId ?? null,
        correlationId: params.correlationId ?? null,
        screeningType: "COUNTRY_EMBARGO",
      },
    });
    return header.id;
  } catch (err) {
    logAgentError("Compliance Agent", params.shipmentId, "createEmbargoUsageHeader", err);
    return null;
  }
}

function resultCode(result: EmbargoCheckResult["result"]): AuditResultCode | null {
  // SKIPPED/ERROR must never be persisted as P -- only completed checks get a code.
  if (result === "CLEAR") return "P";
  if (result === "HIT") return "F";
  return null;
}

/** Writes one detail row per completed (non-SKIPPED/non-ERROR) check. Batched insert. */
export async function createEmbargoUsageLines(
  headerId: string,
  accountId: string,
  checks: EmbargoCheckResult[]
): Promise<number> {
  const rows = checks
    .map((check) => {
      const code = resultCode(check.result);
      if (!code) return null;
      const data: Prisma.EmbargoUsageLineCreateManyInput = {
        headerId,
        accountId,
        shipmentId: check.context.shipmentId,
        transactionId: check.context.transactionId ?? null,
        partyId: check.context.partyId ?? null,
        lineItemId: check.context.lineItemId ?? null,
        userDefined: check.context.userDefined ?? null,
        exceptionType: "EM",
        screeningLevel: check.screeningLevel,
        type: check.type,
        complianceCountry: check.complianceCountry,
        screenedCountry: check.screenedCountry,
        eccn: check.eccn ?? null,
        militaryEndUse: check.militaryEndUse ?? null,
        matcher: check.matcher,
        ruleId: check.ruleId ?? null,
        result: code,
        evidence: (check.evidence ?? {}) as Prisma.InputJsonValue,
      };
      return data;
    })
    .filter((row): row is Prisma.EmbargoUsageLineCreateManyInput => row !== null);

  if (rows.length === 0) return 0;

  try {
    const created = await db.embargoUsageLine.createMany({ data: rows });
    return created.count;
  } catch (err) {
    logAgentError("Compliance Agent", rows[0].shipmentId, "createEmbargoUsageLines", err);
    return 0;
  }
}
