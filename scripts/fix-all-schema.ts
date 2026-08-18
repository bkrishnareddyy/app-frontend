import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixAll() {
  try {
    console.log('🔧 Fixing database schema issues...\n');
    
    // 1. Make shipmentId nullable
    console.log('1️⃣ Making CustomsFiling.shipmentId nullable...');
    await prisma.$executeRaw`
      ALTER TABLE "CustomsFiling" 
      ALTER COLUMN "shipmentId" DROP NOT NULL
    `;
    console.log('✅ shipmentId is now nullable\n');
    
    // 2. Create FilingUIConfig table
    console.log('2️⃣ Creating FilingUIConfig table...');
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "FilingUIConfig" (
        "id" TEXT NOT NULL,
        "country" TEXT NOT NULL,
        "procedureCode" TEXT NOT NULL,
        "messageName" TEXT NOT NULL,
        "messageType" TEXT NOT NULL,
        "transactionType" TEXT NOT NULL DEFAULT 'import',
        "configData" JSONB NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "description" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        "createdBy" TEXT,
        "updatedBy" TEXT,

        CONSTRAINT "FilingUIConfig_pkey" PRIMARY KEY ("id")
      )
    `;
    console.log('✅ FilingUIConfig table created\n');
    
    // 3. Create unique constraint and indexes
    console.log('3️⃣ Creating indexes...');
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "FilingUIConfig_country_procedureCode_messageName_messageType_key" 
      ON "FilingUIConfig"("country", "procedureCode", "messageName", "messageType", "transactionType")
    `;
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "FilingUIConfig_isActive_idx" 
      ON "FilingUIConfig"("isActive")
    `;
    console.log('✅ Indexes created\n');
    
    // 4. Create FilingMasterDataSource table
    console.log('4️⃣ Creating FilingMasterDataSource table...');
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "FilingMasterDataSource" (
        "id" TEXT NOT NULL,
        "sourceName" TEXT NOT NULL,
        "sourceType" TEXT NOT NULL,
        "tableName" TEXT,
        "valueField" TEXT,
        "labelField" TEXT,
        "staticOptions" JSONB,
        "apiEndpoint" TEXT,
        "apiMethod" TEXT NOT NULL DEFAULT 'GET',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        "createdBy" TEXT,
        "updatedBy" TEXT,

        CONSTRAINT "FilingMasterDataSource_pkey" PRIMARY KEY ("id")
      )
    `;
    console.log('✅ FilingMasterDataSource table created\n');
    
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "FilingMasterDataSource_sourceName_key" 
      ON "FilingMasterDataSource"("sourceName")
    `;
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "FilingMasterDataSource_sourceName_idx" 
      ON "FilingMasterDataSource"("sourceName")
    `;
    console.log('✅ Indexes for FilingMasterDataSource created\n');
    
    console.log('🎉 All schema fixes applied successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixAll();
