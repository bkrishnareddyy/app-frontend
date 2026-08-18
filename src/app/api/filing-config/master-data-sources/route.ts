/**
 * API endpoint for listing master data sources
 * 
 * GET /api/filing-config/master-data-sources
 * 
 * Returns all active master data sources for use in dropdowns/lookups configuration.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const sources = await db.filingMasterDataSource.findMany({
      where: { isActive: true },
      orderBy: { sourceName: "asc" },
      select: {
        id: true,
        sourceName: true,
        sourceType: true,
      },
    });

    return NextResponse.json(sources);
  } catch (error) {
    console.error("Error fetching master data sources:", error);
    return NextResponse.json(
      { error: "Failed to fetch master data sources" },
      { status: 500 }
    );
  }
}
