import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function test() {
  console.log('🧪 Testing Save/Load Flow\n');
  
  // 1. Create a test filing
  console.log('1️⃣ Creating test filing...');
  const filing = await prisma.customsFiling.create({
    data: {
      accountId: 'cmsj8561v0001fxmeg9xfy7kr',
      entryNumber: `TEST_${Date.now()}`,
      country: 'NL',
      transactionType: 'IMPORT',
      filingStatus: 'Draft',
      filingType: 'STANDARD',
      direction: 'INBOUND',
      entryType: 'Type86',
      portOfEntry: 'AMS',
      transportMode: 'VESSEL',
      dutyBreakdown: {}
    }
  });
  console.log(`✅ Created filing: ${filing.id}\n`);
  
  // 2. Simulate saving declaration data (unwrapped, as client sends it)
  console.log('2️⃣ Simulating Save Draft (client → API)...');
  const clientData = {
    GoodsDeclaration: {
      ReferenceNumber: 'LRN_TEST_001',
      FunctionCode: '9',
      DeclarationNumber: 'TEST123'
    },
    GoodsShipment: {
      Consignment: {
        containerCode: '1'
      }
    }
  };
  console.log('Client sends (unwrapped):', JSON.stringify(clientData, null, 2));
  
  // What API should do: wrap it
  const { wrapDeclarationData } = await import('../src/lib/canonicalMessaging/declarationBuilder.js');
  const wrappedData = wrapDeclarationData(clientData, 'IMPORT', 'NL');
  console.log('\nAPI wraps it as:', JSON.stringify(wrappedData, null, 2));
  
  // Save to DB
  await prisma.customsFiling.update({
    where: { id: filing.id },
    data: {
      dutyBreakdown: { declarationDraft: wrappedData } as any
    }
  });
  console.log('\n✅ Saved to database (wrapped)\n');
  
  // 3. Simulate loading (API → client)
  console.log('3️⃣ Simulating Load (API → client)...');
  const saved = await prisma.customsFiling.findUnique({
    where: { id: filing.id },
    select: { dutyBreakdown: true }
  });
  
  let loadedData = (saved?.dutyBreakdown as any)?.declarationDraft;
  console.log('From DB (wrapped):', JSON.stringify(loadedData, null, 2));
  
  // What API should do: unwrap it
  if (loadedData?.ImportDeclaration) {
    loadedData = loadedData.ImportDeclaration;
  } else if (loadedData?.ExportDeclaration) {
    loadedData = loadedData.ExportDeclaration;
  }
  console.log('\nAPI unwraps and returns:', JSON.stringify(loadedData, null, 2));
  
  // 4. Verify
  console.log('\n4️⃣ Verification:');
  const matches = 
    loadedData.GoodsDeclaration.ReferenceNumber === clientData.GoodsDeclaration.ReferenceNumber &&
    loadedData.GoodsDeclaration.FunctionCode === clientData.GoodsDeclaration.FunctionCode &&
    loadedData.GoodsShipment.Consignment.containerCode === clientData.GoodsShipment.Consignment.containerCode;
  
  if (matches) {
    console.log('✅ SUCCESS: Data round-tripped correctly!');
    console.log('✅ Client sent unwrapped data');
    console.log('✅ API wrapped before saving');
    console.log('✅ API unwrapped before returning');
    console.log('✅ Client receives same structure it sent');
  } else {
    console.log('❌ FAILED: Data mismatch!');
  }
  
  // Cleanup
  console.log(`\n🧹 Cleaning up test filing ${filing.id}...`);
  await prisma.customsFiling.delete({ where: { id: filing.id } });
  console.log('✅ Deleted\n');
  
  await prisma.$disconnect();
}

test().catch(console.error);
