import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  try {
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'CustomsFiling' 
      AND column_name IN ('localReferenceNumber', 'registrationNumber', 'messageName')
      ORDER BY column_name
    ` as any[];
    
    console.log('\n📋 Columns in CustomsFiling table:');
    if (result.length === 0) {
      console.log('❌ NONE of the columns exist!');
      console.log('\nMissing columns:');
      console.log('  - localReferenceNumber');
      console.log('  - registrationNumber');
      console.log('  - messageName');
    } else {
      result.forEach((row: any) => {
        console.log(`✅ ${row.column_name}: ${row.data_type}`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

check();
