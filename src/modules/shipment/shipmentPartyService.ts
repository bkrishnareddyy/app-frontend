import { db } from "@/lib/db";

export type ShipmentPartyRole =
  | "IMPORTER_OF_RECORD"
  | "CONSIGNEE"
  | "ULTIMATE_CONSIGNEE"
  | "PURCHASER"
  | "BUYER"
  | "EXPORTER"
  | "SELLER"
  | "SHIPPER"
  | "MANUFACTURER"
  | "SUPPLIER"
  | "DELIVERY_TO"
  | "BROKER"
  | "FORWARDER"
  | "OTHER";

export interface AssignPartyInput {
  shipmentId: string;
  legalEntityId: string;
  role: ShipmentPartyRole;
  source?: "USER" | "DOCUMENT" | "AI" | "SYSTEM" | "EXTERNAL_API";
  confidence?: number;
  isVerified?: boolean;
}

export class ShipmentPartyService {
  /**
   * Assign or update a LegalEntity role on a shipment.
   * Ensures idempotency: updating existing role assignment if present.
   */
  static async assignParty(input: AssignPartyInput) {
    const existing = await db.shipmentParty.findFirst({
      where: {
        shipmentId: input.shipmentId,
        role: input.role,
      },
    });

    if (existing) {
      return db.shipmentParty.update({
        where: { id: existing.id },
        data: {
          legalEntityId: input.legalEntityId,
          source: input.source || "USER",
          confidence: input.confidence ?? 1.0,
          isVerified: input.isVerified ?? true,
        },
        include: {
          legalEntity: {
            include: { customsProfiles: true },
          },
        },
      });
    }

    return db.shipmentParty.create({
      data: {
        shipmentId: input.shipmentId,
        legalEntityId: input.legalEntityId,
        role: input.role,
        source: input.source || "USER",
        confidence: input.confidence ?? 1.0,
        isVerified: input.isVerified ?? true,
      },
      include: {
        legalEntity: {
          include: { customsProfiles: true },
        },
      },
    });
  }

  /**
   * Fetch all assigned parties for a shipment.
   */
  static async getShipmentParties(shipmentId: string) {
    return db.shipmentParty.findMany({
      where: { shipmentId },
      include: {
        legalEntity: {
          include: { customsProfiles: true },
        },
      },
    });
  }

  /**
   * Resolve a specific canonical party role for a shipment.
   */
  static async getPartyByRole(shipmentId: string, role: ShipmentPartyRole) {
    return db.shipmentParty.findFirst({
      where: { shipmentId, role },
      include: {
        legalEntity: {
          include: { customsProfiles: true },
        },
      },
    });
  }
}
