import { db } from "@/lib/db";

export interface CrossShipmentDuplicate {
  documentId: string;
  shipmentId: string | null;
  shipmentNumber: string | null;
  fileName: string;
  createdAt: Date;
}

/**
 * ShipmentDocument.checksum (SHA-256 of the stored bytes, indexed on
 * accountId+checksum) was only ever compared for parse-run idempotency
 * (documentProcessingWorker's contentSha256), never queried against other
 * ShipmentDocument rows. Same bytes landing on two different shipments --
 * the same invoice attached twice, or emailed and then also uploaded through
 * the portal -- went undetected. This is a non-blocking signal only: the
 * upload always proceeds, and it's up to the caller whether/how to surface it.
 */
export async function findCrossShipmentDuplicates(
  accountId: string,
  checksum: string | null | undefined,
  excludeShipmentId: string | null,
  excludeDocumentId?: string
): Promise<CrossShipmentDuplicate[]> {
  if (!checksum) return [];

  const rows = await db.shipmentDocument.findMany({
    where: {
      accountId,
      checksum,
      ...(excludeDocumentId ? { id: { not: excludeDocumentId } } : {}),
    },
    select: {
      id: true,
      shipmentId: true,
      fileName: true,
      createdAt: true,
      shipment: { select: { shipmentNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Filtered in JS rather than the query itself, so a nullable shipmentId
  // column can't leave a same-shipment row in (or a cross-shipment one out)
  // depending on how the DB treats NULL against a `not` filter.
  return rows
    .filter((r) => r.shipmentId !== excludeShipmentId)
    .slice(0, 5)
    .map((r) => ({
      documentId: r.id,
      shipmentId: r.shipmentId,
      shipmentNumber: r.shipment?.shipmentNumber ?? null,
      fileName: r.fileName,
      createdAt: r.createdAt,
    }));
}
