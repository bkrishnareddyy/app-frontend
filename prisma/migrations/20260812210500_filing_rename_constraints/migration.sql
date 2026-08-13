-- AlterTable
ALTER TABLE "FilingMessage" RENAME CONSTRAINT "CustomsFilingMessage_pkey" TO "FilingMessage_pkey";

-- AlterTable
ALTER TABLE "FilingMessageActionCatalog" RENAME CONSTRAINT "CanonicalMessageAction_pkey" TO "FilingMessageActionCatalog_pkey";

-- AlterTable
ALTER TABLE "FilingResponseStatusMapping" RENAME CONSTRAINT "CanonicalResponseStatusMapping_pkey" TO "FilingResponseStatusMapping_pkey";

-- AlterTable
ALTER TABLE "FilingSchemaVersion" RENAME CONSTRAINT "CanonicalSchemaVersion_pkey" TO "FilingSchemaVersion_pkey";

-- RenameForeignKey
ALTER TABLE "FilingMessage" RENAME CONSTRAINT "CustomsFilingMessage_accountId_fkey" TO "FilingMessage_accountId_fkey";

-- RenameForeignKey
ALTER TABLE "FilingMessage" RENAME CONSTRAINT "CustomsFilingMessage_filingId_fkey" TO "FilingMessage_filingId_fkey";

-- RenameIndex
ALTER INDEX "CustomsFilingMessage_accountId_idx" RENAME TO "FilingMessage_accountId_idx";

-- RenameIndex
ALTER INDEX "CustomsFilingMessage_correlationId_idx" RENAME TO "FilingMessage_correlationId_idx";

-- RenameIndex
ALTER INDEX "CustomsFilingMessage_filingId_idx" RENAME TO "FilingMessage_filingId_idx";

-- RenameIndex
ALTER INDEX "CustomsFilingMessage_messageId_key" RENAME TO "FilingMessage_messageId_key";

-- RenameIndex
ALTER INDEX "CustomsFilingMessage_queueStatus_createdAt_idx" RENAME TO "FilingMessage_queueStatus_createdAt_idx";

-- RenameIndex
ALTER INDEX "CanonicalResponseStatusMapping_country_messageName_canonica_key" RENAME TO "FilingResponseStatusMapping_country_messageName_canonicalSt_key";

-- RenameIndex
ALTER INDEX "CanonicalSchemaVersion_schemaType_status_idx" RENAME TO "FilingSchemaVersion_schemaType_status_idx";

-- RenameIndex
ALTER INDEX "CanonicalSchemaVersion_schemaType_version_key" RENAME TO "FilingSchemaVersion_schemaType_version_key";

