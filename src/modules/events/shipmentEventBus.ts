import { db } from "@/lib/db";

export type ShipmentEventType =
  | "SHIPMENT_CREATED"
  | "USER_FIELD_UPDATED"
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_EXTRACTED"
  | "RECONCILIATION_REQUESTED"
  | "CONFLICT_DETECTED"
  | "EXCEPTION_RESOLVED"
  | "AGENT_EXECUTION_TRIGGERED"
  | "FILING_SUBMITTED";

export interface LogEventParams {
  shipmentId: string;
  eventType: ShipmentEventType;
  payload?: Record<string, unknown>;
  triggeredBy?: string;
}

export class ShipmentEventBus {
  /**
   * Logs a domain event durably in ShipmentEventLog
   */
  static async logEvent(params: LogEventParams) {
    try {
      return await db.shipmentEventLog.create({
        data: {
          shipmentId: params.shipmentId,
          eventType: params.eventType,
          payload: params.payload ? JSON.parse(JSON.stringify(params.payload)) : undefined,
          triggeredBy: params.triggeredBy || "SYSTEM",
        },
      });
    } catch (err) {
      console.error(`Failed to log shipment event [${params.eventType}]:`, err);
      return null;
    }
  }
}
