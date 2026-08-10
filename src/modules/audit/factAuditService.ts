import { db } from "@/lib/db";

export interface LogChangeEventInput {
  shipmentId: string;
  userId?: string | null;
  changeType:
    | "USER_FIELD_UPDATE"
    | "DOCUMENT_EXTRACTED"
    | "PARTY_ASSIGNED"
    | "CLASSIFICATION_CHANGED"
    | "STATUS_CHANGED";
  field: string;
  previousValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
}

export class FactAuditService {
  /**
   * Log a field or party change without overwriting original document evidence.
   */
  static async logChangeEvent(input: LogChangeEventInput) {
    if (input.previousValue === input.newValue) return null;

    return db.shipmentChangeEvent.create({
      data: {
        shipmentId: input.shipmentId,
        userId: input.userId || null,
        changeType: input.changeType,
        field: input.field,
        previousValue: input.previousValue ? String(input.previousValue) : null,
        newValue: input.newValue ? String(input.newValue) : null,
        reason: input.reason || null,
      },
    });
  }

  /**
   * Retrieve audit history events for a shipment.
   */
  static async getShipmentAuditHistory(shipmentId: string) {
    return db.shipmentChangeEvent.findMany({
      where: { shipmentId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
