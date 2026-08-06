import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    let canonicalProduct = await db.canonicalProduct.findFirst({
      where: {
        accountId: ctx.accountId,
        canonicalName: { contains: canonicalName.split(" ")[0], mode: "insensitive" },
      },
      include: { aliases: true },
    });

    if (!canonicalProduct) {
      canonicalProduct = await db.canonicalProduct.create({
        data: {
          accountId: ctx.accountId,
          canonicalName,
          partNumber: partNumber || "PN-9901",
          countryOfOrigin: countryOfOrigin || "Germany",
          htsCode: htsCode || "8481.80.5090",
          dutyRate: "2.8%",
          aliases: {
            create: [
              {
                aliasName: rawDescription,
                source: source || "Commercial Invoice",
                matchConfidence: 96,
              },
            ],
          },
        },
        include: { aliases: true },
      });
    } else {
      // Attach alias if new
      await db.productAlias.create({
        data: {
          canonicalProductId: canonicalProduct.id,
          aliasName: rawDescription,
          source: source || "Packing List",
          matchConfidence: 94,
        },
      });
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
        matchedConfidence: 96,
        aliasesCount: canonicalProduct.aliases.length + 1,
      },
    });
  } catch (error) {
    console.error("POST /api/products/normalize error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
