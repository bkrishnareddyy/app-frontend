import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { importerOfRecordId, periodFrom, periodTo, entryIds } = body;

  if (!periodFrom || !periodTo) {
    return NextResponse.json({ error: "periodFrom and periodTo are required" }, { status: 400 });
  }

  // Import focused assessment module
  const { assembleFocusedAssessmentFile } = await import("@/lib/audit/focusedAssessment");
  
  const faFile = await assembleFocusedAssessmentFile(ctx.accountId, {
    importerOfRecordId,
    periodFrom,
    periodTo,
    entryIds,
  });

  // Write AuditTimeline event record
  if (entryIds?.[0]) {
    await db.auditTimeline.create({
      data: {
        accountId: ctx.accountId,
        filingId: entryIds[0],
        event: "FOCUSED_ASSESSMENT_ASSEMBLED",
        actor: "System Auditor",
        timestamp: new Date(),
        metadata: {
          auditId: faFile.auditId,
          entryCount: faFile.entryPopulation.total,
        },
      },
    });
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "FOCUSED_ASSESSMENT_ASSEMBLED",
    entity: "FocusedAssessment",
    entityId: faFile.auditId,
    metadata: {
      periodCovered: faFile.periodCovered,
      totalEntries: faFile.entryPopulation.total,
    },
  });

  return NextResponse.json({ defenseFile: faFile });
}, { permission: "documents.create", write: true });
