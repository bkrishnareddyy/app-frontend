import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { computeReadinessScore } from "@/lib/shipmentReadiness";
import { z } from "zod";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const whereClause: Prisma.ShipmentWhereInput = { accountId: ctx.accountId, deletedAt: null };

  // RLS: Planners can only see shipments assigned to them
  if (ctx.roleNames.includes("PLANNER")) {
    whereClause.assignedBrokerId = ctx.userId;
  }

  const shipments = await db.shipment.findMany({
    where: whereClause,
    include: {
      documents: true,
      lineItems: true,
      agentDecisions: true,
      customsFilings: true,
      assignedBroker: true,
      masterShipment: true,
      houseShipments: true,
      exceptionItems: true,
      client: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // readinessScore is a static column default (87), never updated as
  // documents/line items/exceptions change -- compute the real figure here.
  const shipmentsWithReadiness = shipments.map((s) => ({
    ...s,
    readinessScore: computeReadinessScore(s),
  }));

  return NextResponse.json({ shipments: shipmentsWithReadiness });
});

const createShipmentSchema = z.object({
  importerName: z.string().min(1).optional(),
  poReference: z.string().min(1).optional(),
  entryType: z.string().min(1).optional(),
  incoterm: z.string().min(1).optional(),
  estimatedArrival: z.string().datetime().optional().or(z.string().min(1).optional()),
  masterShipmentId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createShipmentSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { importerName, poReference, entryType, incoterm, estimatedArrival, masterShipmentId, clientId } = bodyVal.data;

  // Dynamic sequence calculation directly from database count
  const shipmentCount = await db.shipment.count({
    where: { accountId: ctx.accountId },
  });

  const nextSeq = shipmentCount + 1;
  const shipmentNumber = `SHP-2026-${String(nextSeq).padStart(6, "0")}`;

  // Verify masterShipment exists and belongs to the same account if specified
  if (masterShipmentId) {
    const master = await db.shipment.findFirst({
      where: { id: masterShipmentId, accountId: ctx.accountId },
    });
    if (!master) {
      return NextResponse.json({ error: "Invalid masterShipmentId: Master shipment not found in this account" }, { status: 400 });
    }
  }

  // Verify client exists and belongs to the same account if specified
  if (clientId) {
    const client = await db.client.findFirst({
      where: { id: clientId, accountId: ctx.accountId },
    });
    if (!client) {
      return NextResponse.json({ error: "Invalid clientId: Client not found in this account" }, { status: 400 });
    }
  }

  const shipment = await db.shipment.create({
    data: {
      accountId: ctx.accountId,
      shipmentNumber,
      importerName: importerName || "ABC Manufacturing India Pvt Ltd",
      poReference: poReference || `PO-${Math.floor(100000 + Math.random() * 900000)}`,
      entryType: entryType || "Consumption Entry",
      incoterm: incoterm || "CIF Los Angeles",
      estimatedArrival: estimatedArrival ? new Date(estimatedArrival) : new Date("2026-05-20"),
      status: "In Progress",
      readinessScore: 85,
      riskScore: 20,
      ownerName: ctx.firstName || "Stephen",
      assignedBrokerId: ctx.roleNames.includes("PLANNER") ? ctx.userId : null,
      masterShipmentId: masterShipmentId || null,
      clientId: clientId || null,
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "shipment.create",
    entity: "Shipment",
    entityId: shipment.id,
    metadata: { shipmentNumber, masterShipmentId },
  });

  return NextResponse.json({ shipment, requestId }, { status: 201 });
});
