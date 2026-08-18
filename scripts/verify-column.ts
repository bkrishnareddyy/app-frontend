import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verify() {
  try {
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'FilingProcedureConfig' 
      AND column_name = 'canCreateNewFiling'
    ` as any[];
    
    if (result.length === 0) {
      console.log('❌ canCreateNewFiling column does NOT exist!\n');
      console.log('Attempting to add it now...\n');
      
      await prisma.$executeRaw`
        ALTER TABLE "FilingProcedureConfig" 
        ADD COLUMN "canCreateNewFiling" BOOLEAN NOT NULL DEFAULT true
      `;
      
      console.log('✅ Column added!\n');
    } else {
      console.log('✅ canCreateNewFiling column exists:');
      console.log(`   Type: ${result[0].data_type}`);
      console.log(`   Default: ${result[0].column_default}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
