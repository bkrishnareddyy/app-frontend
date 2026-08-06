import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { shipmentId } = body;

    let targetShipmentId = shipmentId;
    if (!targetShipmentId) {
      const firstShipment = await db.shipment.findFirst({
        where: { accountId: ctx.accountId },
      });
      targetShipmentId = firstShipment?.id;
    }

    if (!targetShipmentId) {
      return NextResponse.json({ error: "No shipment found for PGA screening" }, { status: 404 });
    }

    const lineItems = await db.shipmentLineItem.findMany({
      where: { shipmentId: targetShipmentId, accountId: ctx.accountId },
    });

    const pgaFlags = [];

    for (const item of lineItems) {
      const hts = item.htsCode;
      const desc = item.description.toLowerCase();

      // FDA Screening Rule
      if (desc.includes("food") || desc.includes("medical") || desc.includes("pharma") || hts.startsWith("9018")) {
        const req = await db.pgaRequirement.create({
          data: {
            shipmentLineItemId: item.id,
            agency: "FDA",
            reason: "Medical device or food product subject to FDA Prior Notice",
            requiredFiling: "FDA Prior Notice & Device Registration",
            missingPermits: ["FDA Device Listing Number (LST)", "510(k) Clearance"],
            holdRisk: "High",
          },
        });
        pgaFlags.push(req);
      }

      // FCC Screening Rule
      if (desc.includes("wireless") || desc.includes("bluetooth") || desc.includes("radio") || desc.includes("board") || hts.startsWith("8537") || hts.startsWith("8517")) {
        const req = await db.pgaRequirement.create({
          data: {
            shipmentLineItemId: item.id,
            agency: "FCC",
            reason: "Radio frequency device subject to FCC Equipment Authorization",
            requiredFiling: "FCC Form 740 / Equipment Disclaimer",
            missingPermits: ["FCC Grantee Code & FCC ID"],
            holdRisk: "Medium",
          },
        });
        pgaFlags.push(req);
      }

      // EPA Screening Rule
      if (desc.includes("chemical") || desc.includes("engine") || desc.includes("valve") || hts.startsWith("8481")) {
        const req = await db.pgaRequirement.create({
          data: {
            shipmentLineItemId: item.id,
            agency: "EPA",
            reason: "Toxic Substances Control Act (TSCA) Chemical Import Certification",
            requiredFiling: "TSCA Section 13 Positive Certification",
            missingPermits: ["TSCA Form 7740-1 Certification"],
            holdRisk: "Low",
          },
        });
        pgaFlags.push(req);
      }
    }

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "pga.screen",
      entity: "PgaRequirement",
      entityId: targetShipmentId,
      metadata: { pgaFlagsCount: pgaFlags.length },
    });

    return NextResponse.json({
      pgaScreening: {
        shipmentId: targetShipmentId,
        requiresPgaFiling: pgaFlags.length > 0,
        flaggedAgencies: Array.from(new Set(pgaFlags.map((p) => p.agency))),
        pgaFlagsCount: pgaFlags.length,
        pgaRequirements: pgaFlags,
      },
    });
  } catch (error) {
    console.error("POST /api/pga/screen error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
