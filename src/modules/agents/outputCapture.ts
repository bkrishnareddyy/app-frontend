import { FactService, RecordFactInput } from "@/modules/shipment/factService";

const DEFAULT_EXCLUDE = new Set(["agentDecisionId", "debugError"]);

function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    return json === "{}" || json === "[]" ? null : json;
  }
  const str = String(value);
  return str === "" ? null : str;
}

/**
 * Records every remaining field of a shipment-scoped agent output as a Fact,
 * namespaced under `{agentKey}.{fieldName}` -- so nothing an agent discovers
 * is dropped just because there's no hand-picked persist() call for it.
 * Additive: call alongside (never instead of) any existing targeted
 * persistence that writes curated ShipmentLineItem columns.
 */
export async function captureShipmentOutputFacts(params: {
  shipmentId: string;
  documentId: string | null;
  agentKey: string;
  output: Record<string, unknown>;
  exclude?: string[];
}): Promise<void> {
  const exclude = new Set([...DEFAULT_EXCLUDE, ...(params.exclude ?? [])]);
  const facts: RecordFactInput[] = [];
  for (const [field, value] of Object.entries(params.output)) {
    if (exclude.has(field)) continue;
    const serialized = serialize(value);
    if (serialized === null) continue;
    facts.push({
      shipmentId: params.shipmentId,
      field: `${params.agentKey}.${field}`,
      value: serialized,
      sourceType: "AGENT_PROPOSED",
      documentId: params.documentId,
    });
  }
  await FactService.recordMany(facts);
}
