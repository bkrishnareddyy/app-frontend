import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function GET(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const importers = await db.importerOfRecord.findMany({
      where: { accountId: ctx.accountId },
      include: {
        bond: true,
        powersOfAttorney: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ importersOfRecord: importers });
  } catch (error) {
    console.error("GET /api/importers-of-record error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
  } catch (error) {
    console.error("POST /api/importers-of-record error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
