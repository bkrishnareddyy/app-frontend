import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { dailyComplianceAuditJob } from "@/lib/inngest/functions/dailyComplianceAudit";
import { dailyWorkMetricSnapshotJob } from "@/lib/inngest/functions/dailyWorkMetricSnapshot";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    dailyComplianceAuditJob,
    dailyWorkMetricSnapshotJob,
  ],
});
