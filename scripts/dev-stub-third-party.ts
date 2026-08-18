/**
 * DEV-ONLY stand-in for the real third-party filing service. Polls OUTBOUND
 * PENDING FilingMessage rows (what the real third party would read off
 * the outbound queue), "renders and transmits" (does nothing, this is a
 * stub), and writes back a corresponding INBOUND response row -- exercising
 * exactly the same schema/correlation path a real integration will use.
 *
 * This is explicitly a simulation, not a provider: it always answers
 * ACCEPTED. It exists so the outbound-publish -> inbound-consume loop can be
 * exercised end-to-end in local development without a real third party.
 *
 * Run with: npx tsx scripts/dev-stub-third-party.ts
 */
import { PrismaClient } from "@prisma/client";
import type { CanonicalFilingRequestData, CanonicalFilingResponseData, CanonicalMessage } from "@/lib/canonicalMessaging/types";

const db = new PrismaClient({ log: ["warn", "error"] });

async function processOnePending(): Promise<boolean> {
  const pending = await db.filingMessage.findFirst({
    where: { direction: "OUTBOUND", queueStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  if (!pending) return false;

  const request = pending.envelope as unknown as CanonicalMessage<CanonicalFilingRequestData>;
  console.log(`[dev-stub-third-party] Received ${request.header.messageName} (messageId=${request.header.messageId})`);

  const responseMessageId = `resp_${pending.messageId}`;
  
  // Clone the request declaration and populate response fields
  const responseDeclaration = JSON.parse(JSON.stringify(request.data.declaration));
  
  // Detect declaration type (with backwards compatibility for missing wrappers)
  let isImport = 'ImportDeclaration' in responseDeclaration;
  let isExport = 'ExportDeclaration' in responseDeclaration;
  let declarationKey: string | null = isImport ? 'ImportDeclaration' : isExport ? 'ExportDeclaration' : null;

  // Handle legacy format without wrapper - infer from procedure code
  if (!declarationKey && responseDeclaration.GoodsDeclaration) {
    // Infer type from procedure code (H* = import, E* = export, or fallback to import)
    const procedure = request.header.procedure || "";
    isImport = procedure.toUpperCase().startsWith("H") || procedure.includes("IMP") || !procedure.toUpperCase().startsWith("E");
    isExport = !isImport;
    declarationKey = isImport ? 'ImportDeclaration' : 'ExportDeclaration';
    
    // Wrap the legacy data
    const wrappedData = {
      [declarationKey]: responseDeclaration
    };
    Object.assign(responseDeclaration, wrappedData);
    // Clear the unwrapped GoodsDeclaration at root
    delete (responseDeclaration as any).GoodsDeclaration;
    
    console.log(`[dev-stub-third-party] Wrapped legacy format in ${declarationKey}`);
  }

  if (declarationKey && responseDeclaration[declarationKey]?.GoodsDeclaration) {
    const goodsDecl = responseDeclaration[declarationKey].GoodsDeclaration;
    
    // Populate acceptance response fields
    const mrn = `${request.header.country}${Date.now().toString().slice(-12)}`;
    goodsDecl.MRN = mrn;
    goodsDecl.ResponseCode = "00";
    goodsDecl.ResponseDescription = "[DEV STUB] Declaration accepted - no real authority transmission occurred.";
    goodsDecl.StatusCode = "ACCEPTED";
    
    // Add release information for imports
    if (isImport) {
      const releaseDate = new Date();
      releaseDate.setMinutes(releaseDate.getMinutes() + 15); // Release in 15 minutes
      
      goodsDecl.ReleaseInformation = {
        ReleaseDate: releaseDate.toISOString(),
        ReleaseCSVId: `REL-${Date.now()}`,
      };
      
      // Add mock duty assessments if line items exist
      const goodsShipment = responseDeclaration[declarationKey].GoodsShipment;
      if (goodsShipment?.GovernmentAgencyGoodsItem) {
        goodsShipment.GovernmentAgencyGoodsItem.forEach((item: any) => {
          if (!item.CustomsValuation) {
            item.CustomsValuation = {};
          }
          // Mock duty assessment
          item.CustomsValuation.DutyTaxFeeAssessed = Math.round(
            (item.CustomsValuation?.ChargeableAmount || 1000) * 0.028 * 100
          ) / 100;
        });
      }
    }
    
    console.log(`[dev-stub-third-party] Populated response fields: MRN=${mrn}, ResponseCode=${goodsDecl.ResponseCode}`);
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
        status: response.data.status,
        envelope: response as unknown as object,
        queueStatus: "PENDING", // picked up next by the real inbound consumer
      },
    }),
  ]);

  console.log(`[dev-stub-third-party] Responded ACCEPTED (correlationId=${request.header.messageId})`);
  return true;
}

async function main() {
  console.log("[dev-stub-third-party] Draining pending outbound messages...");
  let processed = 0;
  while (await processOnePending()) processed++;
  console.log(`[dev-stub-third-party] Done. Processed ${processed} message(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
