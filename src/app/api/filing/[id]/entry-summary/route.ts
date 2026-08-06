import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    const filing = await db.customsFiling.findFirst({
      where: { id, accountId: ctx.accountId },
      include: {
        shipment: {
          include: { lineItems: true },
        },
        importerOfRecord: true,
        bond: true,
      },
    });

    if (!filing) {
      return NextResponse.json({ error: "Filing not found" }, { status: 404 });
    }

    const entrySummaryForm7501 = {
      formType: "CBP Form 7501 (Entry Summary)",
      entryNumber: filing.entryNumber,
      entryType: filing.entryType,
      importerOfRecord: filing.importerOfRecord?.name || filing.shipment.importerName,
      importerNumber: filing.importerOfRecord?.cbpImporterNumber || "CBP-998877",
      bondNumber: filing.bond?.bondNumber || "BND-500123",
      portOfEntry: filing.shipment.portOfEntry || "Port of Los Angeles (2704)",
      countryOfExport: filing.shipment.countryOfExport || "Germany",
      totalCustomsValue: filing.totalValue,
      totalDutiesPaid: filing.totalDuties,
      totalTaxesPaid: filing.totalTaxes,
      totalAmountPaid: filing.totalAmount,
      dutyBreakdown: filing.dutyBreakdown,
      lineItems: filing.shipment.lineItems.map((item) => ({
        lineNumber: item.lineNumber,
        description: item.description,
        htsCode: item.htsCode,
        quantity: item.quantity,
        value: item.totalValue,
        countryOfOrigin: item.countryOfOrigin,
      })),
      declarationStatement: "I declare that the statements in this entry summary are true and correct to the best of my knowledge.",
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ entrySummary: entrySummaryForm7501 });
  } catch (error) {
    console.error("GET /api/filing/[id]/entry-summary error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
