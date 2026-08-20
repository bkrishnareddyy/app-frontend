import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { dailyComplianceAuditJob } from "@/lib/inngest/functions/dailyComplianceAudit";
import { dailyWorkMetricSnapshotJob } from "@/lib/inngest/functions/dailyWorkMetricSnapshot";
import { ofacSdnIngestJob } from "@/lib/inngest/functions/ofacSdnIngest";
import { htsRefreshJob } from "@/lib/inngest/functions/htsRefresh";
import { accountMemoryExtractionJob } from "@/lib/inngest/functions/accountMemoryExtraction";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    dailyComplianceAuditJob,
    dailyWorkMetricSnapshotJob,
    ofacSdnIngestJob,
    htsRefreshJob,
    accountMemoryExtractionJob,
  ],
});
