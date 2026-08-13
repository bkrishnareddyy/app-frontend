-- Rename canonical-messaging tables to the Filing* naming convention.
-- Plain RENAME (not drop+recreate) so existing seeded/reference data survives.
ALTER TABLE "CustomsFilingMessage" RENAME TO "FilingMessage";
ALTER TABLE "CanonicalSchemaVersion" RENAME TO "FilingSchemaVersion";
ALTER TABLE "CanonicalResponseStatusMapping" RENAME TO "FilingResponseStatusMapping";
ALTER TABLE "CanonicalMessageAction" RENAME TO "FilingMessageActionCatalog";
