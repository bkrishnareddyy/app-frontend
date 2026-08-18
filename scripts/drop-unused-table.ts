import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function dropUnusedTable() {
  try {
    console.log('🗑️  Dropping unused FilingSchemaVersion table...\n');
    
    await prisma.$executeRaw`DROP TABLE IF EXISTS "FilingSchemaVersion" CASCADE`;
    
    console.log('✅ FilingSchemaVersion table dropped successfully!\n');
    console.log('Note: FilingMasterDataSource is KEPT - it is actively used by the master-data API.');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

dropUnusedTable();
