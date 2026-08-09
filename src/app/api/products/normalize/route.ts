import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { rawDescription, source, partNumber, countryOfOrigin, htsCode } = body;

  if (!rawDescription) {
    return NextResponse.json({ error: "rawDescription is required" }, { status: 400 });
  }

  // Check for existing canonical product or create new
  const cleanedName = rawDescription
    .replace(/256gb|black|pro max|v-\d+/gi, "")
    .trim();
  const canonicalName = cleanedName.length > 5 ? cleanedName : rawDescription;

  // Matching on `contains: canonicalName.split(" ")[0]` merged unrelated products —
  // every description starting "Steel" collapsed into one canonical record, and the
  // caller then inherited that record's HTS code and country of origin.
  const existingAlias = await db.productAlias.findFirst({
    where: {
      aliasName: rawDescription,
      canonicalProduct: { accountId: ctx.accountId },
    },
    include: { canonicalProduct: { include: { aliases: true } } },
  });

  let canonicalProduct =
    existingAlias?.canonicalProduct ??
    (await db.canonicalProduct.findFirst({
      where: {
        accountId: ctx.accountId,
        canonicalName: { equals: canonicalName, mode: "insensitive" },
      },
      include: { aliases: true },
    }));

  if (!canonicalProduct) {
    canonicalProduct = await db.canonicalProduct.create({
      data: {
        accountId: ctx.accountId,
        canonicalName,
        partNumber: partNumber || null,
        countryOfOrigin: countryOfOrigin || null,
        htsCode: htsCode || null,
        dutyRate: null,
        aliases: {
          create: [
            {
              aliasName: rawDescription,
              source: source || "User Entry",
              matchConfidence: 0,
            },
          ],
        },
      },
      include: { aliases: true },
    });
  } else if (!existingAlias) {
    // Attach alias if new
    await db.productAlias.create({
      data: {
        canonicalProductId: canonicalProduct.id,
        aliasName: rawDescription,
        source: source || "User Entry",
        matchConfidence: 0,
      },
    });
  }

  if (!canonicalProduct) {
    return NextResponse.json({ error: "Failed to create canonical product" }, { status: 500 });
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "product.normalize",
    entity: "CanonicalProduct",
    entityId: canonicalProduct.id,
    metadata: { rawDescription, canonicalName },
  });

  return NextResponse.json({
    normalizedProduct: {
      canonicalProductId: canonicalProduct.id,
      canonicalName: canonicalProduct.canonicalName,
      sku: canonicalProduct.sku,
      partNumber: canonicalProduct.partNumber,
      countryOfOrigin: canonicalProduct.countryOfOrigin,
      htsCode: canonicalProduct.htsCode,
      dutyRate: canonicalProduct.dutyRate,
      matchedConfidence: 0,
      aliasesCount: await db.productAlias.count({
        where: { canonicalProductId: canonicalProduct.id },
      }),
    },
  });
}, { write: true });
