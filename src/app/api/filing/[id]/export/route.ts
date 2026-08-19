import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { buildForm7501, type FilingHeaderInput, type LineItemInput } from "@/lib/filing/form7501";
import { generateForm7501PdfBuffer } from "@/lib/filing/form7501Pdf";
import { generateZipBuffer } from "@/lib/zip/zipGenerator";
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
        include: { lineItems: { orderBy: { lineNumber: "asc" } }, documents: true },
      },
      importerOfRecord: true,
      bond: true,
      messages: { orderBy: { createdAt: "asc" } },
      responses: { orderBy: { receivedAt: "desc" } },
    },
  });

  if (!filing) {
    return NextResponse.json({ error: "Customs filing not found" }, { status: 404 });
  }

  const lineItems = filing.shipment?.lineItems ?? [];
  const lineItemInputs: LineItemInput[] = lineItems.map((li) => ({
    id: li.id,
    lineNumber: li.lineNumber,
    description: li.description,
    htsCode: li.htsCode,
    quantity: Number(li.quantity),
    unitPrice: Number(li.unitPrice),
    totalValue: Number(li.totalValue),
    countryOfOrigin: li.countryOfOrigin,
  }));

  const filingHeaderInput: FilingHeaderInput = {
    id: filing.id,
    entryNumber: filing.entryNumber,
    entryType: filing.entryType,
    importerName: filing.importerOfRecord?.name ?? filing.shipment?.importerName ?? "Unknown Importer",
    importerCbpNumber: filing.importerOfRecord?.cbpImporterNumber ?? null,
    importerOfRecordId: filing.importerOfRecordId ?? null,
    bondNumber: filing.bond?.bondNumber ?? null,
    bondId: filing.bondId ?? null,
    portOfEntry: filing.shipment?.portOfEntry ?? null,
    countryOfExport: filing.shipment?.countryOfExport ?? null,
    carrierName: filing.shipment?.carrierName ?? null,
  };

  const form7501 = buildForm7501(filingHeaderInput, lineItemInputs, null);
  const pdf7501Buffer = generateForm7501PdfBuffer(form7501);

  const filingSummary = {
    filingId: filing.id,
    entryNumber: filing.entryNumber,
    localReferenceNumber: filing.localReferenceNumber,
    registrationNumber: filing.registrationNumber,
    entryType: filing.entryType,
    filingType: filing.filingType,
    filingStatus: filing.filingStatus,
    country: filing.country,
    procedureCode: filing.procedureCode,
    messageName: filing.messageName,
    totalValue: filing.totalValue,
    totalDuties: filing.totalDuties,
    totalAmount: filing.totalAmount,
    createdAt: filing.createdAt,
    submittedAt: filing.submittedAt,
    releasedAt: filing.releasedAt,
    importerOfRecord: filing.importerOfRecord ? {
      name: filing.importerOfRecord.name,
      cbpNumber: filing.importerOfRecord.cbpImporterNumber,
    } : null,
    bond: filing.bond ? {
      bondNumber: filing.bond.bondNumber,
      suretyCode: filing.bond.suretyCode,
    } : null,
    declarationDraft: filing.declarationDraft,
  };

  const messageLogJson = JSON.stringify(filing.messages, null, 2);
  const responsesJson = JSON.stringify(filing.responses, null, 2);

  const zipEntries = [
    { filename: `7501-${filing.entryNumber}.pdf`, content: pdf7501Buffer },
    { filename: `filing-${filing.entryNumber}-summary.json`, content: JSON.stringify(filingSummary, null, 2) },
    { filename: `canonical-messages.json`, content: messageLogJson },
    { filename: `customs-responses.json`, content: responsesJson },
  ];

  const zipBuffer = generateZipBuffer(zipEntries);

  return new Response(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="filing-${filing.entryNumber}-full-package.zip"`,
    },
  });
});
