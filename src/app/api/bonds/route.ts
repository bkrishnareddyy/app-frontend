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

    const bonds = await db.bond.findMany({
      where: { accountId: ctx.accountId },
      include: { importersOfRecord: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ bonds });
  } catch (error) {
    console.error("GET /api/bonds error:", error);
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
    const { bondType, suretyName, bondNumber, bondAmount, expirationDate } = body;

    const num = bondNumber || `BND-${Math.floor(100000 + Math.random() * 900000)}`;

    const bond = await db.bond.create({
      data: {
        accountId: ctx.accountId,
        bondType: bondType || "continuous",
        suretyName: suretyName || "Roanoke Insurance Group",
        bondNumber: num,
        bondAmount: bondAmount || 50000.0,
        expirationDate: expirationDate ? new Date(expirationDate) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        status: "Active",
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "bond.create",
      entity: "Bond",
      entityId: bond.id,
      metadata: { bondNumber: num },
    });

    return NextResponse.json({ bond }, { status: 201 });
  } catch (error) {
    console.error("POST /api/bonds error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
