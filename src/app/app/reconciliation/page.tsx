import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/api/auth-guards";
import { ReconciliationClient } from "./ReconciliationClient";

export default async function ReconciliationPage() {
  const user = await getAuthenticatedUser();
  const accountId = user.accountId;

  const issues = await db.reconciliationIssue.findMany({
    where: { accountId },
    include: {
      shipment: {
        include: {
          filings: true,
          complianceDeadlines: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const serializedIssues = issues.map((i) => ({
    id: i.id,
    shipmentId: i.shipmentId,
    shipmentNumber: i.shipment.shipmentNumber,
    severity: i.severity,
    field: i.field,
    expectedValue: i.expectedValue,
    actualValue: i.actualValue,
    sourceDocuments: i.sourceDocuments,
    status: i.status,
    issueType: i.issueType,
    resolution: i.resolution,
    note: i.note,
    createdAt: i.createdAt.toISOString(),
    resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
    deadlines: i.shipment.complianceDeadlines.map((d) => ({
      type: d.type,
      dueAt: d.dueAt ? d.dueAt.toISOString() : null,
    })),
  }));

  return <ReconciliationClient issues={serializedIssues} />;
}
