import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { computeFilingTariff, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";
import { ENTRY_TYPE_CODES, entryTypeVariants, normalizeEntryType } from "@/modules/filing/entryType";
import { findMostSpecificMatch } from "@/lib/canonicalMessaging/wildcardLookup";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);

  // Search query (Entry #, PO, Importer, Carrier, HTS, Description, Port, etc.)
  const search = searchParams.get("search") || searchParams.get("q") || "";

  // Filters
  const filingStatus = searchParams.get("filingStatus");
  const portOfEntry = searchParams.get("portOfEntry");
  const carrierName = searchParams.get("carrierName");
  const countryOfOrigin = searchParams.get("countryOfOrigin");
  const importerName = searchParams.get("importerName");
  const entryType = searchParams.get("entryType");
  const riskLevel = searchParams.get("riskLevel"); // high, medium, low

  // Financial Range Filters
  const minDuty = searchParams.get("minDuty") ? parseFloat(searchParams.get("minDuty")!) : undefined;
  const maxDuty = searchParams.get("maxDuty") ? parseFloat(searchParams.get("maxDuty")!) : undefined;
  const minValue = searchParams.get("minValue") ? parseFloat(searchParams.get("minValue")!) : undefined;
  const maxValue = searchParams.get("maxValue") ? parseFloat(searchParams.get("maxValue")!) : undefined;

  // Date Range Filters
  const startDate = searchParams.get("startDate") ? new Date(searchParams.get("startDate")!) : undefined;
  const endDate = searchParams.get("endDate") ? new Date(searchParams.get("endDate")!) : undefined;

  // Pagination & Sorting
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const skip = (page - 1) * limit;

  const sortBy = searchParams.get("sortBy") || "createdAt";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  // Build Prisma query condition
  const where: import("@prisma/client").Prisma.CustomsFilingWhereInput = {
    accountId: ctx.accountId,
  };

  // Filter by filing status
  if (filingStatus && filingStatus !== "all") {
    const statuses = filingStatus.split(",").map((s) => s.trim());
    if (statuses.length > 1) {
      where.filingStatus = { in: statuses };
    } else {
      where.filingStatus = { equals: statuses[0], mode: "insensitive" };
    }
  }

  // Financial filters
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

  // Date range filter
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  // Related Shipment filters
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

  // Filter by entry type. Rows written before the column was canonicalised
  // still hold "Consumption Entry" or "01 - CONSUMPTION ENTRY", so a filter
  // on the code has to match every spelling of that code. It goes in AND
  // because the keyword search below owns OR and would otherwise erase it.
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

  // Keyword & Natural Language search across multiple fields
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

  // Order By fields mapping
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

  // Execute query and total count in parallel
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

  // Format filings with rich computed metadata & default breakdowns
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

    // Duty lines come from a real calculation or not at all. The previous
    // fallback split the total 70/15/15 and labelled the slices with rates
    // that were never used to compute them.
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

      // Logistics & Parties
      importerOfRecord: filing.shipment?.importerName ?? null,
      portOfEntry: filing.shipment?.portOfEntry ?? null,
      modeOfTransport: null,
      carrier: filing.shipment?.carrierName ?? null,
      containerCount: null,
      countryOfOrigin: primaryCOO,
      supplier: null,
      shipmentReference: filing.shipment?.shipmentNumber ?? null,
      poReference: filing.shipment?.poReference ?? null,

      // Financials
      totalCustomsValue,
      currency: "USD",
      totalDuty,
      taxes: totalTaxes,
      fees: null,
      totalAmount: filing.totalAmount,
      dutyBreakdown,

      // Compliance & Risk
      aiRiskScore: filing.shipment?.riskScore ?? null,
      readinessScore: filing.shipment?.readinessScore ?? null,

      // Timestamps
      submissionDate: filing.submittedAt || filing.createdAt,
      releaseDate: filing.releasedAt,
      createdAt: filing.createdAt,
      updatedAt: filing.updatedAt,

      // Embedded Collections
      shipment: filing.shipment,
      responsesCount: filing.responses.length,
      latestResponse: filing.responses[0] || null,
      responses: filing.responses,
    };
  });

  // Compute aggregate metrics across entire account's filings
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

/** A neutral, non-authority-shaped internal reference -- not a real CBP/customs
 *  entry number. The authority's own number (if any) arrives later as
 *  `authorityReference` on the accepted response; this is only ever "how we
 *  refer to this draft internally," and must never look like it was assigned
 *  by anyone but us. */
