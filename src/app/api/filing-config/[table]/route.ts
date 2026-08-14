import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { FILING_CONFIG_TABLES, DuplicateConfigRowError, isFilingConfigTableKey } from "@/modules/filingConfig/registry";

type Params = { table: string };

/**
 * These 7 tables are global filing config -- no accountId, shared by every
 * tenant. Gated by the PLATFORM_ADMIN role (ctx.isPlatformAdmin), not a
 * tenant permission or account type: a change here is visible to every
 * tenant immediately, so only Qubere platform admins may view or edit it.
 */
function requirePlatformAdmin(isPlatformAdmin: boolean, requestId: string) {
  if (!isPlatformAdmin) {
    return buildErrorResponse(403, "FORBIDDEN", "Filing configuration is available to Platform Admins only.", undefined, requestId);
  }
  return null;
}

export const GET = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const forbidden = requirePlatformAdmin(ctx.isPlatformAdmin, requestId);
  if (forbidden) return forbidden;

  if (!isFilingConfigTableKey(params.table)) {
    return buildErrorResponse(404, "UNKNOWN_TABLE", `Unknown filing config table "${params.table}".`, undefined, requestId);
  }
  const table = FILING_CONFIG_TABLES[params.table];
  const rows = await table.list();
  return NextResponse.json({ rows, requestId });
});

export const POST = withAuthenticatedRoute<Params>(async ({ req, ctx, params, requestId }) => {
  const forbidden = requirePlatformAdmin(ctx.isPlatformAdmin, requestId);
  if (forbidden) return forbidden;

  if (!isFilingConfigTableKey(params.table)) {
    return buildErrorResponse(404, "UNKNOWN_TABLE", `Unknown filing config table "${params.table}".`, undefined, requestId);
  }
  const table = FILING_CONFIG_TABLES[params.table];

  const body = await parseAndValidateBody(req, table.createSchema, requestId);
  if ("response" in body) return body.response;

  try {
    const row = await table.create(body.data as Record<string, unknown>);
    return NextResponse.json({ row, requestId }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateConfigRowError) {
      return buildErrorResponse(409, "DUPLICATE_ROW", err.message, undefined, requestId);
    }
    throw err;
  }
}, { write: true });
