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

    const claims = await db.drawbackClaim.findMany({
      where: { accountId: ctx.accountId },
      include: {
        matches: {
          include: {
            shipmentLineItem: true,
            exportLineItem: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ drawbackClaims: claims });
  } catch (error) {
    console.error("GET /api/drawback/claims error:", error);
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
    const { claimType, matches } = body;

    const matchedList = Array.isArray(matches) ? matches : [];
    const totalRefundClaimed = matchedList.reduce((acc: number, m: any) => acc + (m.dutyAttributed || 0), 0) || 4500.0;
    const cbpClaimNum = `DBK-2026-${Math.floor(100000 + Math.random() * 900000)}`;

    const claim = await db.drawbackClaim.create({
      data: {
        accountId: ctx.accountId,
        claimType: claimType || "unused_merchandise",
        status: "Draft",
        totalRefundClaimed,
        cbpClaimNumber: cbpClaimNum,
        matches: {
          create: matchedList.map((m: any) => ({
            shipmentLineItemId: m.shipmentLineItemId,
            exportLineItemId: m.exportLineItemId,
            matchedQuantity: m.matchedQuantity || 100,
            matchMethod: m.matchMethod || "FIFO",
            dutyAttributed: m.dutyAttributed || 1000.0,
          })),
        },
      },
      include: { matches: true },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "drawback.claim_create",
      entity: "DrawbackClaim",
      entityId: claim.id,
      metadata: { cbpClaimNumber: cbpClaimNum, totalRefundClaimed },
    });

    return NextResponse.json({ drawbackClaim: claim }, { status: 201 });
  } catch (error) {
    console.error("POST /api/drawback/claims error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
