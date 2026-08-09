import type { PrismaClient } from "@prisma/client";

/** Minimal surface needed to allocate a sequence value, so tests can inject a double. */
export interface ShipmentSequenceStore {
  shipmentSequence: {
    upsert(args: {
      where: { accountId_year: { accountId: string; year: number } };
      create: { accountId: string; year: number; lastValue: number };
      update: { lastValue: { increment: number } };
      select: { lastValue: true };
    }): Promise<{ lastValue: number }>;
  };
}

export const SHIPMENT_NUMBER_PREFIX = "SHP";

export function formatShipmentNumber(year: number, sequence: number): string {
  return `${SHIPMENT_NUMBER_PREFIX}-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Allocates the next shipment number for an account.
 *
 * The increment happens inside a single atomic upsert so concurrent creates
 * cannot be handed the same value, unlike a count()+1 read.
 */
export async function generateShipmentNumber(
  store: ShipmentSequenceStore | PrismaClient,
  accountId: string,
  now: Date = new Date()
): Promise<string> {
  const year = now.getUTCFullYear();

  const { lastValue } = await (store as ShipmentSequenceStore).shipmentSequence.upsert({
    where: { accountId_year: { accountId, year } },
    create: { accountId, year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
    select: { lastValue: true },
  });

  return formatShipmentNumber(year, lastValue);
}
