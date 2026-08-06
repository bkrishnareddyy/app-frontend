import { AccountContext, getAccountContext, hasPermission } from "@/lib/auth";
import { buildErrorResponse } from "./error";

export type AuthenticatedRouteHandler = (
  ctx: AccountContext,
  requestId: string
) => Promise<Response>;

export async function authorizeRequest(
  requiredPermission?: string
): Promise<{ ctx: AccountContext | null; errorResponse: ReturnType<typeof buildErrorResponse> | null }> {
  const ctx = await getAccountContext();
  if (!ctx) {
    return {
      ctx: null,
      errorResponse: buildErrorResponse(401, "UNAUTHENTICATED", "Authentication required"),
    };
  }

  if (requiredPermission) {
    const allowed = await hasPermission(requiredPermission);
    if (!allowed) {
      return {
        ctx: null,
        errorResponse: buildErrorResponse(
          403,
          "FORBIDDEN",
          `Missing required permission: ${requiredPermission}`
        ),
      };
    }
  }

  return { ctx, errorResponse: null };
}
