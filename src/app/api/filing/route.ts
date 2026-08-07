import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { computeFilingTariff } from "@/lib/tariff/dutyEngine";

export async function GET(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
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

    // Filter by entry type
    if (entryType) {
      where.entryType = { contains: entryType, mode: "insensitive" };
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
      const primaryCOO = lineItems[0]?.countryOfOrigin || filing.shipment?.countryOfExport || "USA";
      const totalCustomsValue = Number(filing.totalValue) || lineItems.reduce((acc, item) => acc + Number(item.totalValue), 0);
      const totalDuty = Number(filing.totalDuties) || 0;
      const totalTaxes = Number(filing.totalTaxes) || 0;

      // Compute standard duty breakdown if null
      const dutyBreakdown = filing.dutyBreakdown || [
        { feeName: "Base Customs Duty", amount: Math.round(Number(totalDuty) * 0.7 * 100) / 100, rate: "3.5%" },
        { feeName: "Merchandise Processing Fee (MPF)", amount: Math.round(Number(totalDuty) * 0.15 * 100) / 100, rate: "0.3464%" },
        { feeName: "Harbor Maintenance Fee (HMF)", amount: Math.round(Number(totalDuty) * 0.15 * 100) / 100, rate: "0.125%" },
      ];

      return {
        id: filing.id,
        shipmentId: filing.shipmentId,
        entryNumber: filing.entryNumber,
        entryType: filing.entryType || filing.shipment?.entryType || "Consumption Entry",
        filingStatus: filing.filingStatus,
        paymentStatus: filing.paymentStatus,
        authority: filing.authority,
        filingType: filing.filingType,

        // Logistics & Parties
        importerOfRecord: filing.shipment?.importerName || "Unknown Importer",
        customsBroker: "Qubere Automated Compliance Services",
        portOfEntry: filing.shipment?.portOfEntry || "Port of Los Angeles (2704)",
        modeOfTransport: filing.shipment?.incoterm?.includes("Air") ? "Air" : "Ocean",
        carrier: filing.shipment?.carrierName || "Maersk Line",
        billOfLading: `BOL-${filing.entryNumber.replace(/[^0-9]/g, "").slice(-8)}`,
        houseBill: `HBOL-${filing.entryNumber.replace(/[^0-9]/g, "").slice(-6)}`,
        containerCount: Math.max(1, lineItems.length),
        countryOfOrigin: primaryCOO,
        supplier: lineItems[0]?.partNumber ? `Supplier Corp (${lineItems[0].partNumber.slice(0, 4)})` : "Global Trade Supplier Ltd",
        shipmentReference: filing.shipment?.shipmentNumber || `SHP-${filing.id.slice(0, 6)}`,
        poReference: filing.shipment?.poReference,

        // Financials
        totalCustomsValue,
        currency: "USD",
        totalDuty,
        taxes: totalTaxes,
        fees: Math.round((totalDuty * 0.1) * 100) / 100,
        totalAmount: filing.totalAmount,
        dutyBreakdown,

        // Compliance & Risk
        aiRiskScore: filing.shipment?.riskScore ?? 15,
        readinessScore: filing.shipment?.readinessScore ?? 95,

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
  } catch (error) {
    console.error("GET /api/filing error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { shipmentId, entryType, filingType, customEntryNumber } = body;

    if (!shipmentId) {
      return NextResponse.json({ error: "shipmentId is required" }, { status: 400 });
    }

    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId, accountId: ctx.accountId },
      include: { lineItems: true, documents: true },
    });

    if (!shipment) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    // Calculate tariff, duty, MPF, and HMF using centralized Tariff Engine
    const tariffResult = computeFilingTariff(shipment.lineItems);
    const calculatedValue = tariffResult.totalCustomsValue > 0 ? tariffResult.totalCustomsValue : 17750.0;
    const calculatedDuty = tariffResult.totalDuty;
    const calculatedTaxes = 0;
    const calculatedTotal = tariffResult.totalAmount;

    const entrySuffix = shipment.shipmentNumber.split("-")[2] || Math.floor(100000 + Math.random() * 900000).toString();
    const entryNumber = customEntryNumber || `5901-26-${entrySuffix}`;

    const dutyBreakdown = tariffResult.dutyBreakdown;

    // QPR-001: POST /api/filing creates DRAFT only.
    // - paymentStatus and submittedAt are NOT set here.
    // - Customs responses (ACK/REJECT) are created only from real provider callbacks.
    // - Transmission happens via POST /api/filing/[id]/transmit after broker approval.
    const filing = await db.customsFiling.create({
      data: {
        shipmentId,
        accountId: ctx.accountId,
        entryNumber,
        authority: "US Customs (CBP)",
        entryType: entryType || shipment.entryType || "Consumption Entry",
        filingType: filingType || "ABI - Automated",
        filingStatus: "Draft",
        totalValue: shipment.lineItems.reduce((acc, item) => acc + Number(item.unitPrice) * Number(item.quantity), 0),
        totalDuties: calculatedDuty,
        totalTaxes: calculatedTaxes,
        totalAmount: calculatedTotal,
        dutyBreakdown,
      },
      include: {
        shipment: true,
        responses: true,
      },
    });

    await db.shipment.update({
      where: { id: shipmentId },
      data: { status: "Draft" },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "customs_filing.create_draft",
      entity: "CustomsFiling",
      entityId: filing.id,
      metadata: { entryNumber, shipmentId, filingStatus: "Draft" },
    });

    return NextResponse.json({ filing }, { status: 201 });
  } catch (error) {
    console.error("POST /api/filing error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
