import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { computeRegulatoryImpact } from "@/lib/regulatory/impactAnalysis";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const update = await db.regulatoryUpdate.findUnique({
    where: { id },
});

  if (!update) {
    return NextResponse.json({ error: "Regulatory Update not found" });
  }

  // Parse affected HTS codes from metadata
  const metadata = (update.metadata as any) || {};
  const affectedHtsCodes = metadata.affectedHtsCodes || [];

  // Compute impact
  const result = await computeRegulatoryImpact(ctx.accountId, affectedHtsCodes);

  // Task B-5: Create compliance exceptions for in-progress shipments
  for (const s of result.shipments) {
    const codeAffected = affectedHtsCodes[0] || "unknown HTS";
    
    // Check if exception already exists
    const exists = await db.exceptionItem.findFirst({
      where: {
        accountId: ctx.accountId,
        shipmentId: s.id,
        category: "COMPLIANCE",
        description: { contains: update.title },
      },
    });

    if (!exists) {
      await db.exceptionItem.create({
        data: {
          accountId: ctx.accountId,
          shipmentId: s.id,
          category: "COMPLIANCE",
          type: "compliance_flag",
          severity: "High",
          description: `Regulatory change [${update.title}] affects this shipment's HTS [${codeAffected}]. Review required before filing.`,
          status: "Open",
          blocking: true,
        },
      });
    }
  }

  // Store total affected count on model
  await db.regulatoryUpdate.update({
    where: { id },
    data: {
      affectedShipmentsCount: result.shipmentsAffectedCount,
    },
  });

  return NextResponse.json({
    status: "COMPLETE",
    impactSummary: {
      productsAffected: result.productsAffectedCount,
      shipmentsAffected: result.shipmentsAffectedCount,
      estimatedDutyDelta: result.estimatedDutyDelta,
    },
  });

}, { permission: "regulatory.review", write: true });
