import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { ReconciliationClient } from "./ReconciliationClient";

export default async function ReconciliationPage() {
  const ctx = await getAccountContext();
  if (!ctx) return null;

  const issues = await db.reconciliationIssue.findMany({
    where: { accountId: ctx.accountId },
    include: {
      shipment: {
        include: { complianceDeadlines: true },
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
    resolution: i.resolution ?? null,
    note: i.note ?? null,
    createdAt: i.createdAt.toISOString(),
    resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
    deadlines: i.shipment.complianceDeadlines.map((d) => ({
      type: d.type,
      dueAt: d.dueAt ? d.dueAt.toISOString() : null,
    })),
  }));

  return <ReconciliationClient issues={serializedIssues} />;
}
