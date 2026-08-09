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

/**
 * Validates a route's dynamic segments (e.g. `context.params` for `[id]`
 * folders). Every route documented as "Zod Path" in the API status tracker
 * should be running its raw params through this rather than trusting the
 * string straight out of the URL.
 */
export function validatePathParams<T>(
  params: Record<string, unknown>,
  schema: ZodSchema<T>,
  requestId: string
): { data: T } | { response: ReturnType<typeof buildErrorResponse> } {
  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      response: buildErrorResponse(
        400,
        "INVALID_PATH_PARAMS",
        "Invalid route parameters",
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

/**
 * Validates `multipart/form-data` bodies. Non-file fields are validated
 * through the given schema; the raw `FormData` is also returned so the
 * handler can pull out `File` entries (which don't round-trip cleanly
 * through zod's plain-object validation) without a second manual parse.
 */
export async function parseAndValidateFormData<T>(
  req: Request,
  schema: ZodSchema<T>,
  requestId: string
): Promise<{ data: T; formData: FormData } | { response: ReturnType<typeof buildErrorResponse> }> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return {
      response: buildErrorResponse(400, "MALFORMED_FORM_DATA", "Failed to parse multipart form data", undefined, requestId),
    };
  }

  const raw = Object.fromEntries(formData.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      response: buildErrorResponse(
        400,
        "INVALID_INPUT",
        "Invalid form data",
        result.error.issues.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
        requestId
      ),
    };
  }
  return { data: result.data, formData };
}
