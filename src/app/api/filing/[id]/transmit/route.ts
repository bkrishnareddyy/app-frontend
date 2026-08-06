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

    const filing = await db.customsFiling.findFirst({
      where: { id, accountId: ctx.accountId },
    });

    if (!filing) {
      return NextResponse.json({ error: "Filing not found" }, { status: 404 });
    }

    // Update filing state
    const updatedFiling = await db.customsFiling.update({
      where: { id },
      data: {
        filingStatus: "Submitted",
        submittedAt: new Date(),
      },
    });

    // Write simulated ABI Customs Response
    const response = await db.customsResponse.create({
      data: {
        accountId: ctx.accountId,
        filingId: id,
        code: "ACK",
        title: "ACK - ABI Entry Transmission Received",
        description: `CBP ACE System acknowledged ABI transmission for entry ${filing.entryNumber}.`,
        status: "Accepted",
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "filing.transmit",
      entity: "CustomsFiling",
      entityId: id,
      metadata: { entryNumber: filing.entryNumber, responseId: response.id },
    });

    return NextResponse.json({
      transmission: {
        status: "SUCCESS",
        entryNumber: filing.entryNumber,
        transmittedAt: updatedFiling.submittedAt,
        response,
      },
    });
  } catch (error) {
    console.error("POST /api/filing/[id]/transmit error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
