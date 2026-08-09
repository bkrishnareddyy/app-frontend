import { db } from "@/lib/db";

export type ShipmentResolutionCode = "SHIPMENT_NOT_FOUND" | "TARGET_NOT_DETERMINED";

export class ShipmentResolutionError extends Error {
  constructor(
    readonly code: ShipmentResolutionCode,
    message: string
  ) {
    super(message);
    this.name = "ShipmentResolutionError";
  }
}

export interface ShipmentLookup {
  findOwned(accountId: string, shipmentId: string): Promise<string | null>;
}

export const databaseShipmentLookup: ShipmentLookup = {
  async findOwned(accountId, shipmentId) {
    const row = await db.shipment.findFirst({
      where: { id: shipmentId, accountId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  },
};

/**
 * Resolves the shipment a request should act on, confined to the caller's tenant.
 *
 * A caller-supplied id that exists in another account is reported as not found so the
 * endpoint cannot be used to probe for shipment ids, and it is never silently swapped
 * for one of the caller's own shipments.
 */
export async function resolveTenantShipmentId(
  accountId: string,
  requestedShipmentId: string | null | undefined,
  lookup: ShipmentLookup = databaseShipmentLookup
): Promise<string> {
  if (!requestedShipmentId) {
    // This used to fall back to the account's most recently created shipment,
    // so a document with no stated target was filed against whichever shipment
    // happened to be newest.
    throw new ShipmentResolutionError(
      "TARGET_NOT_DETERMINED",
      "No shipment was named for this document, and the target cannot be inferred."
    );
  }

  const owned = await lookup.findOwned(accountId, requestedShipmentId);
  if (!owned) {
    throw new ShipmentResolutionError("SHIPMENT_NOT_FOUND", "Shipment not found.");
  }
  return owned;
}

export function shipmentResolutionStatus(code: ShipmentResolutionCode): number {
  return code === "SHIPMENT_NOT_FOUND" ? 404 : 409;
}
