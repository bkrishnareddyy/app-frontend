import crypto from "crypto";
import { AccountContext, getAccountContext, hasPermission } from "@/lib/auth";
import { runWithDataMode } from "@/lib/db";
import { buildErrorResponse, generateRequestId, handleApiError } from "./error";
import { canWrite, READ_ONLY_MESSAGE } from "./write-access";

export type AuthenticatedRouteHandler = (
  ctx: AccountContext,
  requestId: string
) => Promise<Response>;

/**
 * A permission requirement can be a single permission (back-compat with all
 * existing callers), a bare list (treated as "any of"), or an explicit
 * any/all group for routes that need to combine multiple capabilities.
 */
export type PermissionRequirement =
  | string
  | string[]
  | { any: string[] }
  | { all: string[] };

async function checkPermission(requirement: PermissionRequirement): Promise<boolean> {
  if (typeof requirement === "string") {
    return hasPermission(requirement);
  }

  const isAll = !Array.isArray(requirement) && "all" in requirement;
  const perms = Array.isArray(requirement)
    ? requirement
    : isAll
      ? (requirement as { all: string[] }).all
      : (requirement as { any: string[] }).any;

  for (const perm of perms) {
    const allowed = await hasPermission(perm);
    if (!isAll && allowed) return true;
    if (isAll && !allowed) return false;
  }
  return isAll;
}

function describePermission(requirement: PermissionRequirement): string {
  if (typeof requirement === "string") return requirement;
  if (Array.isArray(requirement)) return requirement.join(" or ");
  if ("all" in requirement) return requirement.all.join(" and ");
  return requirement.any.join(" or ");
}

export async function authorizeRequest(
  requiredPermission?: PermissionRequirement
): Promise<{ ctx: AccountContext | null; errorResponse: ReturnType<typeof buildErrorResponse> | null }> {
  const ctx = await getAccountContext();
  if (!ctx) {
    return {
      ctx: null,
      errorResponse: buildErrorResponse(401, "UNAUTHENTICATED", "Authentication required"),
    };
  }

  if (requiredPermission) {
    const allowed = await checkPermission(requiredPermission);
    if (!allowed) {
      return {
        ctx: null,
        errorResponse: buildErrorResponse(
          403,
          "FORBIDDEN",
          `Missing required permission: ${describePermission(requiredPermission)}`
        ),
      };
    }
  }

  return { ctx, errorResponse: null };
}

/** authorizeRequest plus the read-only role check every mutating route needs. */
export async function authorizeWrite(
  requiredPermission?: PermissionRequirement
): Promise<{ ctx: AccountContext | null; errorResponse: ReturnType<typeof buildErrorResponse> | null }> {
  const result = await authorizeRequest(requiredPermission);
  if (result.errorResponse || !result.ctx) return result;

  if (!canWrite(result.ctx)) {
    return {
      ctx: null,
      errorResponse: buildErrorResponse(403, "READ_ONLY_ROLE", READ_ONLY_MESSAGE),
    };
  }

  return result;
}

export type RouteHandlerArgs<TParams> = {
  req: Request;
  ctx: AccountContext;
  requestId: string;
  params: TParams;
};

export type PublicRouteHandlerArgs<TParams> = Omit<RouteHandlerArgs<TParams>, "ctx">;

type NextRouteContext<TParams> = { params: Promise<TParams> };

/**
 * Composes request-id generation, permission enforcement, and centralized
 * error handling around a route handler. This replaces the four manual steps
 * (generateRequestId + authorizeRequest + try/catch + handleApiError) that
 * most routes previously reimplemented — and that `handleApiError` was, as a
 * result, never actually reached by.
 *
 * export const POST = withAuthenticatedRoute(async ({ ctx, req, requestId }) => {
 *   const body = await parseAndValidateBody(req, schema, requestId);
 *   if ("response" in body) return body.response;
 *   ...
 *   return NextResponse.json({ ... });
 * }, { permission: "filings.submit" });
 */
export function withAuthenticatedRoute<TParams = Record<string, never>>(
  handler: (args: RouteHandlerArgs<TParams>) => Promise<Response>,
  options?: { permission?: PermissionRequirement; write?: boolean }
) {
  return async (req: Request, context?: NextRouteContext<TParams>): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? generateRequestId();
    const { ctx, errorResponse } = options?.write
      ? await authorizeWrite(options?.permission)
      : await authorizeRequest(options?.permission);
    if (errorResponse) return errorResponse;

    try {
      const params = context ? await context.params : ({} as TParams);
      let runner: any = null;
      try {
        runner = runWithDataMode;
      } catch {
        runner = null;
      }
      if (typeof runner === "function") {
        return await runner(ctx!.dataMode, async () => {
          return await handler({ req, ctx: ctx!, requestId, params });
        });
      }
      return await handler({ req, ctx: ctx!, requestId, params });
    } catch (error) {
      return handleApiError(error, requestId);
    }
  };
}

/**
 * Same shape as `withAuthenticatedRoute` for routes that are intentionally
 * public (health checks, public HTS/rulings reference lookups). Still
 * centralizes request-id generation and error handling so public routes
 * get a consistent error envelope instead of ad-hoc `{ error: string }`.
 */
export function withPublicRoute<TParams = Record<string, never>>(
  handler: (args: PublicRouteHandlerArgs<TParams>) => Promise<Response>
) {
  return async (req: Request, context?: NextRouteContext<TParams>): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? generateRequestId();
    try {
      const params = context ? await context.params : ({} as TParams);
      return await handler({ req, requestId, params });
    } catch (error) {
      return handleApiError(error, requestId);
    }
  };
}

/**
 * Constant-time bearer-token check against CRON_SECRET. A missing
 * CRON_SECRET always fails closed — unlike the ad-hoc per-route checks this
 * replaces, there is no "secret unset, let it through" branch.
 */
function verifyCronAuth(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;

  const authBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  if (authBuf.length !== expectedBuf.length) {
    // Compare against itself so a length mismatch doesn't short-circuit the
    // timing profile relative to a matching-length wrong guess.
    crypto.timingSafeEqual(authBuf, authBuf);
    return false;
  }
  return crypto.timingSafeEqual(authBuf, expectedBuf);
}

/**
 * For cron-triggered ingestion routes: requires a valid `Authorization:
 * Bearer <CRON_SECRET>` header on every request, POST or GET. Replaces the
 * per-route `if (cronSecret) { check } ` pattern that silently allowed any
 * caller through whenever CRON_SECRET was unset.
 */
export function withCronRoute<TParams = Record<string, never>>(
  handler: (args: PublicRouteHandlerArgs<TParams>) => Promise<Response>
) {
  return async (req: Request, context?: NextRouteContext<TParams>): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? generateRequestId();
    if (!verifyCronAuth(req)) {
      return buildErrorResponse(401, "UNAUTHORIZED", "Missing or invalid cron authorization", undefined, requestId);
    }
    try {
      const params = context ? await context.params : ({} as TParams);
      return await handler({ req, requestId, params });
    } catch (error) {
      return handleApiError(error, requestId);
    }
  };
}
