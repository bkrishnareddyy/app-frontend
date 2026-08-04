import { NextResponse } from "next/server";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const context = await getAccountContext();
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManageUsers = await hasPermission("users.manage");
    if (!canManageUsers) {
      return NextResponse.json({ error: "Forbidden: Missing user management permissions" }, { status: 403 });
    }

    const { email, roleName } = await req.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    const role = await db.role.findFirst({
      where: { name: roleName || "MEMBER", OR: [{ accountId: context.accountId }, { accountId: null }] },
    });

    if (!role) {
      return NextResponse.json({ error: "Invalid role specified" }, { status: 400 });
    }

    const invitation = await db.invitation.create({
      data: {
        accountId: context.accountId,
        email: email.trim().toLowerCase(),
        roleId: role.id,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdByUserId: context.userId,
      },
    });

    await createAuditLog({
      accountId: context.accountId,
      userId: context.userId,
      action: "USER_INVITED",
      entity: "Invitation",
      entityId: invitation.id,
      metadata: { invitedEmail: email, roleName: role.name, token: invitation.token },
      success: true,
    });

    return NextResponse.json({ success: true, invitation });
  } catch (error) {
    console.error("Error inviting user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const context = await getAccountContext();
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManageUsers = await hasPermission("users.manage");
    if (!canManageUsers) {
      return NextResponse.json({ error: "Forbidden: Missing user management permissions" }, { status: 403 });
    }

    const { membershipId, roleName, status } = await req.json();

    if (!membershipId) {
      return NextResponse.json({ error: "Membership ID required" }, { status: 400 });
    }

    const membership = await db.accountMembership.findFirst({
      where: {
        id: membershipId,
        accountId: context.accountId,
      },
      include: { role: true, user: true },
    });

    if (!membership) {
      return NextResponse.json({ error: "Membership not found in your account" }, { status: 404 });
    }

    let newRoleId: string | undefined = undefined;
    let newRoleName = membership.role.name;

    if (roleName) {
      const foundRole = await db.role.findFirst({
        where: { name: roleName, OR: [{ accountId: context.accountId }, { accountId: null }] },
      });
      if (!foundRole) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      newRoleId = foundRole.id;
      newRoleName = foundRole.name;
    }

    const updatedMembership = await db.accountMembership.update({
      where: { id: membership.id },
      data: {
        roleId: newRoleId,
        status: status || undefined,
      },
      include: { role: true, user: true },
    });

    await createAuditLog({
      accountId: context.accountId,
      userId: context.userId,
      action: roleName ? "ROLE_CHANGED" : "USER_STATUS_CHANGED",
      entity: "AccountMembership",
      entityId: membership.id,
      metadata: {
        targetUserEmail: membership.user.email,
        previousRole: membership.role.name,
        newRole: newRoleName,
        previousStatus: membership.status,
        newStatus: updatedMembership.status,
      },
      success: true,
    });

    return NextResponse.json({ success: true, membership: updatedMembership });
  } catch (error) {
    console.error("Error managing user membership:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
