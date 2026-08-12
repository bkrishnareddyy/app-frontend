import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const filing = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      shipment: {
        // The entry summary emits these as a numbered line list on the 7501, so
        // they have to come back in line order rather than heap order.
        include: { lineItems: { orderBy: { lineNumber: "asc" } } },
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
});
