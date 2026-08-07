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
      include: {
        shipment: {
          include: { documents: true, lineItems: true },
        },
      },
    });

    if (!filing) {
      return NextResponse.json({ error: "Filing not found" }, { status: 404 });
    }

    const raisedExceptions = [];

    // Pre-filing validation checks
    if (!filing.shipment.documents || filing.shipment.documents.length === 0) {
      const exc = await db.exceptionItem.create({
        data: {
          accountId: ctx.accountId,
          filingId: filing.id,
          shipmentId: filing.shipmentId,
          type: "missing_document",
          severity: "High",
          description: "Pre-filing validation failed: No shipping documents attached.",
          status: "Open",
        },
      });
      raisedExceptions.push(exc);
    }

    if (Number(filing.totalValue) <= 0) {
      const exc = await db.exceptionItem.create({
        data: {
          accountId: ctx.accountId,
          filingId: filing.id,
          shipmentId: filing.shipmentId,
          type: "data_mismatch",
          severity: "Critical",
          description: "Pre-filing validation failed: Total customs declared value must be greater than zero.",
          status: "Open",
        },
      });
      raisedExceptions.push(exc);
    }

    const isValid = raisedExceptions.length === 0;

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "filing.validate",
      entity: "CustomsFiling",
      entityId: filing.id,
      metadata: { isValid, raisedExceptionsCount: raisedExceptions.length },
    });

    return NextResponse.json({
      validation: {
        filingId: filing.id,
        isValid,
        status: isValid ? "PASSED" : "FAILED",
        raisedExceptionsCount: raisedExceptions.length,
        exceptions: raisedExceptions,
      },
    });
  } catch (error) {
    console.error("POST /api/filing/[id]/validate error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
