/**
 * POST /api/v1/intake/shipment
 *
 * ERP inbound endpoint — creates or updates a Shipment and its line items from
 * an external system push. Authenticated via API key (Bearer or X-Api-Key header).
 * Every field written via this endpoint is tagged with source lineage metadata.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateApiKey, apiKeyHasScope } from "@/lib/api/api-key-auth";
import { generateRequestId } from "@/lib/api/error";
import { createAuditLog, AuditAction } from "@/lib/audit";

const lineItemSchema = z.object({
  lineNumber: z.number().int().positive(),
  description: z.string().min(1).max(1000),
  htsCode: z.string().optional().default(""),
  quantity: z.number().nonnegative().optional().default(0),
  unitPrice: z.number().nonnegative().optional().default(0),
  currency: z.string().max(3).optional().default("USD"),
  countryOfOrigin: z.string().max(2).optional().default(""),
  weight: z.number().nonnegative().optional(),
  /** ERP system's own identifier for this line. */
  sourceLineId: z.string().optional(),
});

const shipmentIntakeSchema = z.object({
  /** ERP reference number — used to match an existing shipment for update. */
  externalReference: z.string().min(1).max(200),
  importerName: z.string().max(500).optional(),
  estimatedArrival: z.string().datetime().optional(),
  portOfEntry: z.string().max(10).optional(),
  destinationCountry: z.string().length(2).optional().default("US"),
  lineItems: z.array(lineItemSchema).min(1),
  /** Source system identifier for lineage tracking. */
  sourceSystem: z.string().max(100).optional().default("ERP"),
});

export async function POST(req: Request): Promise<Response> {
  const requestId = generateRequestId();
  const apiCtx = await authenticateApiKey(req);

  if (!apiCtx) {
    return NextResponse.json(
      { error: "Unauthorized: valid API key required", requestId },
      { status: 401 }
    );
  }

  if (!apiKeyHasScope(apiCtx, "shipments.create")) {
    return NextResponse.json(
      { error: "Forbidden: key does not have shipments.create scope", requestId },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", requestId }, { status: 400 });
  }

  const parsed = shipmentIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", issues: parsed.error.issues, requestId },
      { status: 400 }
    );
  }

  const { externalReference, importerName, estimatedArrival, portOfEntry, destinationCountry, lineItems, sourceSystem } = parsed.data;

  // Use poReference as the ERP reference number field for matching.
  const existing = await db.shipment.findFirst({
    where: { accountId: apiCtx.accountId, poReference: externalReference },
  });

  let shipment;
  if (existing) {
    shipment = await db.shipment.update({
      where: { id: existing.id },
      data: {
        importerName: importerName ?? existing.importerName,
        estimatedArrival: estimatedArrival ? new Date(estimatedArrival) : existing.estimatedArrival,
        portOfEntry: portOfEntry ?? existing.portOfEntry,
        destinationCountry: destinationCountry ?? existing.destinationCountry,
        version: { increment: 1 },
      },
    });
  } else {
    // Generate shipment number
    const year = new Date().getFullYear();
    const seq = await db.shipmentSequence.upsert({
      where: { accountId_year: { accountId: apiCtx.accountId, year } },
      update: { lastValue: { increment: 1 } },
      create: { accountId: apiCtx.accountId, year, lastValue: 1 },
    });
    const shipmentNumber = `ERP-${year}-${String(seq.lastValue).padStart(5, "0")}`;

    shipment = await db.shipment.create({
      data: {
        accountId: apiCtx.accountId,
        shipmentNumber,
        poReference: externalReference,
        importerName: importerName ?? "",
        status: "In Progress",
        destinationCountry: destinationCountry ?? "US",
        estimatedArrival: estimatedArrival ? new Date(estimatedArrival) : null,
        portOfEntry: portOfEntry ?? null,
      },
    });
  }

  // Upsert line items with source lineage
  for (const li of lineItems) {
    const existingLine = await db.shipmentLineItem.findFirst({
      where: { shipmentId: shipment.id, accountId: apiCtx.accountId, lineNumber: li.lineNumber },
    });

    const lineData = {
      description: li.description,
      htsCode: li.htsCode ?? "",
      quantity: li.quantity ?? 0,
      unitPrice: li.unitPrice ?? 0,
      totalValue: (li.quantity ?? 0) * (li.unitPrice ?? 0),
      currency: li.currency ?? "USD",
      countryOfOrigin: li.countryOfOrigin ?? "",
      weight: li.weight ?? null,
      // F-5: data lineage fields
      source: "ERP",
      sourceSystem,
      sourceId: li.sourceLineId ?? externalReference,
    };

    if (existingLine) {
      await db.shipmentLineItem.update({ where: { id: existingLine.id }, data: lineData });
    } else {
      await db.shipmentLineItem.create({
        data: {
          ...lineData,
          accountId: apiCtx.accountId,
          shipmentId: shipment.id,
          lineNumber: li.lineNumber,
          status: "Pending",
        },
      });
    }
  }

  await createAuditLog({
    accountId: apiCtx.accountId,
    userId: null,
    action: AuditAction.INTAKE_SHIPMENT_CREATED,
    entity: "Shipment",
    entityId: shipment.id,
    source: "API",
    metadata: { externalReference, sourceSystem, lineItemCount: lineItems.length },
    requestId,
  });

  return NextResponse.json(
    {
      success: true,
      shipment: {
        id: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        poReference: shipment.poReference,
        status: shipment.status,
        lineItemsProcessed: lineItems.length,
      },
      requestId,
    },
    { status: existing !== null ? 200 : 201 }
  );
}
