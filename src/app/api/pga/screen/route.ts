import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

const SCREENED_AGENCIES = ["FDA", "FCC", "EPA"];

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { shipmentId } = body;

  // This used to fall back to findFirst() and write PgaRequirement rows against
  // whichever shipment came back, so a request with no id screened an arbitrary one.
  if (typeof shipmentId !== "string" || shipmentId.trim() === "") {
    return NextResponse.json({ error: "shipmentId is required" }, { status: 400 });
  }

  const targetShipmentId = shipmentId;

  const lineItems = await db.shipmentLineItem.findMany({
    where: { shipmentId: targetShipmentId, accountId: ctx.accountId },
  });

  if (lineItems.length === 0) {
    return NextResponse.json({
      pgaScreening: {
        shipmentId: targetShipmentId,
        // Not false: nothing was screened, so no conclusion can be drawn.
        requiresPgaFiling: null,
        notScreenedReason:
          "The shipment has no line items, so no product was screened against any partner government agency rule.",
        agenciesScreened: [],
        flaggedAgencies: [],
        pgaFlagsCount: 0,
        pgaRequirements: [],
      },
    });
  }

  const detections: Array<{
    shipmentLineItemId: string;
    agency: string;
    reason: string;
    requiredFiling: string;
    missingPermits: string[];
    holdRisk: string;
  }> = [];

  for (const item of lineItems) {
    const hts = item.htsCode;
    const desc = item.description.toLowerCase();

    // FDA Screening Rule
    if (desc.includes("food") || desc.includes("medical") || desc.includes("pharma") || hts.startsWith("9018")) {
      detections.push({
        shipmentLineItemId: item.id,
        agency: "FDA",
        reason: "Medical device or food product subject to FDA Prior Notice",
        requiredFiling: "FDA Prior Notice & Device Registration",
        missingPermits: ["FDA Device Listing Number (LST)", "510(k) Clearance"],
        holdRisk: "High",
      });
    }

    // FCC Screening Rule
    if (desc.includes("wireless") || desc.includes("bluetooth") || desc.includes("radio") || desc.includes("board") || hts.startsWith("8537") || hts.startsWith("8517")) {
      detections.push({
        shipmentLineItemId: item.id,
        agency: "FCC",
        reason: "Radio frequency device subject to FCC Equipment Authorization",
        requiredFiling: "FCC Form 740 / Equipment Disclaimer",
        missingPermits: ["FCC Grantee Code & FCC ID"],
        holdRisk: "Medium",
      });
    }

    // EPA Screening Rule
    if (desc.includes("chemical") || desc.includes("engine") || desc.includes("valve") || hts.startsWith("8481")) {
      detections.push({
        shipmentLineItemId: item.id,
        agency: "EPA",
        reason: "Toxic Substances Control Act (TSCA) Chemical Import Certification",
        requiredFiling: "TSCA Section 13 Positive Certification",
        missingPermits: ["TSCA Form 7740-1 Certification"],
        holdRisk: "Low",
      });
    }
  }

  const lineItemIds = lineItems.map((i) => i.id);

  // Re-screening used to append a second copy of every requirement, so a shipment
  // screened twice appeared to owe two FDA Prior Notices for the same line.
  const existing = await db.pgaRequirement.findMany({
    where: { shipmentLineItemId: { in: lineItemIds }, agency: { in: SCREENED_AGENCIES } },
  });

  const created = detections.filter(
    (d) => !existing.some((e) => e.shipmentLineItemId === d.shipmentLineItemId && e.agency === d.agency)
  );

  if (created.length > 0) {
    await db.pgaRequirement.createMany({ data: created });
  }

  // Only the three agencies screened here are withdrawn, and only when this run
  // no longer detects them; a requirement recorded by anything else survives.
  const staleIds = existing
    .filter((e) => !detections.some((d) => d.shipmentLineItemId === e.shipmentLineItemId && d.agency === e.agency))
    .map((e) => e.id);

  if (staleIds.length > 0) {
    await db.pgaRequirement.deleteMany({ where: { id: { in: staleIds } } });
  }

  // The response used to list only the rows this run created. With duplicates
  // suppressed that would report requiresPgaFiling false on every re-screen of a
  // shipment that does require a filing.
  const pgaFlags = await db.pgaRequirement.findMany({
    where: { shipmentLineItemId: { in: lineItemIds } },
    orderBy: { createdAt: "asc" },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "pga.screen",
    entity: "PgaRequirement",
    entityId: targetShipmentId,
    metadata: { pgaFlagsCount: pgaFlags.length, addedCount: created.length, withdrawnCount: staleIds.length },
  });

  return NextResponse.json({
    pgaScreening: {
      shipmentId: targetShipmentId,
      requiresPgaFiling: pgaFlags.length > 0,
      // Only these three agencies have rules here. A false above does not mean the
      // shipment is clear of USDA, DOT, CPSC, ATF or any other agency.
      agenciesScreened: SCREENED_AGENCIES,
      flaggedAgencies: Array.from(new Set(pgaFlags.map((p) => p.agency))),
      pgaFlagsCount: pgaFlags.length,
      pgaRequirements: pgaFlags,
    },
  });
}, { write: true });
