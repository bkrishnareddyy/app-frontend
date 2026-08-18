import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTables() {
  try {
    console.log('🔍 Checking table existence in database...\n');
    
    const tables = [
      'FilingSchemaVersion',
      'FilingMasterDataSource',
      'FilingActionCatalog',
      'FilingActionConfiguration'
    ];
    
    for (const table of tables) {
      try {
        const result = await prisma.$queryRaw`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = ${table}
          )
        ` as any[];
        
        const exists = result[0]?.exists;
        
        if (exists) {
          // Check row count
          const countResult = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "${table}"`) as any[];
          const count = parseInt(countResult[0]?.count || '0');
          console.log(`✅ ${table}: EXISTS (${count} rows)`);
        } else {
          console.log(`❌ ${table}: DOES NOT EXIST`);
        }
      } catch (error: any) {
        console.log(`❌ ${table}: ERROR - ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTables();
