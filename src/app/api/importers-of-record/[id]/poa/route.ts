import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

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
});
