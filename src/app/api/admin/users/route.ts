import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId , errorMessage } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { z } from "zod";

const updateUserSchema = z.object({
  email: z.string().email("Valid email required"),
  roleName: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
});

export async function POST(req: Request) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest("users.manage");
  if (errorResponse) return errorResponse;

  const bodyVal = await parseAndValidateBody(req, updateUserSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const role = await db.role.findFirst({
      where: { name: bodyVal.data.roleName, OR: [{ accountId: ctx!.accountId }, { accountId: null }] },
    });

    if (!role) {
      return buildErrorResponse(400, "INVALID_INPUT", "Invalid role specified", undefined, requestId);
    }

    const invitation = await db.invitation.create({
      data: {
        accountId: ctx!.accountId,
        email: bodyVal.data.email.trim().toLowerCase(),
        roleId: role.id,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdByUserId: ctx!.userId,
      },
    });

    // SECURITY: Exclude raw invitation token from audit metadata log
    await createAuditLog({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
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
}
