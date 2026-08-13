import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { getClientsData } from "@/lib/clients/clientsData";
import { z } from "zod";

const createClientSchema = z.object({
  name: z.string().min(1, "name is required"),
  contactName: z.string().optional(),
  contactEmail: z.string().email("Valid email required").optional().or(z.literal("")),
  contactPhone: z.string().optional(),
});

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const { clients } = await getClientsData(ctx);

  return NextResponse.json({ accountName: ctx.accountName, clients, requestId });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createClientSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const client = await db.client.create({
      data: {
        accountId: ctx.accountId,
        name: bodyVal.data.name.trim(),
        contactName: bodyVal.data.contactName?.trim() || null,
        contactEmail: bodyVal.data.contactEmail?.trim() || null,
        contactPhone: bodyVal.data.contactPhone?.trim() || null,
      },
});

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "client.create",
      entity: "Client",
      entityId: client.id,
      source: "UI",
      metadata: { name: client.name },
    });

    return NextResponse.json({ client, requestId });
  } catch (error: unknown) {
    return buildErrorResponse(500, "INTERNAL_ERROR", errorMessage(error) || "Failed to create client", undefined, requestId);
  }

}, { permission: "parties.manage", write: true });
