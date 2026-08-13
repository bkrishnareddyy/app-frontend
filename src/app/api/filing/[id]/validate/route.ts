import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { applyTransition, canTransition } from "@/modules/filings/filingStateMachine";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

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
  const transition = isValid ? "validate.pass" : "validate.fail";

  // Validation result only moves the filing when the transition is legal from
  // its current status; an already-transmitted filing is not rewound.
  let newStatus: string | null = null;
  if (canTransition(filing.filingStatus, transition)) {
    newStatus = applyTransition(filing.filingStatus, transition);
    await db.customsFiling.update({
      where: { id: filing.id },
      data: { filingStatus: newStatus },
    });
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "filing.validate",
    entity: "CustomsFiling",
    entityId: filing.id,
    metadata: {
      isValid,
      raisedExceptionsCount: raisedExceptions.length,
      previousStatus: filing.filingStatus,
      newStatus,
    },
  });

  return NextResponse.json({
    validation: {
      filingId: filing.id,
      isValid,
      status: isValid ? "PASSED" : "FAILED",
      previousFilingStatus: filing.filingStatus,
      filingStatus: newStatus ?? filing.filingStatus,
      raisedExceptionsCount: raisedExceptions.length,
      exceptions: raisedExceptions,
    },
  });
}, { write: true });
