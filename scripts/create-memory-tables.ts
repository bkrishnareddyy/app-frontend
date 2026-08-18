import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createMemoryTables() {
  try {
    console.log('🔧 Creating Account Memory tables...\n');
    
    // Create enums
    console.log('1️⃣ Creating enums...');
    await prisma.$executeRaw`
      CREATE TYPE "AccountMemoryType" AS ENUM ('FACT', 'PREFERENCE', 'PROCEDURE', 'DECISION', 'EXCEPTION', 'PATTERN')
    `;
    await prisma.$executeRaw`
      CREATE TYPE "AccountMemorySubjectType" AS ENUM ('PRODUCT', 'SUPPLIER', 'CLASSIFICATION', 'ORIGIN', 'VALUATION', 'FILING', 'SHIPMENT')
    `;
    await prisma.$executeRaw`
      CREATE TYPE "AccountMemorySourceType" AS ENUM ('HUMAN_DECISION', 'FILING_OUTCOME', 'VERIFIED_DOCUMENT', 'AGENT_INFERENCE')
    `;
    console.log('✅ Enums created\n');
    
    // Create AccountMemory table
    console.log('2️⃣ Creating AccountMemory table...');
    await prisma.$executeRaw`
      CREATE TABLE "AccountMemory" (
        "id" TEXT NOT NULL,
        "accountId" TEXT NOT NULL,
        "type" "AccountMemoryType" NOT NULL,
        "subjectType" "AccountMemorySubjectType" NOT NULL,
        "subjectId" TEXT,
        "content" TEXT NOT NULL,
        "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "validUntil" TIMESTAMP(3),
        "sourceType" "AccountMemorySourceType" NOT NULL,
        "sourceId" TEXT,
        "supersedesMemoryId" TEXT,
        "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
        "searchVector" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "AccountMemory_pkey" PRIMARY KEY ("id")
      )
    `;
    console.log('✅ AccountMemory table created\n');
    
    // Create MemoryEvidence table
    console.log('3️⃣ Creating MemoryEvidence table...');
    await prisma.$executeRaw`
      CREATE TABLE "MemoryEvidence" (
        "id" TEXT NOT NULL,
        "accountId" TEXT NOT NULL,
        "memoryId" TEXT NOT NULL,
        "sourceType" "AccountMemorySourceType" NOT NULL,
        "sourceId" TEXT,
        "excerpt" TEXT NOT NULL,
        "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "MemoryEvidence_pkey" PRIMARY KEY ("id")
      )
    `;
    console.log('✅ MemoryEvidence table created\n');
    
    // Create foreign keys
    console.log('4️⃣ Creating foreign keys...');
    await prisma.$executeRaw`
      ALTER TABLE "AccountMemory" 
      ADD CONSTRAINT "AccountMemory_accountId_fkey" 
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
    `;
    await prisma.$executeRaw`
      ALTER TABLE "AccountMemory" 
      ADD CONSTRAINT "AccountMemory_supersedesMemoryId_fkey" 
      FOREIGN KEY ("supersedesMemoryId") REFERENCES "AccountMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE
    `;
    await prisma.$executeRaw`
      ALTER TABLE "MemoryEvidence" 
      ADD CONSTRAINT "MemoryEvidence_accountId_fkey" 
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
    `;
    await prisma.$executeRaw`
      ALTER TABLE "MemoryEvidence" 
      ADD CONSTRAINT "MemoryEvidence_memoryId_fkey" 
      FOREIGN KEY ("memoryId") REFERENCES "AccountMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE
    `;
    console.log('✅ Foreign keys created\n');
    
    // Create indexes
    console.log('5️⃣ Creating indexes...');
    await prisma.$executeRaw`CREATE INDEX "AccountMemory_accountId_idx" ON "AccountMemory"("accountId")`;
    await prisma.$executeRaw`CREATE INDEX "AccountMemory_accountId_type_idx" ON "AccountMemory"("accountId", "type")`;
    await prisma.$executeRaw`CREATE INDEX "AccountMemory_accountId_subjectType_subjectId_idx" ON "AccountMemory"("accountId", "subjectType", "subjectId")`;
    await prisma.$executeRaw`CREATE INDEX "AccountMemory_supersedesMemoryId_idx" ON "AccountMemory"("supersedesMemoryId")`;
    await prisma.$executeRaw`CREATE INDEX "MemoryEvidence_accountId_idx" ON "MemoryEvidence"("accountId")`;
    await prisma.$executeRaw`CREATE INDEX "MemoryEvidence_memoryId_idx" ON "MemoryEvidence"("memoryId")`;
    console.log('✅ Indexes created\n');
    
    console.log('🎉 Account Memory tables created successfully!');
    
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      console.log('⚠️  Tables already exist, skipping...');
    } else {
      console.error('❌ Error:', error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

createMemoryTables();
