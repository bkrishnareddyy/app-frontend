import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { createExceptionItem } from "@/lib/exceptions/createException";

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
  accountId: string;
  source?: "USER" | "DOCUMENT" | "AI" | "SYSTEM" | "EXTERNAL_API";
  confidence?: number;
  isVerified?: boolean;
  userId?: string | null;
}

export class ShipmentPartyService {
  /**
   * Assign or update a LegalEntity role on a shipment.
   * Ensures idempotency: updating existing role assignment if present.
   */
  static async assignParty(input: AssignPartyInput) {
    const legalEntity = await db.legalEntity.findFirst({
      where: { id: input.legalEntityId, accountId: input.accountId },
      select: { id: true },
    });
    if (!legalEntity) {
      throw new Error(`LegalEntity '${input.legalEntityId}' not found for account.`);
    }

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

    const created = await db.shipmentParty.create({
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

    // When the LegalEntity is linked to a Party master record, check for open
    // revalidation flags that would make using this party on a shipment risky.
    await ShipmentPartyService.checkPartyMasterRevalidation(
      input.shipmentId,
      input.legalEntityId,
      input.accountId,
      input.userId ?? null
    );

    return created;
  }

  /**
   * If the LegalEntity is linked to a Party master record with open
   * revalidation flags, create a compliance ExceptionItem on the shipment so
   * the reviewer knows the party's data is in question.
   *
   * Revalidation flags on a party mean its name, address, identifier, or
   * registration has changed since it was last reviewed. Using such a party on
   * a new shipment without first resolving those flags creates an unreviewed
   * compliance exposure.
   */
  static async checkPartyMasterRevalidation(
    shipmentId: string,
    legalEntityId: string,
    accountId: string,
    userId: string | null
  ): Promise<void> {
    const legalEntity = await db.legalEntity.findFirst({
      where: { id: legalEntityId, accountId },
      select: {
        id: true,
        legalName: true,
        partyId: true,
      },
    });

    if (!legalEntity?.partyId) return;

    const openFlags = await db.partyRevalidationFlag.findMany({
      where: { partyId: legalEntity.partyId, accountId, status: "OPEN" },
      select: { id: true, flag: true, reason: true },
    });

    if (openFlags.length === 0) return;

    const flagSummary = openFlags.map((f) => `${f.flag}: ${f.reason}`).join("; ");

    await createExceptionItem({
      accountId,
      shipmentId,
      category: "COMPLIANCE",
      type: "compliance_flag",
      severity: "High",
      description:
        `Party "${legalEntity.legalName}" has ${openFlags.length} open revalidation flag(s) in the party master: ${flagSummary}. Review and resolve before filing.`,
      status: "Open",
      blocking: false,
      requiredAction: "Resolve the open revalidation flags on this party in the party master before filing.",
      sourceAgent: "Party Revalidation Check",
    });

    await createAuditLog({
      accountId,
      userId,
      action: "party.revalidation.shipment_flag",
      entity: "ShipmentParty",
      entityId: shipmentId,
      source: "SYSTEM",
      metadata: {
        legalEntityId,
        partyId: legalEntity.partyId,
        partyName: legalEntity.legalName,
        openFlagCount: openFlags.length,
        flags: openFlags.map((f) => f.flag),
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
