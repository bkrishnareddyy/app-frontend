/**
 * The Copilot tool registry.
 *
 * This list is the entire surface the model can reach. It is a closed
 * enumeration, not a discovery mechanism: there is no dynamic registration, no
 * plugin loading, and no tool that takes a query language, a URL, a path or a
 * command. Everything the Copilot can do to the account's data is visible by
 * reading this file and the six modules it imports.
 *
 * Every tool is read-only. Nothing here creates, updates, approves, rejects,
 * submits, deletes or closes anything, which is why the API route that drives
 * the Copilot is registered as a read.
 */

import type { AnyCopilotTool } from "./copilotToolTypes";
import { productTools } from "./tools/productTools";
import { partyTools } from "./tools/partyTools";
import { shipmentTools } from "./tools/shipmentTools";
import { documentTools } from "./tools/documentTools";
import { workTools } from "./tools/workTools";
import { complianceTools } from "./tools/complianceTools";

export const COPILOT_TOOLS: readonly AnyCopilotTool[] = [
  ...productTools,
  ...partyTools,
  ...shipmentTools,
  ...documentTools,
  ...workTools,
  ...complianceTools,
];

const BY_NAME = new Map(COPILOT_TOOLS.map((tool) => [tool.name, tool]));

/** Null for a name the model invented, which the executor reports as an error. */
export function findTool(name: string): AnyCopilotTool | null {
  return BY_NAME.get(name) ?? null;
}

export const COPILOT_TOOL_NAMES: readonly string[] = COPILOT_TOOLS.map((tool) => tool.name);
