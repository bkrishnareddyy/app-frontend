import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await req.json();
    const { status, notes } = body;

    const finding = await db.complianceFinding.findFirst({
      where: { id, accountId: ctx.accountId },
    });

    if (!finding) {
      return NextResponse.json({ error: "Compliance finding not found" }, { status: 404 });
    }

    const newStatus = status || "Resolved";

    const updatedFinding = await db.complianceFinding.update({
      where: { id },
      data: {
        status: newStatus,
        resolvedAt: newStatus === "Resolved" || newStatus === "AcceptedRisk" ? new Date() : null,
      },
    });

    // Write event to immutable audit timeline
    await db.auditTimeline.create({
      data: {
        accountId: ctx.accountId,
        filingId: finding.filingId,
        event: `Compliance Finding Resolved: ${finding.rule} (${newStatus})`,
        actor: `Compliance Analyst (${ctx.userId})`,
        metadata: { findingId: id, status: newStatus, notes },
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "finding.resolve",
      entity: "ComplianceFinding",
      entityId: id,
      metadata: { newStatus, notes },
    });

    return NextResponse.json({ finding: updatedFinding });
  } catch (error) {
    console.error("POST /api/findings/[id]/resolve error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
