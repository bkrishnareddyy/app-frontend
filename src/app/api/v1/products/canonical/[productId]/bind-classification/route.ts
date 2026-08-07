import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { ProductMasterService } from "@/modules/product/productMasterService";

export async function POST(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const { productId } = await params;
    const body = await req.json();
    const { decisionId } = body;

    if (!decisionId) {
      return NextResponse.json({ error: "decisionId is required" }, { status: 400 });
    }

    const product = await ProductMasterService.bindClassification({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
      canonicalProductId: productId,
      decisionId,
    });

    return NextResponse.json({ product });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to bind classification decision" }, { status: 500 });
  }
}
