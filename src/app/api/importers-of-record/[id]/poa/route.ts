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
    const { grantedByEntity, expirationDate, documentUrl } = body;

    const importer = await db.importerOfRecord.findFirst({
      where: { id, accountId: ctx.accountId },
    });

    if (!importer) {
      return NextResponse.json({ error: "Importer of Record not found" }, { status: 404 });
    }

    const poa = await db.powerOfAttorney.create({
      data: {
        accountId: ctx.accountId,
        importerOfRecordId: id,
        grantedByEntity: grantedByEntity || importer.name,
        expirationDate: expirationDate ? new Date(expirationDate) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 3), // 3 years
        documentUrl: documentUrl || `/documents/poa_${id}.pdf`,
        status: "Active",
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "poa.create",
      entity: "PowerOfAttorney",
      entityId: poa.id,
      metadata: { importerOfRecordId: id },
    });

    return NextResponse.json({ powerOfAttorney: poa }, { status: 201 });
  } catch (error) {
    console.error("POST /api/importers-of-record/[id]/poa error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
