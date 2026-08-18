/**
 * Complete end-to-end verification after transmission
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const filingId = "cmsxc9r0o0001edokzq5wf2ms";

  console.log("\n🔍 Complete E2E Verification\n");
  console.log("=" .repeat(60));

  // 1. Filing status
  const filing = await db.customsFiling.findUnique({
    where: { id: filingId },
    select: { 
      id: true,
      entryNumber: true,
      localReferenceNumber: true,
      filingStatus: true,
      dutyBreakdown: true,
    },
  });

  console.log("\n📄 FILING STATUS:");
  console.log(`   ID: ${filing?.id}`);
  console.log(`   Entry Number: ${filing?.entryNumber}`);
  console.log(`   LRN: ${filing?.localReferenceNumber}`);
  console.log(`   Status: ${filing?.filingStatus}`);

  // 2. Outbound message
  const outbound = await db.filingMessage.findFirst({
    where: { filingId, direction: "OUTBOUND" },
    orderBy: { createdAt: "desc" },
  });

  console.log("\n📤 OUTBOUND MESSAGE:");
  if (outbound) {
    console.log(`   Message ID: ${outbound.messageId}`);
    console.log(`   Queue Status: ${outbound.queueStatus}`);
    console.log(`   Created: ${outbound.createdAt.toISOString()}`);
    
    const envelope = outbound.envelope as any;
    const declaration = envelope?.data?.declaration;
    if (declaration?.ImportDeclaration) {
      console.log(`   ✅ Has ImportDeclaration wrapper`);
      console.log(`   Reference: ${declaration.ImportDeclaration.GoodsDeclaration?.ReferenceNumber}`);
    } else {
      console.log(`   ❌ Missing ImportDeclaration wrapper`);
    }
  } else {
    console.log(`   ❌ No outbound message found`);
  }

  // 3. Inbound message (response)
  const inbound = await db.filingMessage.findFirst({
    where: { filingId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
  });

  console.log("\n📥 INBOUND MESSAGE (Response):");
  if (inbound) {
    console.log(`   Message ID: ${inbound.messageId}`);
    console.log(`   Correlation ID: ${inbound.correlationId}`);
    console.log(`   Queue Status: ${inbound.queueStatus}`);
    console.log(`   Created: ${inbound.createdAt.toISOString()}`);
    
    const envelope = inbound.envelope as any;
    const declaration = envelope?.data?.declaration;
    
    if (declaration?.ImportDeclaration?.GoodsDeclaration) {
      const goodsDecl = declaration.ImportDeclaration.GoodsDeclaration;
      console.log(`   ✅ Has ImportDeclaration wrapper`);
      console.log(`   MRN: ${goodsDecl.MRN || "NOT SET"}`);
      console.log(`   ResponseCode: ${goodsDecl.ResponseCode || "NOT SET"}`);
      console.log(`   StatusCode: ${goodsDecl.StatusCode || "NOT SET"}`);
      console.log(`   ResponseDescription: ${goodsDecl.ResponseDescription || "NOT SET"}`);
      
      if (goodsDecl.ReleaseInformation) {
        console.log(`   ✅ Has ReleaseInformation:`);
        console.log(`      Release Date: ${goodsDecl.ReleaseInformation.ReleaseDate || "NOT SET"}`);
        console.log(`      Release CSV ID: ${goodsDecl.ReleaseInformation.ReleaseCSVId || "NOT SET"}`);
      }
    } else {
      console.log(`   ❌ Missing ImportDeclaration wrapper or response fields not populated`);
    }
  } else {
    console.log(`   ❌ No inbound message found`);
  }

  // 4. CustomsResponse (UI surface)
  const responses = await db.customsResponse.findMany({
    where: { filingId },
    orderBy: { createdAt: "desc" },
  });

  console.log("\n📋 CUSTOMS RESPONSES (UI):");
  if (responses.length > 0) {
    responses.forEach((resp, idx) => {
      console.log(`   [${idx + 1}] ${resp.title}`);
      console.log(`       Code: ${resp.code}`);
      console.log(`       Status: ${resp.status}`);
      console.log(`       Description: ${resp.description}`);
      console.log(`       Received: ${resp.receivedAt.toISOString()}`);
    });
  } else {
    console.log(`   ❌ No customs responses found`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n✅ Verification complete!\n");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
