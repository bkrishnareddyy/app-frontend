import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { computeReadinessScore } from "@/lib/shipmentReadiness";
import { generateShipmentNumber } from "@/modules/shipments/shipmentNumber";
import { ENTRY_TYPE_CODES, normalizeEntryType } from "@/modules/filing/entryType";

const createShipmentSchema = z.object({
  importerName: z.string().trim().min(1, "Importer name is required").max(200),
  poReference: z.string().trim().max(100).optional(),
  entryType: z.string().trim().max(100).optional(),
  incoterm: z.string().trim().max(100).optional(),
  portOfEntry: z.string().trim().max(200).optional(),
  carrierName: z.string().trim().max(200).optional(),
  countryOfExport: z.string().trim().max(100).optional(),
  estimatedArrival: z.coerce.date().optional(),
  masterShipmentId: z.string().trim().min(1).optional(),
});

const LIST_PAGE_SIZE_DEFAULT = 50;
const LIST_PAGE_SIZE_MAX = 100;

function listPageSize(raw: string | null): number {
  if (raw === null) return LIST_PAGE_SIZE_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return LIST_PAGE_SIZE_DEFAULT;
  return Math.min(parsed, LIST_PAGE_SIZE_MAX);
}

function listPage(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const params = new URL(req.url).searchParams;
  const search = params.get("q")?.trim() ?? "";
  // The summary view exists because a shipment picker needs an id and a
  // number. It used to receive every document, line item, decision and filing
  // in the account to fill a dropdown.
  const summaryOnly = params.get("view") === "summary";
  const pageSize = listPageSize(params.get("pageSize"));
  const page = listPage(params.get("page"));

  const whereClause: Prisma.ShipmentWhereInput = { accountId: ctx.accountId, deletedAt: null };

  // RLS: Planners can only see shipments assigned to them
  if (ctx.roleNames.includes("PLANNER")) {
    whereClause.assignedBrokerId = ctx.userId;
  }

  if (search) {
    whereClause.OR = [
      { shipmentNumber: { contains: search, mode: "insensitive" } },
      { importerName: { contains: search, mode: "insensitive" } },
    ];
  }

  // The list used to have no limit at all, so its cost grew with the account.
  const listArgs = {
    where: whereClause,
    orderBy: { createdAt: "desc" as const },
    skip: (page - 1) * pageSize,
    take: pageSize,
  };

  // total is the count of everything matching, not of what was returned, so a
  // caller can tell that it is looking at a page rather than the account.
  const total = await db.shipment.count({ where: whereClause });

  if (summaryOnly) {
    const shipments = await db.shipment.findMany({
      ...listArgs,
      select: { id: true, shipmentNumber: true, importerName: true, status: true },
    });
    return NextResponse.json({ shipments, total, page, pageSize });
  }

  const shipments = await db.shipment.findMany({
    ...listArgs,
    include: {
      documents: true,
      lineItems: true,
      agentDecisions: true,
      customsFilings: true,
      assignedBroker: true,
      masterShipment: true,
      houseShipments: true,
      exceptionItems: true,
    },
  });

  // readinessScore is a static column default (87), never updated as
  // documents/line items/exceptions change -- compute the real figure here.
  const shipmentsWithReadiness = shipments.map((s) => ({
    ...s,
    readinessScore: computeReadinessScore(s),
  }));

  return NextResponse.json({ shipments: shipmentsWithReadiness, total, page, pageSize });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const parsed = createShipmentSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "ValidationError",
        // Field-keyed so the form can map errors back to inputs.
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
        requestId,
      },
      { status: 400 }
    );
  }

  const input = parsed.data;

  // Storing the raw spelling is what left three vocabularies in this column.
  let entryTypeCode: string | null = null;
  if (input.entryType) {
    entryTypeCode = normalizeEntryType(input.entryType);
    if (!entryTypeCode) {
      return NextResponse.json(
        {
          error: "ValidationError",
          fieldErrors: {
            entryType: [
              `"${input.entryType}" is not a CBP entry type. Use one of: ${ENTRY_TYPE_CODES.join(", ")}.`,
            ],
          },
          requestId,
        },
        { status: 400 }
      );
    }
  }

  // Verify masterShipment exists and belongs to the same account if specified
  if (input.masterShipmentId) {
    const master = await db.shipment.findFirst({
      where: { id: input.masterShipmentId, accountId: ctx.accountId },
    });
    if (!master) {
      return NextResponse.json({ error: "Invalid masterShipmentId: Master shipment not found in this account" }, { status: 400 });
    }
  }

  const shipmentNumber = await generateShipmentNumber(db, ctx.accountId);

  const shipment = await db.shipment.create({
    data: {
      accountId: ctx.accountId,
      shipmentNumber,
      importerName: input.importerName,
      poReference: input.poReference,
      entryType: entryTypeCode,
      incoterm: input.incoterm,
      portOfEntry: input.portOfEntry,
      carrierName: input.carrierName,
      countryOfExport: input.countryOfExport,
      estimatedArrival: input.estimatedArrival,
      status: "Draft",
      ownerName: [ctx.firstName, ctx.lastName].filter(Boolean).join(" ") || null,
      assignedBrokerId: ctx.roleNames.includes("PLANNER") ? ctx.userId : null,
      masterShipmentId: input.masterShipmentId || null,
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "shipment.create",
    entity: "Shipment",
    entityId: shipment.id,
    metadata: { shipmentNumber, masterShipmentId: input.masterShipmentId ?? null },
  });

  return NextResponse.json({ shipment, requestId }, { status: 201 });
}, { write: true });
