import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { normalizeSenderEmail } from "@/modules/inbound/emailNormalization";
import { Prisma } from "@prisma/client";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const [routes, memberships] = await Promise.all([
    db.inboundSenderRoute.findMany({
      where: { accountId: ctx.accountId },
      include: { defaultAssignedToUser: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.accountMembership.findMany({
      where: { accountId: ctx.accountId, status: "ACTIVE" },
      include: { user: true },
    }),
  ]);

  return NextResponse.json({
    requestId,
    accountName: ctx.accountName,
    publicDocumentAddress: process.env.RESEND_PUBLIC_DOCUMENT_ADDRESS ?? "docs@inbound.qubere.ai",
    routes,
    teamMembers: memberships.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
    })),
  });
}, { permission: "settings.manage" });

const createSchema = z.object({
  email: z.string().trim().email(),
  defaultAssignedToUserId: z.string().min(1).optional(),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { email, defaultAssignedToUserId } = bodyVal.data;

  if (defaultAssignedToUserId) {
    const membership = await db.accountMembership.findFirst({
      where: { accountId: ctx.accountId, userId: defaultAssignedToUserId, status: "ACTIVE" },
    });
    if (!membership) {
      return buildErrorResponse(
        422,
        "ASSIGNEE_NOT_A_MEMBER",
        "The default assignee must be an active member of this organization.",
        undefined,
        requestId
      );
    }
  }

  const normalizedSenderEmail = normalizeSenderEmail(email);

  try {
    const route = await db.inboundSenderRoute.create({
      data: {
        accountId: ctx.accountId,
        normalizedSenderEmail,
        displaySenderEmail: email.trim(),
        defaultAssignedToUserId: defaultAssignedToUserId ?? null,
        createdByUserId: ctx.userId,
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "inbound_sender_route.created",
      entity: "InboundSenderRoute",
      entityId: route.id,
      metadata: { normalizedSenderEmail, defaultAssignedToUserId: defaultAssignedToUserId ?? null },
      requestId,
    });

    return NextResponse.json({ route, requestId }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Never reveal which other account already claimed this sender.
      return buildErrorResponse(
        409,
        "SENDER_ALREADY_ROUTED",
        "This email address is already authorized elsewhere and cannot be added here.",
        undefined,
        requestId
      );
    }
    throw error;
  }
}, { permission: "settings.manage", write: true });
