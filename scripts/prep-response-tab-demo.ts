/**
 * One-off: brings a shipment created through the UI to a fileable state
 * (line item with a rated HTS code, required documents, and a BrokerApproved
 * CustomsFiling) so the Transmit/Cancel/Amendment actions can be exercised
 * through the actual UI without hand-driving the document-upload/OCR
 * pipeline, which is unrelated to what's being verified here.
 *
 * Run with: npx tsx scripts/prep-response-tab-demo.ts <shipmentId>
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const shipmentId = process.argv[2];
  if (!shipmentId) throw new Error("Usage: npx tsx scripts/prep-response-tab-demo.ts <shipmentId>");

  const shipment = await db.shipment.findUniqueOrThrow({ where: { id: shipmentId } });

  const TEST_HTS_CODE = "8481.80.5090";
  const TEST_HTS_NORMALIZED = "8481805090";
  const existingHts = await db.htsNode.findFirst({ where: { htsNumberNormalized: TEST_HTS_NORMALIZED } });
  if (!existingHts) {
    const release = await db.htsRelease.create({
      data: {
        editionYear: 1900,
        revisionNumber: 0,
        releaseName: "Response tab UI demo fixture",
        effectiveFrom: new Date("1900-01-01"),
        sourceUrl: "test://response-tab-ui-demo",
        sourceFormat: "JSON",
        sha256: `test-${Date.now()}`,
        validationStatus: "VALIDATED",
      },
    });
    await db.htsNode.create({
      data: {
        releaseId: release.id,
        sourceRowNumber: 1,
        indentLevel: 0,
        htsNumberDisplay: TEST_HTS_CODE,
        htsNumberNormalized: TEST_HTS_NORMALIZED,
        codeLevel: 10,
        description: "Valves, other",
        fullDescription: "Valves, other",
        chapter: "84",
        heading: "8481",
        subheading6: "848180",
        tariffLine8: "84818050",
        statisticalSuffix10: TEST_HTS_NORMALIZED,
        dutyRates: { create: { rateColumn: "General", rawRateText: "2.8%", rateType: "AdValorem", adValoremPercent: 2.8 } },
      },
    });
  }

  await db.shipmentLineItem.create({
    data: {
      accountId: shipment.accountId,
      shipmentId: shipment.id,
      lineNumber: 1,
      description: "Electronic Valves",
      quantity: 100,
      unitPrice: 50.0,
      totalValue: 5000.0,
      countryOfOrigin: "DE",
      htsCode: TEST_HTS_CODE,
    },
  });

  for (const docType of ["COMMERCIAL_INVOICE", "PACKING_LIST", "BILL_OF_LADING", "CERTIFICATE_OF_ORIGIN"]) {
    await db.shipmentDocument.create({
      data: {
        accountId: shipment.accountId,
        shipmentId: shipment.id,
        fileName: `${docType.toLowerCase()}.pdf`,
        fileUrl: `http://storage.local/${docType.toLowerCase()}.pdf`,
        docType,
        status: "Verified",
      },
    });
  }

  const suffix = Math.floor(Math.random() * 1000000).toString();
  const filing = await db.customsFiling.create({
    data: {
      shipment: { connect: { id: shipment.id } },
      account: { connect: { id: shipment.accountId } },
      entryNumber: `5901-28-${suffix}`,
      authority: "US Customs (CBP)",
      entryType: "Consumption Entry",
      filingType: "ABI - Automated",
      filingStatus: "BrokerApproved",
      totalValue: 5000.0,
      totalDuties: 150.0,
      totalTaxes: 0.0,
      totalAmount: 5150.0,
    },
  });

  console.log("filingId", filing.id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
