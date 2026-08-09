import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const whereClause: Prisma.ShipmentWhereInput = { accountId: ctx.accountId, deletedAt: null };

    const whereClause: any = { accountId: ctx.accountId, deletedAt: null };
    
    // RLS: Planners can only see shipments assigned to them
    if (ctx.roleName === "PLANNER") {
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
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ shipments });
  } catch (error) {
    console.error("GET /api/shipments error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  // RLS: Planners can only see shipments assigned to them
  if (ctx.roleName === "PLANNER") {
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
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ shipments });
});

    const body = await req.json();
    const { importerName, poReference, entryType, incoterm, estimatedArrival, masterShipmentId } = body;
const createShipmentSchema = z.object({
  importerName: z.string().min(1).optional(),
  poReference: z.string().min(1).optional(),
  entryType: z.string().min(1).optional(),
  incoterm: z.string().min(1).optional(),
  estimatedArrival: z.string().datetime().optional().or(z.string().min(1).optional()),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createShipmentSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { importerName, poReference, entryType, incoterm, estimatedArrival } = bodyVal.data;

  // Dynamic sequence calculation directly from database count
  const shipmentCount = await db.shipment.count({
    where: { accountId: ctx.accountId },
  });

    // Verify masterShipment exists and belongs to the same account if specified
    if (masterShipmentId) {
      const master = await db.shipment.findFirst({
        where: { id: masterShipmentId, accountId: ctx.accountId },
      });
      if (!master) {
        return NextResponse.json({ error: "Invalid masterShipmentId: Master shipment not found in this account" }, { status: 400 });
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
        assignedBrokerId: ctx.roleName === "PLANNER" ? ctx.userId : null,
        masterShipmentId: masterShipmentId || null,
      },
    });
  const nextSeq = shipmentCount + 1;
  const shipmentNumber = `SHP-2026-${String(nextSeq).padStart(6, "0")}`;

  const shipment = await db.shipment.create({
    data: {
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "shipment.create",
      entity: "Shipment",
      entityId: shipment.id,
      metadata: { shipmentNumber, masterShipmentId },
    });
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
      assignedBrokerId: ctx.roleName === "PLANNER" ? ctx.userId : null,
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "shipment.create",
    entity: "Shipment",
    entityId: shipment.id,
    metadata: { shipmentNumber },
  });

  return NextResponse.json({ shipment, requestId }, { status: 201 });
});
