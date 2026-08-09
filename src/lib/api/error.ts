import { NextResponse } from "next/server";
import { ZodError } from "zod";

export interface ApiErrorDetails {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

export interface ApiErrorEnvelope {
  error: ApiErrorDetails;
}

export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * An error whose message is safe to return to the caller. Anything not thrown as a
 * DomainError is treated as incidental (Prisma, network, bugs) and reported generically,
 * so internal detail is never disclosed.
 */
export class DomainError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, code: string = "DOMAIN_ERROR", status: number = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.code = code;
  }
}

export function buildErrorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  requestId: string = generateRequestId()
): NextResponse<ApiErrorEnvelope> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details,
        requestId,
      },
    },
    { status }
  );
}

export function handleApiError(error: unknown, requestId: string = generateRequestId()): NextResponse<ApiErrorEnvelope> {
  if (error instanceof ZodError) {
    return buildErrorResponse(
      400,
      "INVALID_INPUT",
      "Request validation failed",
      error.issues.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
      requestId
    );
  }

  const errMessage = error instanceof Error ? error.message : "An unexpected server error occurred";
  if (errMessage.includes("DYNAMIC_SERVER_USAGE")) {
    throw error;
  }

  if (error instanceof DomainError) {
    return buildErrorResponse(error.status, error.code, error.message, undefined, requestId);
  }

  console.error(`[API Error] [${requestId}]`, error);
  return buildErrorResponse(500, "INTERNAL_ERROR", "Internal server error", undefined, requestId);
}

/**
 * Extracts a string message from an unknown caught value.
 * Use in catch blocks typed as `unknown` to avoid `no-explicit-any`.
 */
export function errorMessage(error: unknown, fallback = "An unexpected error occurred"): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}
