import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { z } from "zod";

const SYSTEM_ROLE_NAMES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

const updateUserSchema = z.object({
  email: z.string().email("Valid email required"),
  // An invitation grants a single initial role; additional roles can be
  // assigned afterward via PATCH once the invite is accepted.
  roleName: z.enum(SYSTEM_ROLE_NAMES).default("MEMBER"),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, updateUserSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const role = await db.role.findFirst({
      where: { name: bodyVal.data.roleName, OR: [{ accountId: ctx.accountId }, { accountId: null }] },
    });

    if (!role) {
      return buildErrorResponse(400, "INVALID_INPUT", "Invalid role specified", undefined, requestId);
    }

    const invitation = await db.invitation.create({
      data: {
        accountId: ctx.accountId,
        email: bodyVal.data.email.trim().toLowerCase(),
        roleId: role.id,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdByUserId: ctx.userId,
      },
    });

    // SECURITY: Exclude raw invitation token from audit metadata log
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "USER_INVITED",
      entity: "Invitation",
      entityId: invitation.id,
      metadata: { invitedEmail: bodyVal.data.email, roleName: role.name },
      success: true,
    });

    return NextResponse.json({
      success: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
      requestId,
    });
  } catch (error: unknown) {
    return buildErrorResponse(500, "INTERNAL_ERROR", errorMessage(error) || "Failed to invite user", undefined, requestId);
  }
}, { permission: "users.manage" });

const patchUserSchema = z
  .object({
    membershipId: z.string().min(1),
    // Full replacement set of roles for this membership -- a membership can
    // hold multiple roles simultaneously (e.g. Admin + Agent).
    roleNames: z.array(z.enum(SYSTEM_ROLE_NAMES)).min(1).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  })
  .refine((d) => d.roleNames || d.status, {
    message: "At least one of roleNames or status is required",
  });

export const PATCH = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, patchUserSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { membershipId, roleNames, status } = bodyVal.data;

  try {
    const membership = await db.accountMembership.findFirst({
      where: { id: membershipId, accountId: ctx.accountId },
    });

    if (!membership) {
      return buildErrorResponse(404, "NOT_FOUND", "Membership not found", undefined, requestId);
    }

    if (membership.userId === ctx.userId) {
      return buildErrorResponse(
        400,
        "SELF_EDIT_FORBIDDEN",
        "You cannot change your own roles or status",
        undefined,
        requestId
      );
    }

    if (roleNames) {
      const roles = await db.role.findMany({
        where: { name: { in: roleNames }, OR: [{ accountId: ctx.accountId }, { accountId: null }] },
      });

      if (roles.length !== new Set(roleNames).size) {
        return buildErrorResponse(400, "INVALID_INPUT", "One or more roles not found", undefined, requestId);
      }

      await db.$transaction([
        db.accountMembershipRole.deleteMany({ where: { accountMembershipId: membershipId } }),
        db.accountMembershipRole.createMany({
          data: roles.map((r) => ({ accountMembershipId: membershipId, roleId: r.id })),
        }),
      ]);
    }

    if (status) {
      await db.accountMembership.update({
        where: { id: membershipId },
        data: { status },
      });
    }

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "MEMBERSHIP_UPDATED",
      entity: "AccountMembership",
      entityId: membershipId,
      metadata: { roleNames, status },
      success: true,
    });

    return NextResponse.json({ success: true, requestId });
  } catch (error: unknown) {
    return buildErrorResponse(500, "INTERNAL_ERROR", errorMessage(error) || "Failed to update membership", undefined, requestId);
  }
}, { permission: "users.manage" });
