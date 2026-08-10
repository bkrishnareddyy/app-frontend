import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { z } from "zod";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const legalEntities = await db.legalEntity.findMany({
    where: { accountId: ctx.accountId },
    include: {
      client: true,
      customsProfiles: true,
    },
    orderBy: { legalName: "asc" },
  });

  return NextResponse.json({ legalEntities });
});

const createLegalEntitySchema = z.object({
  clientId: z.string().optional(),
  legalName: z.string().min(1),
  tradeName: z.string().optional(),
  entityType: z.string().optional(),
  country: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  stateProvince: z.string().optional(),
  postalCode: z.string().optional(),
  taxIdentifier: z.string().optional(),
  cbpImporterNumber: z.string().optional(),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const val = createLegalEntitySchema.safeParse(body);
  if (!val.success) {
    return NextResponse.json({ error: "Invalid payload", details: val.error.format() }, { status: 400 });
  }

  const data = val.data;

  const entity = await db.legalEntity.create({
    data: {
      accountId: ctx.accountId,
      clientId: data.clientId || null,
      legalName: data.legalName,
      tradeName: data.tradeName || null,
      entityType: data.entityType || "US_CORPORATION",
      country: data.country || "US",
      addressLine1: data.addressLine1 || null,
      addressLine2: data.addressLine2 || null,
      city: data.city || null,
      stateProvince: data.stateProvince || null,
      postalCode: data.postalCode || null,
      taxIdentifier: data.taxIdentifier || null,
      status: "ACTIVE",
      ...(data.cbpImporterNumber
        ? {
            customsProfiles: {
              create: {
                cbpImporterNumber: data.cbpImporterNumber,
                active: true,
              },
            },
          }
        : {}),
    },
    include: {
      client: true,
      customsProfiles: true,
    },
  });

  return NextResponse.json({ legalEntity: entity }, { status: 201 });
});
