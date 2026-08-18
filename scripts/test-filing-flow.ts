/**
 * Test script to verify filing flow end-to-end
 * Run with: npx tsx scripts/test-filing-flow.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ log: ["warn", "error"] });

async function main() {
  console.log("\n🔍 Checking Filing System State...\n");

  // 1. Find the most recent filing
  const recentFiling = await db.customsFiling.findFirst({
    where: {
      shipmentId: null, // Standalone filings only
    },
    orderBy: { createdAt: "desc" },
    include: {
      transactionType: true,
    },
  });

  if (!recentFiling) {
    console.log("❌ No standalone filings found");
    return;
  }

  console.log("📄 Most Recent Standalone Filing:");
  console.log(`   ID: ${recentFiling.id}`);
  console.log(`   Entry Number: ${recentFiling.entryNumber}`);
  console.log(`   Local Reference Number: ${recentFiling.localReferenceNumber || "NOT SET"}`);
  console.log(`   Registration Number: ${recentFiling.registrationNumber || "NOT SET"}`);
  console.log(`   Status: ${recentFiling.filingStatus}`);
  console.log(`   Country: ${recentFiling.country}`);
  console.log(`   Transaction Type: ${recentFiling.transactionType?.name || "NOT SET"}`);
  console.log(`   Created: ${recentFiling.createdAt.toISOString()}`);

  // 2. Check if declaration data exists
  const dutyBreakdown = recentFiling.dutyBreakdown as any;
  if (dutyBreakdown?.declarationDraft) {
    console.log("\n✅ Declaration Data Found:");
    const declaration = dutyBreakdown.declarationDraft;
    const declarationType = Object.keys(declaration)[0]; // ImportDeclaration or ExportDeclaration
    console.log(`   Type: ${declarationType}`);
    
    if (declaration[declarationType]?.GoodsDeclaration) {
      const goodsDecl = declaration[declarationType].GoodsDeclaration;
      console.log(`   Reference Number: ${goodsDecl.ReferenceNumber || "NOT SET"}`);
      console.log(`   Declaration Number: ${goodsDecl.DeclarationNumber || "NOT SET"}`);
    }
    
    if (declaration[declarationType]?.GoodsShipment?.GovernmentAgencyGoodsItem) {
      const items = declaration[declarationType].GoodsShipment.GovernmentAgencyGoodsItem;
      console.log(`   Line Items: ${items.length}`);
    }
  } else {
    console.log("\n⚠️  No declaration data found in dutyBreakdown.declarationDraft");
  }

  // 3. Check outbound messages
  const outboundMessages = await db.filingMessage.findMany({
    where: {
      filingId: recentFiling.id,
      direction: "OUTBOUND",
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\n📤 Outbound Messages: ${outboundMessages.length}`);
  outboundMessages.forEach((msg, idx) => {
    console.log(`   [${idx + 1}] ${msg.messageName} - ${msg.queueStatus} - ${msg.createdAt.toISOString()}`);
    if (msg.queueStatus === "PENDING") {
      console.log(`       ⚠️  Still PENDING - mock response not generated yet`);
    }
  });

  // 4. Check inbound messages (responses)
  const inboundMessages = await db.filingMessage.findMany({
    where: {
      filingId: recentFiling.id,
      direction: "INBOUND",
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\n📥 Inbound Messages (Responses): ${inboundMessages.length}`);
  inboundMessages.forEach((msg, idx) => {
    console.log(`   [${idx + 1}] ${msg.messageName} - ${msg.status || "N/A"} - ${msg.queueStatus}`);
    
    const envelope = msg.envelope as any;
    if (envelope?.data?.declaration) {
      const declaration = envelope.data.declaration;
      const declarationType = Object.keys(declaration)[0];
      if (declaration[declarationType]?.GoodsDeclaration) {
        const goodsDecl = declaration[declarationType].GoodsDeclaration;
        console.log(`       MRN: ${goodsDecl.MRN || "NOT SET"}`);
        console.log(`       ResponseCode: ${goodsDecl.ResponseCode || "NOT SET"}`);
        console.log(`       StatusCode: ${goodsDecl.StatusCode || "NOT SET"}`);
      }
    }
  });

  // 5. Check customs responses (UI surface)
  const responses = await db.customsResponse.findMany({
    where: { filingId: recentFiling.id },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\n📋 Customs Responses (UI): ${responses.length}`);
  responses.forEach((resp, idx) => {
    console.log(`   [${idx + 1}] ${resp.title}`);
    console.log(`       Code: ${resp.code}`);
    console.log(`       Description: ${resp.description}`);
    console.log(`       Received: ${resp.receivedAt.toISOString()}`);
  });

  console.log("\n✅ Check complete!\n");
}

main()
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
