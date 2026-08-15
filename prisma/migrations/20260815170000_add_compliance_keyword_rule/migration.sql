-- CreateTable
CREATE TABLE "ComplianceKeywordRule" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'CONTAINS',
    "citation" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'HIGH',
    "authority" TEXT NOT NULL DEFAULT 'US BIS / Dept of Commerce',
    "publicationStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceKeywordRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceKeywordRule_category_idx" ON "ComplianceKeywordRule"("category");

-- CreateIndex
CREATE INDEX "ComplianceKeywordRule_publicationStatus_idx" ON "ComplianceKeywordRule"("publicationStatus");
