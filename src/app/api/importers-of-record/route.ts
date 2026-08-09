import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const importers = await db.importerOfRecord.findMany({
    where: { accountId: ctx.accountId },
    include: {
      bond: true,
      powersOfAttorney: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ importersOfRecord: importers });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { name, irsEin, cbpImporterNumber, address, bondId } = body;

  if (!name || !cbpImporterNumber) {
    return NextResponse.json({ error: "Name and cbpImporterNumber are required" }, { status: 400 });
  }

  const importer = await db.importerOfRecord.create({
    data: {
      accountId: ctx.accountId,
      name,
      irsEin: irsEin || "12-3456789",
      cbpImporterNumber,
      address: address || { street: "100 Trade Plaza", city: "Los Angeles", state: "CA", zip: "90012", country: "USA" },
      bondId,
    },
    include: { bond: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "importer.create",
    entity: "ImporterOfRecord",
    entityId: importer.id,
    metadata: { name, cbpImporterNumber },
  });

  return NextResponse.json({ importerOfRecord: importer }, { status: 201 });
});
