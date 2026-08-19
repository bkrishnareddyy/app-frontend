import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../src/lib/db";
import { FilingService } from "../src/modules/filings/filing.service";
import { PgCanonicalMessageConsumer } from "../src/lib/canonicalMessaging/consumer";
import { processInboundMessage } from "../src/lib/canonicalMessaging/inboundConsumer";
import type { CanonicalFilingResponseData, CanonicalMessage } from "../src/lib/canonicalMessaging/types";

/**
 * Drives the full Cancel/Amendment lifecycle a real operator would exercise --
 * transmit, reject, resubmit, accept, cancel, cancel-confirmed -- and asserts
 * every step lands in FilingMessage exactly as the Response tab grid
 * (FilingDetailClient.tsx) reads it: request rows, response rows, correct
 * correlation/priorMessage links, and the filingStatus each step should leave
 * behind per filingStateMachine.ts.
 */
describe("Customs Filing Response tab lifecycle", () => {
  let accountId: string;
  let shipmentId: string;
  let filingId: string;

  const DB_TIMEOUT = 120_000;

  const TEST_HTS_CODE = "8481.80.5090";
  const TEST_HTS_NORMALIZED = "8481805090";
  let seededReleaseId: string | null = null;

  beforeAll(async () => {
    const existing = await db.htsNode.findFirst({ where: { htsNumberNormalized: TEST_HTS_NORMALIZED } });
    if (!existing) {
      const release = await db.htsRelease.create({
        data: {
          editionYear: 1900,
          revisionNumber: 0,
          releaseName: "Response tab lifecycle test fixture",
          effectiveFrom: new Date("1900-01-01"),
          sourceUrl: "test://response-tab-lifecycle",
          sourceFormat: "JSON",
          sha256: `test-${Date.now()}`,
          validationStatus: "VALIDATED",
          publicationStatus: "PUBLISHED",
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
      seededReleaseId = release.id;
    }
  }, DB_TIMEOUT);

  afterAll(async () => {
    if (seededReleaseId) {
      await db.htsRelease.delete({ where: { id: seededReleaseId } });
    }
  }, DB_TIMEOUT);

  beforeEach(async () => {
    const suffix = Math.floor(Math.random() * 1000000).toString();
    const account = await db.account.create({
      data: { name: `Response Tab Test Account ${suffix}`, slug: `response-tab-test-${suffix}` },
    });
    accountId = account.id;

    const shipment = await db.shipment.create({
      data: {
        account: { connect: { id: accountId } },
        shipmentNumber: `SHP-RTLC-${suffix}`,
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
              htsCode: TEST_HTS_CODE,
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

    const filing = await db.customsFiling.create({
      data: {
        shipment: { connect: { id: shipmentId } },
        account: { connect: { id: accountId } },
        entryNumber: `5901-27-${suffix}`,
        authority: "US Customs (CBP)",
        entryType: "01", // seeded US procedureCode (Consumption Entry) so resolveMessageContext resolves against real config
        filingType: "ABI - Automated",
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
    if (accountId) {
      await db.account.delete({ where: { id: accountId } });
    }
  }, DB_TIMEOUT);

  /** Simulates a mock authority response arriving for `correlationMessageId`, via the real inbound path. */
  async function mockResponse(
    correlationMessageId: string,
    status: "ACCEPTED" | "REJECTED" | "AMENDED" | "CANCELLED",
    humanMessage: string
  ) {
    const message: CanonicalMessage<CanonicalFilingResponseData> = {
      header: {
        messageId: randomUUID(),
        filingId,
        correlationId: correlationMessageId,
        messageName: "CUSTOMS_DECLARATION_RESPONSE",
        direction: "INBOUND",
        customer: { accountId },
        procedure: "CBP-ABI",
        country: "US",
        authority: "US Customs (CBP)",
        dateTime: new Date().toISOString(),
        schemaVersion: "1.0.0",
        senderSystem: "MOCK_CBP",
      },
      data: { status, humanMessage } as any,
    };

    await db.filingMessage.create({
      data: {
        accountId,
        filingId,
        messageId: message.header.messageId,
        correlationId: correlationMessageId,
        messageName: message.header.messageName,
        direction: "INBOUND",
        procedure: message.header.procedure,
        country: message.header.country,
        envelope: message as unknown as object,
        queueStatus: "PENDING",
      },
    });

    const processed = await new PgCanonicalMessageConsumer().processOne(processInboundMessage);
    expect(processed).toBe(true);

    return message;
  }

  it("walks transmit -> reject -> resubmit -> accept -> cancel -> cancel-confirmed and leaves a complete FilingMessage trail", async () => {
    // 01/02. Create shipment declaration + transmit to customs
    console.log("[test] before transmitFiling");
    const submitResult = await FilingService.transmitFiling(accountId, "test-user-id", filingId);
    console.log("[test] after transmitFiling", submitResult.filing.filingStatus);
    expect(submitResult.filing.filingStatus).toBe("Transmitted");
    const submitMessageId = submitResult.messageId;

    // Mock a REJECTED response
    console.log("[test] before mockResponse REJECTED");
    await mockResponse(submitMessageId, "REJECTED", "Missing certificate of origin.");
    console.log("[test] after mockResponse REJECTED");
    let filing = await db.customsFiling.findUniqueOrThrow({ where: { id: filingId } });
    expect(filing.filingStatus).toBe("Rejected");

    // 03. Modify the same parent declaration and retransmit
    const items = await db.shipmentLineItem.findMany({ where: { shipmentId } });
    await db.shipmentLineItem.update({
      where: { id: items[0].id },
      data: { description: "Electronic Valves (Corrected)" },
    });
    console.log("[test] before resubmitFiling");
    const resubmitResult = await FilingService.resubmitFiling(accountId, "test-user-id", filingId);
    console.log("[test] after resubmitFiling", resubmitResult.filing.filingStatus);
    expect(resubmitResult.filing.filingStatus).toBe("Transmitted");
    const resubmitMessageId = resubmitResult.messageId;

    // Mock an ACCEPTED response
    console.log("[test] before mockResponse ACCEPTED");
    await mockResponse(resubmitMessageId, "ACCEPTED", "Entry accepted.");
    console.log("[test] after mockResponse ACCEPTED");
    filing = await db.customsFiling.findUniqueOrThrow({ where: { id: filingId } });
    expect(filing.filingStatus).toBe("Accepted");

    // 04. Issue a cancellation request on the accepted declaration
    console.log("[test] before cancelFiling");
    const cancelResult = await FilingService.cancelFiling(accountId, "test-user-id", filingId, {});
    console.log("[test] after cancelFiling", cancelResult.filing.filingStatus);
    expect(cancelResult.filing.filingStatus).toBe("CancellationRequested");
    const cancelMessageId = cancelResult.messageId;

    // 05. Mock cancellation acceptance
    console.log("[test] before mockResponse CANCELLED");
    await mockResponse(cancelMessageId, "CANCELLED", "Cancellation confirmed by authority.");
    console.log("[test] after mockResponse CANCELLED");
    filing = await db.customsFiling.findUniqueOrThrow({ where: { id: filingId } });
    expect(filing.filingStatus).toBe("Cancelled");

    // 06. Verify every record the Response tab grid reads is present, with full details
    const messages = await db.filingMessage.findMany({ where: { filingId }, orderBy: { createdAt: "asc" } });

    const outbound = messages.filter((m) => m.direction === "OUTBOUND");
    const inbound = messages.filter((m) => m.direction === "INBOUND");
    expect(outbound.length).toBe(3); // SUBMIT, RESUBMIT, CANCELLATION
    expect(inbound.length).toBe(3); // REJECTED, ACCEPTED, CANCELLED responses

    // This account's FilingActionMessageMapping has no rows for procedureCode "01", so
    // resolveMessageContext takes its documented US backwards-compatibility fallback
    // (CBP_ENTRY_7501) for every action, SUBMIT/RESUBMIT/CANCELLATION alike.
    expect(outbound.map((m) => m.messageName)).toEqual(["CBP_ENTRY_7501", "CBP_ENTRY_7501", "CBP_ENTRY_7501"]);

    // Every inbound row correlates back to the outbound request it answers.
    expect(inbound.find((m) => m.correlationId === submitMessageId)?.status).toBe("REJECTED");
    expect(inbound.find((m) => m.correlationId === resubmitMessageId)?.status).toBe("ACCEPTED");
    expect(inbound.find((m) => m.correlationId === cancelMessageId)?.status).toBe("CANCELLED");

    // The CANCELLATION request itself is a child action against the accepted declaration.
    const cancellationRequest = outbound.find((m) => m.priorMessageId === resubmitMessageId);
    expect(cancellationRequest).toBeTruthy();

    // Full envelope detail survives on every row (what the View/JSON buttons render).
    for (const m of messages) {
      expect(m.envelope).toBeTruthy();
      const envelope = m.envelope as unknown as { header: { messageId: string }; data: object };
      expect(envelope.header.messageId).toBe(m.messageId);
    }

    // CustomsResponse rows (Latest Status / Response History cards) recorded all three responses.
    const responses = await db.customsResponse.findMany({ where: { filingId }, orderBy: { receivedAt: "asc" } });
    expect(responses.map((r) => r.code)).toEqual(["REJECTED", "ACCEPTED", "CANCELLED"]);
  }, DB_TIMEOUT);
});
