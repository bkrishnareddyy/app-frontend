import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { buildForm7501, type FilingHeaderInput, type LineItemInput } from "@/lib/filing/form7501";
import { generateForm7501PdfBuffer } from "@/lib/filing/form7501Pdf";
import { loadHtsCodesMap, parsePublishedDutyRate } from "@/lib/tariff/dutyEngine";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const filing = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      shipment: {
        include: { lineItems: { orderBy: { lineNumber: "asc" } } },
      },
      importerOfRecord: true,
      bond: true,
      snapshot: true,
    },
  });

  if (!filing) {
    return NextResponse.json({ error: "Filing not found" }, { status: 404 });
  }

  const lineItems = filing.shipment?.lineItems ?? [];

  // Fetch approved classification decisions for each line item's product.
  // Joins: ShipmentLineItem.productId → ProductClassification (status=APPROVED)
  const productIds = lineItems.map((li) => li.productId).filter((id): id is string => !!id);
  const approvedClassifications =
    productIds.length > 0
      ? await db.productClassification.findMany({
          where: { productId: { in: productIds }, status: "APPROVED" },
          select: { id: true, productId: true, classificationCode: true, reviewedByUserId: true, reviewedAt: true },
        })
      : [];

  const classificationByProductId = new Map(
    approvedClassifications.map((c) => [c.productId, c])
  );

  // Load HTS duty rates from the latest published release
  const htsCodesMap = await loadHtsCodesMap(lineItems);

  // Resolve the HTS release ID that was used (from the filing snapshot, or latest)
  const publishedRelease = await db.htsRelease.findFirst({
    where: { country: "US", publicationStatus: "PUBLISHED" },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, effectiveFrom: true },
  });
  const htsReleaseId = (filing.snapshot?.snapshotData as Record<string, unknown> | null)?.htsReleaseId as string | null
    ?? publishedRelease?.id
    ?? null;

  // Age of the HTS release in days (for downstream freshness check)
  const htsReleaseAgeInDays = publishedRelease?.effectiveFrom
    ? Math.floor((Date.now() - publishedRelease.effectiveFrom.getTime()) / 86_400_000)
    : null;

  // Build LineItemInput list with provenance
  const lineItemInputs: LineItemInput[] = lineItems.map((li) => {
    const classification = li.productId ? classificationByProductId.get(li.productId) : null;
    const htsRateInput = li.htsCode ? htsCodesMap[li.htsCode] : null;
    const dutyRateDecimal = htsRateInput ? parsePublishedDutyRate(htsRateInput.generalDutyRate) : null;

    return {
      id: li.id,
      lineNumber: li.lineNumber,
      description: li.description,
      htsCode: li.htsCode,
      quantity: Number(li.quantity),
      unitPrice: Number(li.unitPrice),
      totalValue: Number(li.totalValue),
      countryOfOrigin: li.countryOfOrigin,
      // Approved classification data (if present)
      approvedHtsCode: classification?.classificationCode ?? null,
      approvedAt: classification?.reviewedAt?.toISOString() ?? null,
      approvedByUserId: classification?.reviewedByUserId ?? null,
      classificationId: classification?.id ?? null,
      dutyRateDecimal,
      htsReleaseId,
    };
  });

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

  const form7501 = buildForm7501(filingHeaderInput, lineItemInputs, htsReleaseId);

  if (format === "pdf") {
    const pdfBuffer = generateForm7501PdfBuffer(form7501);
    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="7501-${filing.entryNumber}.pdf"`,
      },
    });
  }

  if (format === "zip") {
    const { generateZipBuffer } = await import("@/lib/zip/zipGenerator");
    const pdfBuffer = generateForm7501PdfBuffer(form7501);
    const jsonContent = JSON.stringify(form7501, null, 2);

    const csvHeaders = ["Line", "Description", "HTS Code", "COO", "Quantity", "Value (USD)", "Duty Rate", "Duty (USD)"];
    const csvRows = form7501.lineItems.map((li) => [
      li.lineNumber,
      `"${String(li.description.value || "").replace(/"/g, '""')}"`,
      li.htsCode.value || "",
      li.countryOfOrigin.value || "",
      li.quantity.value ?? 1,
      li.enteredValue.value ?? 0,
      li.dutyRate.value != null ? `${(li.dutyRate.value * 100).toFixed(2)}%` : "0%",
      li.dutyAmount.value ?? 0,
    ].join(","));
    const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");

    const zipBuffer = generateZipBuffer([
      { filename: `7501-${filing.entryNumber}.pdf`, content: pdfBuffer },
      { filename: `7501-${filing.entryNumber}-data.json`, content: jsonContent },
      { filename: `7501-${filing.entryNumber}-line-items.csv`, content: csvContent },
    ]);

    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="7501-${filing.entryNumber}-package.zip"`,
      },
    });
  }

  return NextResponse.json({
    form7501,
    htsReleaseAgeInDays,
    // Legacy flat summary for callers still using the old shape
    entrySummary: {
      formType: "CBP Form 7501 (Entry Summary)",
      entryNumber: filing.entryNumber,
      entryType: filing.entryType,
      importerOfRecord: filing.importerOfRecord?.name ?? filing.shipment?.importerName ?? "Unknown Importer",
      importerNumber: filing.importerOfRecord?.cbpImporterNumber ?? null,
      bondNumber: filing.bond?.bondNumber ?? null,
      portOfEntry: filing.shipment?.portOfEntry ?? null,
      countryOfExport: filing.shipment?.countryOfExport ?? null,
      totalCustomsValue: form7501.totalEnteredValue.value,
      totalDutiesPaid: form7501.totalDuty.value,
      totalAmountPaid: filing.totalAmount,
      coverageStatus: form7501.coverageStatus,
      generatedAt: form7501.generatedAt,
    },
  });
});
