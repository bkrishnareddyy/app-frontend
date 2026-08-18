import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function apply() {
  try {
    console.log('🔧 Applying missing canCreateNewFiling column...\n');
    
    await prisma.$executeRaw`
      ALTER TABLE "FilingProcedureConfig" 
      ADD COLUMN IF NOT EXISTS "canCreateNewFiling" BOOLEAN NOT NULL DEFAULT true
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "FilingProcedureConfig_canCreateNewFiling_idx" 
      ON "FilingProcedureConfig"("canCreateNewFiling")
    `;
    
    console.log('✅ Column and index added successfully!\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

apply();
