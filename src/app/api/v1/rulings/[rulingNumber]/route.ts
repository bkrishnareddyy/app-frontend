import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { CrossIngestionService } from "@/modules/regulatory/crossIngestionService";

export const GET = withPublicRoute<{ rulingNumber: string }>(async ({ params }) => {
  try {
    const { rulingNumber } = params;
    const verification = await CrossIngestionService.verifyCitation(rulingNumber);

    if (!verification.verified) {
      return NextResponse.json({ error: verification.reason, verified: false }, { status: 404 });
    }

    return NextResponse.json(verification);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch CROSS ruling" }, { status: 500 });
  }
});
