import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { runNormalizationPipeline } from "@/lib/products/normalizationEngine";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { rawDescription, source, partNumber, countryOfOrigin, htsCode } = body;

  if (!rawDescription || typeof rawDescription !== "string" || rawDescription.trim().length === 0) {
    return NextResponse.json({ error: "rawDescription is required" }, { status: 400 });
  }

  const pipeline = runNormalizationPipeline(rawDescription.trim());

  if (pipeline.tooSparse || pipeline.canonicalName === null) {
    return NextResponse.json(
      {
        error: "Cannot produce a meaningful canonical name from this description.",
        detail:
          "The description is too sparse after noise stripping. Provide a more descriptive product name that includes at least two meaningful words.",
        strippedName: pipeline.strippedName,
      },
      { status: 422 }
    );
  }

  const canonicalName = pipeline.canonicalName;
  const fingerprint = pipeline.fingerprint!;

  // Step 4 — alias detection: exact match on the raw description first
  const existingAlias = await db.productAlias.findFirst({
    where: {
      aliasName: rawDescription,
      canonicalProduct: { accountId: ctx.accountId },
    },
    include: { canonicalProduct: { include: { aliases: true } } },
});

  if (existingAlias?.canonicalProduct) {
    const cp = existingAlias.canonicalProduct;
    return NextResponse.json({
      normalizedProduct: {
        canonicalProductId: cp.id,
        canonicalName: cp.canonicalName,
        sku: cp.sku,
        partNumber: cp.partNumber,
        countryOfOrigin: cp.countryOfOrigin,
        htsCode: cp.htsCode,
        dutyRate: cp.dutyRate,
        matchedConfidence: 100,
        matchedVia: "EXACT_ALIAS",
        aliasesCount: cp.aliases.length,
        fingerprint,
      },
    });
  }

  // Step 5 — deduplication: check fingerprint against existing canonical products
  const existing = await db.canonicalProduct.findFirst({
    where: {
      accountId: ctx.accountId,
      canonicalName: { equals: canonicalName, mode: "insensitive" },
    },
    include: { aliases: true },
  });

  let canonicalProduct = existing;

  if (!canonicalProduct) {
    canonicalProduct = await db.canonicalProduct.create({
      data: {
        accountId: ctx.accountId,
        canonicalName,
        partNumber: partNumber ?? null,
        countryOfOrigin: countryOfOrigin ?? null,
        htsCode: htsCode ?? null,
        dutyRate: null,
        aliases: {
          create: [
            {
              aliasName: rawDescription,
              source: source ?? "User Entry",
              matchConfidence: 0,
            },
          ],
        },
      },
      include: { aliases: true },
    });
  } else {
    // Attach alias if the raw description is new
    const aliasExists = await db.productAlias.findFirst({
      where: { canonicalProductId: canonicalProduct.id, aliasName: rawDescription },
    });
    if (!aliasExists) {
      await db.productAlias.create({
        data: {
          canonicalProductId: canonicalProduct.id,
          aliasName: rawDescription,
          source: source ?? "User Entry",
          matchConfidence: 0,
        },
      });
    }
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "product.normalize",
    entity: "CanonicalProduct",
    entityId: canonicalProduct.id,
    metadata: { rawDescription, canonicalName, fingerprint },
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
      matchedConfidence: existing ? 90 : 0,
      matchedVia: existing ? "FINGERPRINT" : "CREATED",
      fingerprint,
      aliasesCount: await db.productAlias.count({
        where: { canonicalProductId: canonicalProduct.id },
      }),
    },
  });

}, { permission: "products.edit", write: true });
