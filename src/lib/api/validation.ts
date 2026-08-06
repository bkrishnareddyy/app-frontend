import { ZodSchema } from "zod";
import { buildErrorResponse } from "./error";

export async function parseAndValidateBody<T>(req: Request, schema: ZodSchema<T>, requestId: string): Promise<{ data: T } | { response: ReturnType<typeof buildErrorResponse> }> {
  try {
    const raw = await req.json();
    const result = schema.safeParse(raw);
    if (!result.success) {
      return {
        response: buildErrorResponse(
          400,
          "INVALID_INPUT",
          "Invalid request body format",
          result.error.issues.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
          requestId
        ),
      };
    }
    return { data: result.data };
  } catch {
    return {
      response: buildErrorResponse(400, "MALFORMED_JSON", "Failed to parse JSON body", undefined, requestId),
    };
  }
}

export function validateQueryParams<T>(url: string, schema: ZodSchema<T>, requestId: string): { data: T } | { response: ReturnType<typeof buildErrorResponse> } {
  const searchParams = Object.fromEntries(new URL(url).searchParams.entries());
  const result = schema.safeParse(searchParams);
  if (!result.success) {
    return {
      response: buildErrorResponse(
        400,
        "INVALID_QUERY_PARAMS",
        "Invalid query parameters",
        result.error.issues.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
        requestId
      ),
    };
  }
  return { data: result.data };
}
