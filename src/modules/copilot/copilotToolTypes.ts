/**
 * What a Copilot tool is, and what it is allowed to be.
 *
 * A tool is a named, schema-bounded call onto a Qubere service that the caller
 * could already have made through the UI. That framing decides the shape:
 *
 *   - `input` is a zod schema, validated server-side before execution. Arguments
 *     a model invents that are not in the schema are rejected, not passed
 *     through.
 *   - `access` names the same nav route or permission that gates the equivalent
 *     screen, so Copilot can never be a softer door than the app itself.
 *   - `execute` receives an actor built from the session — never from arguments.
 *     There is no accountId parameter on any tool, so there is nothing to forge.
 *   - the result is a plain object bounded by copilotConfig limits, and every
 *     record it names is written to the grounding ledger as it is built.
 *
 * There is no tool that takes SQL, a URL, a file path, a shell command, or a
 * table name. That is a property of this registry, not a filter over it.
 */

import type { z } from "zod";
import type { Schema } from "@google/genai";
import type { AccountContext } from "@/lib/auth";
import type { CopilotLedger } from "./copilotLedger";

/** Who is asking, resolved from the session. Never assembled from model input. */
export interface CopilotActor {
  accountId: string;
  userId: string;
  requestId: string;
  /** The full context, for the permission mirrors the domain actors expect. */
  context: AccountContext;
}

export interface CopilotToolRunContext {
  actor: CopilotActor;
  ledger: CopilotLedger;
}

/**
 * How a tool is gated.
 *
 * `navHref` reuses `canAccessHref` from src/lib/navigation.ts, which is the same
 * function the sidebar and the routed pages use. A tool gated this way is
 * available exactly when the corresponding screen is.
 *
 * `permission` is for capabilities with a catalogued permission of their own.
 *
 * Omitting both means "any authenticated member of the account", which is what
 * the Exceptions, Decisions and Actions pages already are.
 */
export interface CopilotToolAccess {
  navHref?: string;
  permission?: string;
}

export type CopilotToolResult =
  | { ok: true; data: unknown }
  | { ok: false; code: CopilotToolErrorCode; message: string };

export type CopilotToolErrorCode =
  | "NOT_FOUND"
  | "NOT_AUTHORIZED"
  | "INVALID_ARGUMENTS"
  | "UNAVAILABLE"
  | "LIMIT_EXCEEDED";

export interface CopilotTool<TInput = unknown> {
  name: string;
  /** Read by the model to choose the tool. Describes data, never behaviour. */
  description: string;
  /** The declaration handed to the model. Mirrors `input`. */
  parameters: Schema;
  input: z.ZodType<TInput>;
  access?: CopilotToolAccess;
  /** Neutral progress label shown to the user, e.g. "Checking shipment". */
  progressLabel: string;
  execute(ctx: CopilotToolRunContext, input: TInput): Promise<CopilotToolResult>;
}

/** Erases the input type so tools of different shapes live in one registry. */
export type AnyCopilotTool = CopilotTool<never> & {
  input: z.ZodType<unknown>;
  execute(ctx: CopilotToolRunContext, input: never): Promise<CopilotToolResult>;
};

export function defineTool<TInput>(tool: CopilotTool<TInput>): AnyCopilotTool {
  return tool as unknown as AnyCopilotTool;
}