function generateInternalReference(shipmentNumber: string): string {
  return `DFT-${shipmentNumber}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { shipmentId, entryType, filingType, customEntryNumber } = body;

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

  // The single most load-bearing fact for everything downstream: every
  // country-driven config table (FilingProcedureMapping, FilingMessageCatalog,
  // FilingAuthorityConfig, ...) keys off this value. Checked here, at
  // creation, rather than discovered three steps later at Transmit, so a
  // broker never spends review effort approving a filing that can never
  // actually be sent.
  const destinationCountry = shipment.destinationCountry;
  if (!destinationCountry) {
    return NextResponse.json(
      {
        error:
          "This shipment has no destination country set. Set it on the shipment (top of the shipment page) before starting a filing.",
      },
      { status: 400 }
    );
  }

  // Block 2 of the Form 7501 (or the equivalent declaration-type field for
  // another authority). Falls back to the shipment's own entryType, but is
  // never silently defaulted to a specific one -- see schema.prisma's comment
  // on why CustomsFiling.entryType/authority/filingType carry no @default.
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
      {
        error: `"${declaredEntryType}" is not a CBP entry type. Use one of: ${ENTRY_TYPE_CODES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  // Fail closed if this destination has no procedure mapping yet, rather than
  // creating a Draft that can pass Validate and Approve and only then fail at
  // Transmit (resolveMessageContext throws the same underlying error, just
  // much later in the workflow).
  const procedureCandidates = await db.filingProcedureMapping.findMany({
    where: { entryType: entryTypeCode, country: { in: [destinationCountry, "*"] } },
  });
  const procedureMatch = findMostSpecificMatch(procedureCandidates, ["country"], { country: destinationCountry });
  if (!procedureMatch) {
    return NextResponse.json(
      {
        error: `No filing procedure is configured for entry type "${entryTypeCode}" and destination "${destinationCountry}" yet. Add a FilingProcedureMapping row before filing to this destination.`,
      },
      { status: 422 }
    );
  }

  // Authority/filing-system label are per-destination facts, not a hardcoded
  // "US Customs (CBP)" default -- see FilingAuthorityConfig.
  const authorityConfig = await db.filingAuthorityConfig.findUnique({ where: { country: destinationCountry } });
  if (!authorityConfig) {
    return NextResponse.json(
      { error: `No filing authority is configured for destination "${destinationCountry}" yet. Add a FilingAuthorityConfig row for it first.` },
      { status: 422 }
    );
  }

  // Calculate tariff, duty, MPF, and HMF using centralized Tariff Engine, grounded
  // in the real ingested HTS Master Release data rather than a flat rate guess.
  // NOTE: this engine computes US CBP duty (MPF/HMF/general rate) unconditionally,
  // regardless of destinationCountry. For any non-US destination these figures
  // are not meaningful and should be treated as provisional/US-only until a
  // country-scoped duty engine exists -- tracked as a known gap, not fixed here.
  const tariffResult = computeFilingTariff(
    shipment.lineItems,
    await loadHtsCodesMap(shipment.lineItems)
  );
  // Any line without a published rate makes every total an understatement,
  // so the figures stay null rather than being persisted as if complete.
  const dutyIsComplete = tariffResult.unratedLineCount === 0;
  const calculatedValue = tariffResult.totalCustomsValue;
  const calculatedDuty = dutyIsComplete ? tariffResult.totalDuty : null;
  const calculatedTotal = dutyIsComplete ? tariffResult.totalAmount : null;
  const dutyBreakdown = tariffResult.dutyBreakdown;

  // QPR-001: POST /api/filing creates DRAFT only.
  // - paymentStatus and submittedAt are NOT set here.
  // - Customs responses (ACK/REJECT) are created only from real provider callbacks.
  // - Transmission happens via POST /api/filing/[id]/transmit after broker approval.
  // entryNumber is scoped-unique per account (@@unique([accountId, entryNumber]));
  // retry on the rare collision instead of trusting an unchecked random suffix.
  let filing: Awaited<ReturnType<typeof db.customsFiling.create>> | null = null;
  for (let attempt = 0; attempt < 5 && !filing; attempt++) {
    const entryNumber = customEntryNumber || generateInternalReference(shipment.shipmentNumber);
    try {
      filing = await db.customsFiling.create({
        data: {
          shipmentId,
          accountId: ctx.accountId,
          entryNumber,
          authority: authorityConfig.authorityName,
          entryType: entryTypeCode,
          filingType: filingType || authorityConfig.filingSystemLabel,
          filingStatus: "Draft",
          preparedByUserId: ctx.userId,
          totalValue: calculatedValue,
          totalDuties: calculatedDuty,
          // Null, not 0: no tax calculation runs here, and 0 would claim one did.
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
      if (!isDuplicate || customEntryNumber) throw err; // an explicit custom number colliding is a real conflict, not retryable
    }
  }
  if (!filing) {
    return NextResponse.json({ error: "Could not generate a unique filing reference. Try again." }, { status: 500 });
  }

  await db.shipment.update({
    where: { id: shipmentId },
    data: { status: "Draft" },
  });

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
      // > 0 means totalDuties is a floor, not the amount owed. The draft is
      // still created so the gap is visible and can be classified.
      unratedLineCount: tariffResult.unratedLineCount,
    },
    { status: 201 }
  );

}, { permission: "filings.create", write: true });
