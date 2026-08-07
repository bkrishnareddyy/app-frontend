import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { ProductMasterService } from "@/modules/product/productMasterService";

export async function POST(req: Request) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { canonicalName, sku, partNumber, manufacturer, countryOfOrigin, htsCode, dutyRate, aliases } = body;

    if (!canonicalName) {
      return NextResponse.json({ error: "canonicalName is required" }, { status: 400 });
    }

    const product = await ProductMasterService.createCanonicalProduct({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
      canonicalName,
      sku,
      partNumber,
      manufacturer,
      countryOfOrigin,
      htsCode,
      dutyRate,
      aliases,
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create canonical product" }, { status: 500 });
  }
}
