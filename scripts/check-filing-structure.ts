import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const filingId = process.argv[2] || 'cmsxclrsq0001ednkr0v9x27z';
  
  const filing = await prisma.customsFiling.findUnique({
    where: { id: filingId }
  });
  
  if (!filing) {
    console.log('❌ Filing not found');
    await prisma.$disconnect();
    return;
  }
  
  console.log('📋 Filing:', filing.id);
  console.log('📊 Status:', filing.status);
  console.log('📦 ShipmentId:', filing.shipmentId);
  console.log('\n📄 DutyBreakdown structure:');
  console.log(JSON.stringify(filing.dutyBreakdown, null, 2));
  
  // Check if it's a standalone filing with declarationDraft
  if (filing.shipmentId === null && filing.dutyBreakdown) {
    const draft = (filing.dutyBreakdown as any)?.declarationDraft;
    if (draft) {
      console.log('\n✅ Has declarationDraft');
      console.log('Keys:', Object.keys(draft));
      if (draft.ImportDeclaration) {
        console.log('✅ Wrapped in ImportDeclaration');
        console.log('GoodsDeclaration:', draft.ImportDeclaration.GoodsDeclaration);
      } else if (draft.ExportDeclaration) {
        console.log('✅ Wrapped in ExportDeclaration');
      } else {
        console.log('⚠️ Not wrapped, direct structure');
      }
    } else {
      console.log('\n❌ No declarationDraft found');
    }
  }
  
  await prisma.$disconnect();
}

check();
