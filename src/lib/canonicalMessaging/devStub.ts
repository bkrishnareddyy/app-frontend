import { db } from "@/lib/db";
import { PgCanonicalMessageConsumer } from "./consumer";
import { processInboundMessage } from "./inboundConsumer";
import { extractCanonicalResponseStatus } from "./responseStatus";
import type { CanonicalFilingRequestData, CanonicalFilingResponseData, CanonicalMessage } from "./types";

/**
 * DEV-ONLY: answers one specific just-published OUTBOUND message inline.
 */
export async function simulateThirdPartyResponse(outboundMessageId: string): Promise<boolean> {
  const pending = await db.filingMessage.findFirst({
    where: { messageId: outboundMessageId, direction: "OUTBOUND", queueStatus: "PENDING" },
  });
  if (!pending) return false;

  const request = pending.envelope as unknown as CanonicalMessage<CanonicalFilingRequestData>;
  const isCancellation = request.header.messageName.includes("CANCELLATION");
  const responseMessageId = `resp_${pending.messageId}`;
  const responseDeclaration = JSON.parse(JSON.stringify(request.data.declaration));

  let isImport = "ImportDeclaration" in responseDeclaration;
  let isExport = "ExportDeclaration" in responseDeclaration;
  let declarationKey: string | null = isImport ? "ImportDeclaration" : isExport ? "ExportDeclaration" : null;

  if (!declarationKey && responseDeclaration.GoodsDeclaration) {
    const procedure = request.header.procedure || "";
    isImport = procedure.toUpperCase().startsWith("H") || procedure.includes("IMP") || !procedure.toUpperCase().startsWith("E");
    isExport = !isImport;
    declarationKey = isImport ? "ImportDeclaration" : "ExportDeclaration";
    const wrappedData = { [declarationKey]: responseDeclaration };
    Object.assign(responseDeclaration, wrappedData);
    delete responseDeclaration.GoodsDeclaration;
  }

  if (declarationKey && responseDeclaration[declarationKey]?.GoodsDeclaration) {
    const goodsDecl = responseDeclaration[declarationKey].GoodsDeclaration;

    if (isCancellation) {
      goodsDecl.ResponseCode = "09";
      goodsDecl.ResponseDescription = "[DEV STUB] Declaration cancelled - no real authority transmission occurred.";
      goodsDecl.StatusCode = "CANCELLED";
    } else {
      const mrn = `${request.header.country}${Date.now().toString().slice(-12)}`;
      goodsDecl.MRN = mrn;
      goodsDecl.ResponseCode = "00";
      goodsDecl.ResponseDescription = "[DEV STUB] Declaration accepted - no real authority transmission occurred.";
      goodsDecl.StatusCode = "ACCEPTED";

      if (isImport) {
        const releaseDate = new Date();
        releaseDate.setMinutes(releaseDate.getMinutes() + 15);
        goodsDecl.ReleaseInformation = {
          ReleaseDate: releaseDate.toISOString(),
          ReleaseCSVId: `REL-${Date.now()}`,
        };

        const goodsShipment = responseDeclaration[declarationKey].GoodsShipment;
        if (goodsShipment?.GovernmentAgencyGoodsItem) {
          goodsShipment.GovernmentAgencyGoodsItem.forEach((item: any) => {
            if (!item.CustomsValuation) item.CustomsValuation = {};
            item.CustomsValuation.DutyTaxFeeAssessed = Math.round(
              (item.CustomsValuation?.ChargeableAmount || 1000) * 0.028 * 100
            ) / 100;
          });
        }
      }
    }
  }

  const response: CanonicalMessage<CanonicalFilingResponseData> = {
    header: {
      messageId: responseMessageId,
      filingId: request.header.filingId,
      correlationId: request.header.messageId,
      messageName: "CUSTOMS_DECLARATION_RESPONSE",
      direction: "INBOUND",
      customer: request.header.customer,
      procedure: request.header.procedure,
      country: request.header.country,
      dateTime: new Date().toISOString(),
      schemaVersion: request.header.schemaVersion,
      senderSystem: "DEV_STUB_THIRD_PARTY",
    },
    data: {
      declaration: responseDeclaration,
    },
  };

  await db.$transaction([
    db.filingMessage.update({
      where: { id: pending.id },
      data: { queueStatus: "PROCESSED", processedAt: new Date() },
    }),
    db.filingMessage.create({
      data: {
        accountId: request.header.customer.accountId,
        filingId: request.header.filingId,
        messageId: responseMessageId,
        correlationId: request.header.messageId,
        messageName: "CUSTOMS_DECLARATION_RESPONSE",
        direction: "INBOUND",
        procedure: request.header.procedure,
        country: request.header.country,
        status: extractCanonicalResponseStatus(response.data),
        envelope: response as unknown as object,
        queueStatus: "PENDING",
      },
    }),
  ]);

  return true;
}

export async function simulateAndApplyResponse(outboundMessageId: string): Promise<boolean> {
  if (process.env.CUSTOMS_FILING_MOCK_RESPONSES === "false") return false;
  const answered = await simulateThirdPartyResponse(outboundMessageId);
  if (!answered) return false;
  await new PgCanonicalMessageConsumer().consume("inbound", processInboundMessage);
  return true;
}
