import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validateQueryParams } from "@/lib/api/validation";
import { ExceptionService } from "@/modules/exceptions/exception.service";
import { parsePagination } from "@/lib/api/pagination";
import { z } from "zod";

const querySchema = z.object({
  status: z.string().optional(),
  severity: z.string().optional(),
  assignedToMe: z.string().optional().transform((val) => val === "true"),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export const GET = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const queryVal = validateQueryParams(req.url, querySchema, requestId);
  if ("response" in queryVal) return queryVal.response;

  const { searchParams } = new URL(req.url);
  const { limit, cursor } = parsePagination(searchParams);

  const result = await ExceptionService.listExceptions(ctx.accountId, ctx.userId, queryVal.data, { limit, cursor });
  return NextResponse.json({ exceptions: result.exceptions, metadata: result.metadata, pagination: result.pagination, requestId });
});
