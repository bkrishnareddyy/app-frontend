import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { FILING_CONFIG_TABLES, DuplicateConfigRowError, ConfigRowNotFoundError, isFilingConfigTableKey } from "@/modules/filingConfig/registry";

type Params = { table: string; id: string };

function requirePlatformAdmin(isPlatformAdmin: boolean, requestId: string) {
  if (!isPlatformAdmin) {
    return buildErrorResponse(403, "FORBIDDEN", "Filing configuration is available to Platform Admins only.", undefined, requestId);
  }
  return null;
}

export const PATCH = withAuthenticatedRoute<Params>(async ({ req, ctx, params, requestId }) => {
  const forbidden = requirePlatformAdmin(ctx.isPlatformAdmin, requestId);
  if (forbidden) return forbidden;

  if (!isFilingConfigTableKey(params.table)) {
    return buildErrorResponse(404, "UNKNOWN_TABLE", `Unknown filing config table "${params.table}".`, undefined, requestId);
  }
  const table = FILING_CONFIG_TABLES[params.table];

  const body = await parseAndValidateBody(req, table.updateSchema, requestId);
  if ("response" in body) return body.response;

  try {
    const row = await table.update(params.id, body.data as Record<string, unknown>);
    return NextResponse.json({ row, requestId });
  } catch (err) {
    if (err instanceof DuplicateConfigRowError) {
      return buildErrorResponse(409, "DUPLICATE_ROW", err.message, undefined, requestId);
    }
    if (err instanceof ConfigRowNotFoundError) {
      return buildErrorResponse(404, "NOT_FOUND", err.message, undefined, requestId);
    }
    throw err;
  }
}, { write: true });

export const DELETE = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const forbidden = requirePlatformAdmin(ctx.isPlatformAdmin, requestId);
  if (forbidden) return forbidden;

  if (!isFilingConfigTableKey(params.table)) {
    return buildErrorResponse(404, "UNKNOWN_TABLE", `Unknown filing config table "${params.table}".`, undefined, requestId);
  }
  const table = FILING_CONFIG_TABLES[params.table];

  try {
    await table.remove(params.id);
    return NextResponse.json({ requestId });
  } catch (err) {
    if (err instanceof ConfigRowNotFoundError) {
      return buildErrorResponse(404, "NOT_FOUND", err.message, undefined, requestId);
    }
    throw err;
  }
}, { write: true });
