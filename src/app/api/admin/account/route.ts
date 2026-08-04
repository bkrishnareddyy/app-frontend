import { NextResponse } from "next/server";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function PATCH(req: Request) {
  try {
    const context = await getAccountContext();
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Require OWNER or ADMIN role
    const canManage = await hasPermission("account.manage");
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden: Missing account management permissions" }, { status: 403 });
    }

    const body = await req.json();
    const { name, status } = body;

    if (name && (typeof name !== "string" || name.trim().length === 0)) {
      return NextResponse.json({ error: "Invalid account name" }, { status: 400 });
    }

    const updatedAccount = await db.account.update({
      where: { id: context.accountId },
      data: {
        name: name ? name.trim() : undefined,
        status: status ? status : undefined,
      },
    });

    // Create AuditLog entry for admin changes
    await createAuditLog({
      accountId: context.accountId,
      userId: context.userId,
      action: "ACCOUNT_UPDATED",
      entity: "Account",
      entityId: context.accountId,
      metadata: {
        previousName: context.account.name,
        newName: updatedAccount.name,
        previousStatus: context.account.status,
        newStatus: updatedAccount.status,
      },
    });

    return NextResponse.json({ success: true, account: updatedAccount });
  } catch (error) {
    console.error("Error updating account details:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
