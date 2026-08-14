import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { db } from "../src/lib/db";
import { FilingService } from "../src/modules/filings/filing.service";
import type { FilingSnapshotData } from "../src/modules/filings/filing.service";

describe("CBP Filing Immutable Snapshot Integration Suite", () => {
  let accountId: string;
  let shipmentId: string;
  let filingId: string;

  // This suite runs against a real Postgres, so the hooks and tests need more
  // than the default 10s/5s budgets for their round trips.
  const DB_TIMEOUT = 30_000;

  const TEST_HTS_CODE = "8481.80.5090";
  const TEST_HTS_NORMALIZED = "8481805090";
  /** Set only when this suite inserted the tariff rows and must remove them again. */
  let seededReleaseId: string | null = null;

  // transmitFiling refuses any line with no published duty rate, so the HTS
  // master needs this code before the filing can be sent. The rate below is a
  // test fixture, not a real HTSUS rate, so it must never be left behind in a
  // shared database, and a pre-existing real node is never overwritten.
  beforeAll(async () => {
    const existing = await db.htsNode.findFirst({
      where: { htsNumberNormalized: TEST_HTS_NORMALIZED },
    });
    if (!existing) {
      const release = await db.htsRelease.create({
        data: {
          editionYear: 1900,
          revisionNumber: 0,
          releaseName: "Filing snapshot test fixture",
          effectiveFrom: new Date("1900-01-01"),
          sourceUrl: "test://filing-snapshot",
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
          dutyRates: {
            create: { rateColumn: "General", rawRateText: "2.8%", rateType: "AdValorem", adValoremPercent: 2.8 },
          },
        },
      });
      seededReleaseId = release.id;
    }
  }, DB_TIMEOUT);

  afterAll(async () => {
    // Cascades to the node and its duty rate.
    if (seededReleaseId) {
      await db.htsRelease.delete({ where: { id: seededReleaseId } });
    }
  }, DB_TIMEOUT);

  beforeEach(async () => {
    // 1. Create unique test context
    const suffix = Math.floor(Math.random() * 1000000).toString();
    const account = await db.account.create({
      data: {
        name: `Filing Test Account ${suffix}`,
        slug: `filing-test-slug-${suffix}`,
      },
    });
    accountId = account.id;

    const shipment = await db.shipment.create({
      data: {
        account: { connect: { id: accountId } },
        shipmentNumber: `SHP-TEST-${suffix}`,
        importerName: "Test Importer Inc",
        destinationCountry: "US",
        entryType: "01",
        portOfEntry: "Port of Los Angeles (2704)",
        carrierName: "Maersk Line",
        incoterm: "CIF",
        lineItems: {
          create: [
            {
              account: { connect: { id: accountId } },
              lineNumber: 1,
              description: "Electronic Valves",
              quantity: 100,
              unitPrice: 50.0,
              totalValue: 5000.0,
              countryOfOrigin: "DE",
              htsCode: "8481.80.5090",
            },
          ],
        },
        documents: {
          create: [
            {
              account: { connect: { id: accountId } },
              fileName: "invoice.pdf",
              fileUrl: "http://storage.local/invoice.pdf",
              docType: "COMMERCIAL_INVOICE",
            },
          ],
        },
      },
    });
    shipmentId = shipment.id;

    // Create a draft customs filing
    const filing = await db.customsFiling.create({
      data: {
        shipment: { connect: { id: shipmentId } },
        account: { connect: { id: accountId } },
        entryNumber: `5901-26-${suffix}`,
        authority: "US Customs (CBP)",
        entryType: "Consumption Entry",
        filingType: "ABI - Automated",
        // transmit.send is only legal from BrokerApproved/TransmissionPending.
        filingStatus: "BrokerApproved",
        totalValue: 5000.0,
        totalDuties: 150.0,
        totalTaxes: 0.0,
        totalAmount: 5150.0,
      },
    });
    filingId = filing.id;
  }, DB_TIMEOUT);

  afterEach(async () => {
    // Clean up all nested records in cascade order
    if (accountId) {
      await db.account.delete({ where: { id: accountId } });
    }
  }, DB_TIMEOUT);

  it("should generate and store an immutable snapshot when transmitting a filing", async () => {
    // 1. Verify no snapshot exists initially
    const initialSnapshot = await db.filingSnapshot.findFirst({
      where: { filingId },
    });
    expect(initialSnapshot).toBeNull();

    // 2. Call transmitFiling to submit the filing and trigger snapshot generation
    const result = await FilingService.transmitFiling(accountId, "test-user-id", filingId);
    expect(result.filing.filingStatus).toBe("Transmitted");

    // 3. Verify that the snapshot was created in the database
    const snapshot = await db.filingSnapshot.findUnique({
      where: { filingId },
    });
    expect(snapshot).not.toBeNull();
    
    const snapshotData = snapshot!.snapshotData as unknown as FilingSnapshotData;
    expect(snapshotData.shipment.importerName).toBe("Test Importer Inc");
    expect(snapshotData.lineItems.length).toBe(1);
    expect(snapshotData.lineItems[0].description).toBe("Electronic Valves");
    expect(snapshotData.lineItems[0].htsCode).toBe("8481.80.5090");
    expect(snapshotData.filingHeader.entryNumber).toBe(result.filing.entryNumber);
  }, DB_TIMEOUT);

  it("should serve entry summary details from snapshot fallback post-submission, safeguarding against subsequent modifications", async () => {
    // 1. Submit filing and write immutable snapshot
    await FilingService.transmitFiling(accountId, "test-user-id", filingId);

    // 2. Modify the live shipment line item and values to simulate subsequent user changes
    const items = await db.shipmentLineItem.findMany({
      where: { shipmentId },
    });
    expect(items.length).toBe(1);
    
    await db.shipmentLineItem.update({
      where: { id: items[0].id },
      data: {
        description: "MODIFIED AFTER SUBMISSION",
        htsCode: "9999.99.9999",
      },
    });

    // 3. Make mock GET request to fetch filing details
    const filingDetailRes = await fetchFilingDetailLocal(accountId, filingId);
    
    // 4. Assert response values are served from snapshot, remaining isolated from live table updates
    expect(filingDetailRes.filing.products[0].description).toBe("Electronic Valves");
    expect(filingDetailRes.filing.products[0].htsCode).toBe("8481.80.5090");
    expect(filingDetailRes.filing.products[0].description).not.toBe("MODIFIED AFTER SUBMISSION");
  }, DB_TIMEOUT);
});

// Helper simulating GET /api/filing/[id] route logic locally
async function fetchFilingDetailLocal(accountId: string, id: string) {
  const filing = await db.customsFiling.findFirst({
    where: { id, accountId },
    include: {
      snapshot: true,
      shipment: {
        include: {
          documents: true,
          lineItems: true,
        },
      },
      responses: true,
    },
  });

  if (!filing) throw new Error("Filing not found");

  const snapshot = filing.snapshot
    ? (filing.snapshot.snapshotData as unknown as FilingSnapshotData)
    : null;
  const lineItems = snapshot ? (snapshot.lineItems ?? []) : (filing.shipment.lineItems ?? []);
  const primaryCOO = lineItems[0]?.countryOfOrigin ?? null;

  return {
    filing: {
      id: filing.id,
      entryNumber: filing.entryNumber,
      filingStatus: filing.filingStatus,
      importerOfRecord: snapshot ? snapshot.shipment.importerName : filing.shipment.importerName,
      countryOfOrigin: primaryCOO,
      products: lineItems,
      totalCustomsValue: snapshot ? Number(snapshot.filingHeader.totalValue) : Number(filing.totalValue),
    }
  };
}
