import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId , errorMessage } from "@/lib/api/error";
import { validateQueryParams } from "@/lib/api/validation";
import { ExceptionService } from "@/modules/exceptions/exception.service";
import { z } from "zod";

const querySchema = z.object({
  status: z.string().optional(),
  severity: z.string().optional(),
  assignedToMe: z.string().optional().transform((val) => val === "true"),
});

export async function GET(req: Request) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  const queryVal = validateQueryParams(req.url, querySchema, requestId);
  if ("response" in queryVal) return queryVal.response;

  try {
    const result = await ExceptionService.listExceptions(ctx!.accountId, ctx!.userId, queryVal.data);
    return NextResponse.json({ exceptions: result.exceptions, metadata: result.metadata, requestId });
  } catch (error: unknown) {
    return buildErrorResponse(500, "INTERNAL_ERROR", errorMessage(error) || "Failed to fetch exceptions", undefined, requestId);
  }
}
