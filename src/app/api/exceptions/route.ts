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

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const severity = searchParams.get("severity");
    const assignedToMe = searchParams.get("assignedToMe") === "true";

    const where: any = { accountId: ctx.accountId };

    if (status && status !== "all") {
      where.status = { equals: status, mode: "insensitive" };
    }
    if (severity) {
      where.severity = { equals: severity, mode: "insensitive" };
    }
    if (assignedToMe) {
      where.assignedToUserId = ctx.userId;
    }

    // Seed default workbench exception items if empty
    const count = await db.exceptionItem.count({ where: { accountId: ctx.accountId } });
    if (count === 0) {
      const filing = await db.customsFiling.findFirst({ where: { accountId: ctx.accountId } });
      await db.exceptionItem.createMany({
        data: [
          {
            accountId: ctx.accountId,
            filingId: filing?.id,
            shipmentId: filing?.shipmentId,
            type: "missing_document",
            severity: "High",
            description: "Missing Certificate of Origin for USMCA duty exemption claim on line item 1.",
            status: "Open",
            assignedToUserId: ctx.userId,
          },
          {
            accountId: ctx.accountId,
            filingId: filing?.id,
            shipmentId: filing?.shipmentId,
            type: "compliance_flag",
            severity: "Medium",
            description: "HTS code 8481.80.5090 subject to Section 301 exclusions review.",
            status: "InProgress",
            assignedToUserId: ctx.userId,
          },
        ],
      });
    }

    const exceptions = await db.exceptionItem.findMany({
      where,
      include: {
        shipment: true,
        filing: true,
        assignedToUser: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ exceptions });
  } catch (error) {
    console.error("GET /api/exceptions error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
