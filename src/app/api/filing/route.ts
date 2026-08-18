import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { computeFilingTariff, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";
import { ENTRY_TYPE_CODES, entryTypeVariants, normalizeEntryType } from "@/modules/filing/entryType";
import { findMostSpecificMatch } from "@/lib/canonicalMessaging/wildcardLookup";
import { wrapDeclarationData } from "@/lib/canonicalMessaging/declarationBuilder";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { FactAuditService } from "@/modules/audit/factAuditService";

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);

  const search = searchParams.get("search") || searchParams.get("q") || "";
  const filingStatus = searchParams.get("filingStatus");
  const portOfEntry = searchParams.get("portOfEntry");
  const carrierName = searchParams.get("carrierName");
  const countryOfOrigin = searchParams.get("countryOfOrigin");
  const importerName = searchParams.get("importerName");
  const entryType = searchParams.get("entryType");
  const riskLevel = searchParams.get("riskLevel");

  const minDuty = searchParams.get("minDuty") ? parseFloat(searchParams.get("minDuty")!) : undefined;
  const maxDuty = searchParams.get("maxDuty") ? parseFloat(searchParams.get("maxDuty")!) : undefined;
  const minValue = searchParams.get("minValue") ? parseFloat(searchParams.get("minValue")!) : undefined;
  const maxValue = searchParams.get("maxValue") ? parseFloat(searchParams.get("maxValue")!) : undefined;

  const startDate = searchParams.get("startDate") ? new Date(searchParams.get("startDate")!) : undefined;
  const endDate = searchParams.get("endDate") ? new Date(searchParams.get("endDate")!) : undefined;

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const skip = (page - 1) * limit;

  const sortBy = searchParams.get("sortBy") || "createdAt";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  const where: import("@prisma/client").Prisma.CustomsFilingWhereInput = {
    accountId: ctx.accountId,
  };

  if (filingStatus && filingStatus !== "all") {
    const statuses = filingStatus.split(",").map((s) => s.trim());
    if (statuses.length > 1) {
      where.filingStatus = { in: statuses };
    } else {
      where.filingStatus = { equals: statuses[0], mode: "insensitive" };
    }
  }

  if (minDuty !== undefined || maxDuty !== undefined) {
    where.totalDuties = {};
    if (minDuty !== undefined) where.totalDuties.gte = minDuty;
    if (maxDuty !== undefined) where.totalDuties.lte = maxDuty;
  }

  if (minValue !== undefined || maxValue !== undefined) {
    where.totalValue = {};
    if (minValue !== undefined) where.totalValue.gte = minValue;
    if (maxValue !== undefined) where.totalValue.lte = maxValue;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  const shipmentWhere: import("@prisma/client").Prisma.ShipmentWhereInput = {};
  if (portOfEntry) {
    shipmentWhere.portOfEntry = { contains: portOfEntry, mode: "insensitive" };
  }
  if (carrierName) {
    shipmentWhere.carrierName = { contains: carrierName, mode: "insensitive" };
  }
  if (countryOfOrigin) {
    shipmentWhere.countryOfExport = { contains: countryOfOrigin, mode: "insensitive" };
  }
  if (importerName) {
    shipmentWhere.importerName = { contains: importerName, mode: "insensitive" };
  }
  if (riskLevel) {
    if (riskLevel.toLowerCase() === "high") {
      shipmentWhere.riskScore = { gte: 70 };
    } else if (riskLevel.toLowerCase() === "medium") {
      shipmentWhere.riskScore = { gte: 30, lt: 70 };
    } else if (riskLevel.toLowerCase() === "low") {
      shipmentWhere.riskScore = { lt: 30 };
    }
  }

  if (Object.keys(shipmentWhere).length > 0) {
    where.shipment = shipmentWhere;
  }

  if (entryType) {
    const code = normalizeEntryType(entryType);
    if (code) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: entryTypeVariants(code).map((variant) => ({
            entryType: { equals: variant, mode: "insensitive" as const },
          })),
        },
      ];
    } else {
      where.entryType = { contains: entryType, mode: "insensitive" };
    }
  }

  if (search.trim()) {
    const q = search.trim();
    where.OR = [
      { entryNumber: { contains: q, mode: "insensitive" } },
      { authority: { contains: q, mode: "insensitive" } },
      { entryType: { contains: q, mode: "insensitive" } },
      { filingType: { contains: q, mode: "insensitive" } },
      { filingStatus: { contains: q, mode: "insensitive" } },
      {
        shipment: {
          OR: [
            { shipmentNumber: { contains: q, mode: "insensitive" } },
            { importerName: { contains: q, mode: "insensitive" } },
            { poReference: { contains: q, mode: "insensitive" } },
            { portOfEntry: { contains: q, mode: "insensitive" } },
            { carrierName: { contains: q, mode: "insensitive" } },
            { countryOfExport: { contains: q, mode: "insensitive" } },
            {
              lineItems: {
                some: {
                  OR: [
                    { description: { contains: q, mode: "insensitive" } },
                    { htsCode: { contains: q, mode: "insensitive" } },
                    { partNumber: { contains: q, mode: "insensitive" } },
                    { countryOfOrigin: { contains: q, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        },
      },
    ];
  }

  let orderBy: import("@prisma/client").Prisma.CustomsFilingOrderByWithRelationInput | import("@prisma/client").Prisma.CustomsFilingOrderByWithRelationInput[] = {};
  if (sortBy === "totalValue" || sortBy === "totalDuties" || sortBy === "totalTaxes" || sortBy === "entryNumber") {
    orderBy[sortBy] = sortOrder;
  } else if (sortBy === "importerName") {
    orderBy = { shipment: { importerName: sortOrder } };
  } else if (sortBy === "portOfEntry") {
    orderBy = { shipment: { portOfEntry: sortOrder } };
  } else {
    orderBy = { createdAt: sortOrder };
  }

  const [totalCount, rawFilings] = await Promise.all([
    db.customsFiling.count({ where }),
    db.customsFiling.findMany({
      where,
      include: {
        shipment: {
          include: {
            documents: true,
            lineItems: true,
          },
        },
        responses: {
          orderBy: { receivedAt: "desc" },
        },
      },
      orderBy,
      skip,
      take: limit,
    }),
  ]);

  const filings = rawFilings.map((filing) => {
    const lineItems = filing.shipment?.lineItems || [];
    const primaryCOO = lineItems[0]?.countryOfOrigin ?? filing.shipment?.countryOfExport ?? null;
    const totalCustomsValue =
      filing.totalValue !== null
        ? Number(filing.totalValue)
        : lineItems.length > 0
        ? lineItems.reduce((acc, item) => acc + Number(item.totalValue), 0)
        : null;
    const totalDuty = filing.totalDuties !== null ? Number(filing.totalDuties) : null;
    const totalTaxes = filing.totalTaxes !== null ? Number(filing.totalTaxes) : null;
    const dutyBreakdown = Array.isArray(filing.dutyBreakdown) ? filing.dutyBreakdown : [];

    return {
      id: filing.id,
      shipmentId: filing.shipmentId,
      entryNumber: filing.entryNumber,
      entryType: filing.entryType ?? filing.shipment?.entryType ?? null,
      filingStatus: filing.filingStatus,
      paymentStatus: filing.paymentStatus,
      authority: filing.authority,
      filingType: filing.filingType,
      importerOfRecord: filing.shipment?.importerName ?? null,
      portOfEntry: filing.shipment?.portOfEntry ?? null,
      modeOfTransport: null,
      carrier: filing.shipment?.carrierName ?? null,
      containerCount: null,
      countryOfOrigin: primaryCOO,
      supplier: null,
      shipmentReference: filing.shipment?.shipmentNumber ?? null,
      poReference: filing.shipment?.poReference ?? null,
      totalCustomsValue,
      currency: "USD",
      totalDuty,
      taxes: totalTaxes,
      fees: null,
      totalAmount: filing.totalAmount,
      dutyBreakdown,
      aiRiskScore: filing.shipment?.riskScore ?? null,
      readinessScore: filing.shipment?.readinessScore ?? null,
      submissionDate: filing.submittedAt || filing.createdAt,
      releaseDate: filing.releasedAt,
      createdAt: filing.createdAt,
      updatedAt: filing.updatedAt,
      shipment: filing.shipment,
      responsesCount: filing.responses.length,
      latestResponse: filing.responses[0] || null,
      responses: filing.responses,
    };
  });

  const allAccountFilings = await db.customsFiling.findMany({
    where: { accountId: ctx.accountId },
    select: { filingStatus: true, totalValue: true, totalDuties: true },
  });

  const metrics = {
    totalFilings: allAccountFilings.length,
    submittedCount: allAccountFilings.filter((f) => ["Filed", "Submitted", "Accepted", "Released", "Liquidated"].includes(f.filingStatus)).length,
    acceptedCount: allAccountFilings.filter((f) => ["Accepted", "Released", "Liquidated"].includes(f.filingStatus)).length,
    releasedCount: allAccountFilings.filter((f) => f.filingStatus === "Released" || f.filingStatus === "Liquidated").length,
    heldCount: allAccountFilings.filter((f) => f.filingStatus === "Customs Hold" || f.filingStatus === "On Hold").length,
    draftCount: allAccountFilings.filter((f) => f.filingStatus === "Draft" || f.filingStatus === "In Progress").length,
    totalDuties: Math.round(filings.reduce((acc, f) => acc + Number(f.totalDuty), 0) * 100) / 100,
    totalTaxes: Math.round(filings.reduce((acc, f) => acc + Number(f.taxes), 0) * 100) / 100,
    totalAmount: Math.round(filings.reduce((acc, f) => acc + Number(f.totalAmount), 0) * 100) / 100,
    acceptanceRate: allAccountFilings.length > 0
      ? Math.round((allAccountFilings.filter((f) => ["Accepted", "Released", "Liquidated"].includes(f.filingStatus)).length / allAccountFilings.length) * 1000) / 10
      : 100,
  };

  return NextResponse.json({
    filings,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    },
    metrics,
  });
});

function generateInternalReference(shipmentNumber: string): string {
  return `DFT-${shipmentNumber}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const {
    shipmentId,
    entryType,
    filingType,
    customEntryNumber,
    standalone,
    country,
    procedureCode,
    messageName,
    declarationData,
    localReferenceNumber,
    registrationNumber,
  } = body;

  if (standalone) {
    if (!country || !procedureCode || !messageName) {
      return NextResponse.json(
        { error: "country, procedureCode, and messageName are required for standalone filings" },
        { status: 400 }
      );
    }

    const procedureConfig = await db.filingProcedureConfig.findFirst({
      where: {
        country,
        procedureCode,
        messageName,
        isActive: true,
      },
      include: {
        transactionType: true,
      },
    });

    if (!procedureConfig) {
      return NextResponse.json(
        { error: `No active procedure configuration found for ${country}/${procedureCode}/${messageName}` },
        { status: 404 }
      );
    }

    const timestamp = Date.now().toString(36).toUpperCase();
    const randomSuffix = randomUUID().slice(0, 6).toUpperCase();
    const standaloneEntryNumber = `${country}-${procedureCode}-${timestamp}-${randomSuffix}`;

    const filing = await db.customsFiling.create({
      data: {
        accountId: ctx.accountId,
        entryNumber: standaloneEntryNumber,
        localReferenceNumber: localReferenceNumber || standaloneEntryNumber,
        registrationNumber: registrationNumber || null,
        country,
        procedureCode,
        messageName,
        transactionTypeId: procedureConfig.transactionTypeId,
        filingType: filingType || "Standard",
        filingStatus: "Draft",
        preparedByUserId: ctx.userId,
        totalValue: null,
        totalDuties: null,
        totalTaxes: null,
        totalAmount: null,
        shipmentId: null,
        entryType: null,
        authority: null,
        dutyBreakdown: declarationData ? ({
          declarationDraft: wrapDeclarationData(declarationData, procedureConfig.transactionType?.code || "IMPORT")
        } as any) : undefined,
      },
      include: {
        shipment: true,
        responses: true,
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: AuditAction.FILING_CREATED,
      entity: "filing",
      entityId: filing.id,
      metadata: {
        description: `Created standalone filing ${filing.entryNumber} for ${country}/${procedureCode}/${messageName}`,
        country,
        procedureCode,
        messageName,
      },
    });

    return NextResponse.json({ filing });
  }

  if (!shipmentId) {
    return NextResponse.json({ error: "shipmentId is required" });
  }

  const shipment = await db.shipment.findFirst({
    where: { id: shipmentId, accountId: ctx.accountId },
    include: { lineItems: true, documents: true },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  if (shipment.lineItems.length === 0) {
    return NextResponse.json(
      { error: "Cannot start a filing for a shipment with no line items." },
      { status: 400 }
    );
  }

  const filingCountry = country || shipment.destinationCountry;
  const filingProcedureCode = procedureCode || null;
  const filingMessageName = messageName || null;

  if (!filingCountry) {
    return NextResponse.json(
      {
        error:
          "Country is required. Either provide it in the request or ensure the shipment has a destination country.",
      },
      { status: 400 }
    );
  }

  let transactionTypeId: string | null = null;
  if (filingProcedureCode && filingMessageName) {
    const procedureConfig = await db.filingProcedureConfig.findFirst({
      where: {
        country: filingCountry,
        procedureCode: filingProcedureCode,
        messageName: filingMessageName,
        isActive: true,
      },
      include: {
        transactionType: true,
      },
    });

    if (procedureConfig) {
      transactionTypeId = procedureConfig.transactionTypeId;
    } else {
      console.warn(
        `[Filing Creation] No active FilingProcedureConfig found for country=${filingCountry}, procedureCode=${filingProcedureCode}, messageName=${filingMessageName}`
      );
    }
  }

  const destinationCountry = filingCountry;
  const declaredEntryType = entryType || shipment.entryType;
  if (!declaredEntryType) {
    return NextResponse.json(
      { error: "entryType is required and is not recorded on the shipment" },
      { status: 400 }
    );
  }

  const entryTypeCode = normalizeEntryType(declaredEntryType);
  if (!entryTypeCode) {
    return NextResponse.json(
      { error: `Unsupported entryType: ${declaredEntryType}` },
      { status: 400 }
    );
  }

  const tariffResult = computeFilingTariff(
    shipment.lineItems,
    await loadHtsCodesMap(shipment.lineItems)
  );
  const dutyIsComplete = tariffResult.unratedLineCount === 0;
  const calculatedValue = tariffResult.totalCustomsValue;
  const calculatedDuty = dutyIsComplete ? tariffResult.totalDuty : null;
  const calculatedTotal = dutyIsComplete ? tariffResult.totalAmount : null;
  const dutyBreakdown = tariffResult.dutyBreakdown;

  let filing: Awaited<ReturnType<typeof db.customsFiling.create>> | null = null;
  for (let attempt = 0; attempt < 5 && !filing; attempt++) {
    const entryNumber = customEntryNumber || generateInternalReference(shipment.shipmentNumber);
    try {
      filing = await db.customsFiling.create({
        data: {
          shipmentId,
          accountId: ctx.accountId,
          entryNumber,
          authority: null,
          entryType: entryTypeCode,
          transactionTypeId,
          country: filingCountry,
          procedureCode: filingProcedureCode,
          messageName: filingMessageName,
          localReferenceNumber: entryNumber,
          filingType: filingType || "Standard",
          filingStatus: "Draft",
          preparedByUserId: ctx.userId,
          totalValue: calculatedValue,
          totalDuties: calculatedDuty,
          totalTaxes: null,
          totalAmount: calculatedTotal,
          dutyBreakdown,
        },
        include: {
          shipment: true,
          responses: true,
        },
      });
    } catch (err) {
      const isDuplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isDuplicate || customEntryNumber) throw err;
    }
  }
  if (!filing) {
    return NextResponse.json({ error: "Could not generate a unique filing reference. Try again." }, { status: 500 });
  }

  const TERMINAL_SHIPMENT_STATUSES = new Set(["Submitted", "Completed"]);
  if (!TERMINAL_SHIPMENT_STATUSES.has(shipment.status)) {
    const updated = await db.shipment.updateMany({
      where: { id: shipmentId, accountId: ctx.accountId, version: shipment.version },
      data: { status: "Draft", version: { increment: 1 } },
    });
    if (updated.count > 0 && shipment.status !== "Draft") {
      await FactAuditService.logChangeEvent({
        shipmentId,
        userId: ctx.userId,
        changeType: "STATUS_CHANGED",
        field: "status",
        previousValue: shipment.status,
        newValue: "Draft",
        reason: "New filing created for shipment",
      });
    }
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.FILING_CREATED,
    entity: "CustomsFiling",
    entityId: filing.id,
    source: "UI",
    metadata: { entryNumber: filing.entryNumber, shipmentId, filingStatus: "Draft", destinationCountry },
  });

  return NextResponse.json(
    {
      filing,
      unratedLineCount: tariffResult.unratedLineCount,
    },
    { status: 201 }
  );

}, { permission: "filings.create", write: true });
