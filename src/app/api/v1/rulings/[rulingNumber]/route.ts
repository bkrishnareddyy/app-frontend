import { NextResponse } from "next/server";
import { CrossIngestionService } from "@/modules/regulatory/crossIngestionService";

export async function GET(req: Request, { params }: { params: Promise<{ rulingNumber: string }> }) {
  try {
    const { rulingNumber } = await params;
    const verification = await CrossIngestionService.verifyCitation(rulingNumber);

    if (!verification.verified) {
      return NextResponse.json({ error: verification.reason, verified: false }, { status: 404 });
    }

    return NextResponse.json(verification);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch CROSS ruling" }, { status: 500 });
  }
}
