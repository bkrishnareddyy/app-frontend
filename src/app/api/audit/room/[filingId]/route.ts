import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const POST = withAuthenticatedRoute<{ filingId: string }>(async ({ req, ctx }) => {
  const body = await req.json();
  const { filingId } = body;

  let filing = null;
  if (filingId) {
    filing = await db.customsFiling.findFirst({
      where: { id: filingId, accountId: ctx.accountId },
      include: {
        shipment: { include: { lineItems: true, documents: true } },
        responses: true,
      },
    });
  } else {
    filing = await db.customsFiling.findFirst({
      where: { accountId: ctx.accountId },
      include: {
        shipment: { include: { lineItems: true, documents: true } },
        responses: true,
      },
    });
  }

  if (!filing) {
    return NextResponse.json({ error: "No customs filing found for audit room" }, { status: 404 });
  }

  // Digital evidence manifest with real SHA-256 hashes
  const evidenceSet = filing.shipment.documents.map((doc) => ({
    documentId: doc.id,
    docType: doc.docType,
    fileName: doc.fileName,
    sha256Hash: doc.checksum || null,
    uploadedAt: doc.createdAt,
    status: doc.checksum ? "Verified Evidence" : "Unverified Evidence (No Checksum)",
  }));

  const validChecksums = evidenceSet.map((e) => e.sha256Hash).filter(Boolean);
  const evidenceHashManifest = validChecksums.length > 0
    ? validChecksums.join(":")
    : null;

  // Retrieve decision timeline
  // Opening the evidence room used to write two events into it -- an entry-summary
  // filing by a "Customs Specialist" and a monitoring audit by a "System Audit
  // Agent" -- neither of which had occurred. An audit trail shown to CBP cannot
  // manufacture its own entries.
  const timelines = await db.auditTimeline.findMany({
    where: { filingId: filing.id, accountId: ctx.accountId },
    orderBy: { timestamp: "asc" },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "audit.room_access",
    entity: "CustomsFiling",
    entityId: filing.id,
    metadata: { entryNumber: filing.entryNumber, evidenceCount: evidenceSet.length },
  });

  return NextResponse.json({
    auditRoom: {
      filingId: filing.id,
      entryNumber: filing.entryNumber,
      importerOfRecord: filing.shipment.importerName,
      status: "Read-Only Evidence Room",
      evidenceHashManifest,
      evidenceSet,
      timelines,
    },
  });
}, { write: true });
