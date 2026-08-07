import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  try {
    const { releaseId } = await params;
    const release = await db.htsRelease.findUnique({
      where: { id: releaseId },
      include: {
        _count: {
          select: { nodes: true, legalDocuments: true },
        },
      },
    });

    if (!release) {
      return NextResponse.json({ error: "Release not found" }, { status: 404 });
    }

    return NextResponse.json({ release });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch release detail" }, { status: 500 });
  }
}
