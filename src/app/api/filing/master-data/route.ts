/**
 * API endpoint for fetching master data for dropdown/lookup fields
 * 
 * GET /api/filing/master-data?source=Country
 * 
 * Returns the options for the specified master data source.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceName = searchParams.get("source");

    if (!sourceName) {
      return NextResponse.json(
        { error: "Missing required parameter: source" },
        { status: 400 }
      );
    }

    // Fetch master data source configuration
    const source = await db.filingMasterDataSource.findUnique({
      where: { sourceName },
    });

    if (!source) {
      return NextResponse.json(
        { error: `Master data source '${sourceName}' not found` },
        { status: 404 }
      );
    }

    if (!source.isActive) {
      return NextResponse.json(
        { error: `Master data source '${sourceName}' is inactive` },
        { status: 403 }
      );
    }

    let options: Array<{ value: string; label: string }> = [];

    // Handle different source types
    switch (source.sourceType) {
      case "static":
        // Return static options from JSON field
        if (source.staticOptions && Array.isArray(source.staticOptions)) {
          options = source.staticOptions as Array<{ value: string; label: string }>;
        }
        break;

      case "table":
        // Query database table (not implemented yet - would need dynamic Prisma queries)
        return NextResponse.json(
          { error: "Table-based sources not yet implemented" },
          { status: 501 }
        );

      case "api":
        // Fetch from external API (not implemented yet)
        return NextResponse.json(
          { error: "API-based sources not yet implemented" },
          { status: 501 }
        );

      case "enum":
        // Return enum values (not implemented yet)
        return NextResponse.json(
          { error: "Enum-based sources not yet implemented" },
          { status: 501 }
        );

      default:
        return NextResponse.json(
          { error: `Unknown source type: ${source.sourceType}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      sourceName,
      sourceType: source.sourceType,
      options,
      totalOptions: options.length,
    });
  } catch (error) {
    console.error("Error fetching master data:", error);
    return NextResponse.json(
      { error: "Failed to fetch master data" },
      { status: 500 }
    );
  }
}
