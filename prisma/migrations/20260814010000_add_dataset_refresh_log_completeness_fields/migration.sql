-- Add structured completeness-check fields to DatasetRefreshLog:
-- sourceReportedTotal (the source's own authoritative record count, e.g.
-- OFAC XML's Record_Count) and sourcePublishDate (the source's declared
-- publish/version date), so ingestion completeness can be verified and
-- audited without parsing free-text summaries.
ALTER TABLE "DatasetRefreshLog" ADD COLUMN "sourceReportedTotal" INTEGER;
ALTER TABLE "DatasetRefreshLog" ADD COLUMN "sourcePublishDate" TIMESTAMP(3);
