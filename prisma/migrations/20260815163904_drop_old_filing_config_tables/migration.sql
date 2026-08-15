-- Drop old filing configuration tables that are replaced by new multi-country design

-- Drop indexes first (if they exist)
DROP INDEX IF EXISTS "FilingResponseStatusMapping_country_messageName_canonicalStat_idx";
DROP INDEX IF EXISTS "FilingMessageCatalog_action_country_procedureCode_idx";
DROP INDEX IF EXISTS "FilingActionRule_country_procedureCode_messageName_status_idx";
DROP INDEX IF EXISTS "FilingChildActionRule_country_procedureCode_messageName_sta_idx";
DROP INDEX IF EXISTS "FilingProcedureMapping_entryType_country_idx";

-- Drop old tables
DROP TABLE IF EXISTS "FilingResponseStatusMapping";
DROP TABLE IF EXISTS "FilingMessageActionCatalog";
DROP TABLE IF EXISTS "FilingMessageCatalog";
DROP TABLE IF EXISTS "FilingActionRule";
DROP TABLE IF EXISTS "FilingChildActionRule";
DROP TABLE IF EXISTS "FilingAuthorityConfig";
DROP TABLE IF EXISTS "FilingProcedureMapping";

-- Note: These tables are replaced by:
-- - FilingTransactionType (replaces US entry type concept)
-- - FilingActionCatalog (replaces FilingMessageActionCatalog)
-- - FilingProcedureConfig (replaces FilingProcedureMapping with new structure)
-- - FilingActionMessageMapping (replaces FilingMessageCatalog)
-- - FilingActionConfiguration (replaces FilingActionRule + FilingChildActionRule)
-- - Country field in filings (replaces FilingAuthorityConfig)
