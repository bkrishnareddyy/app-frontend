import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extracts a displayable message from a value caught in a `catch` block.
 *
 * `catch` binds `unknown`, and a thrown non-Error (a string, a rejected fetch
 * value) has no `.message`. This keeps the previous behaviour of every call site
 * exactly: a non-empty `Error.message` wins, anything else falls back.
 *
 * Deliberately separate from `errorMessage` in `lib/api/error.ts`, which is
 * server-only -- that module imports NextResponse and zod, so a client component
 * importing it would pull server code into the browser bundle.
 */
export function caughtMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    day: "numeric",
  });
}
