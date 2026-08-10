import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { ProductMasterService } from "@/modules/product/productMasterService";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  try {
    const body = await req.json();
    const { canonicalName, sku, partNumber, manufacturer, countryOfOrigin, htsCode, dutyRate, aliases } = body;

    if (!canonicalName) {
      return NextResponse.json({ error: "canonicalName is required" }, { status: 400 });
    }

    const product = await ProductMasterService.createCanonicalProduct({
      accountId: ctx.accountId,
      userId: ctx.userId,
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
  } catch (error: unknown) {
    return handleApiError(error);
  }
}, { write: true });
