/**
 * GET /api/schemas/[country]/[procedure]/[message]/[type]
 * 
 * Serves JSON schemas for customs filing messages.
 * Schemas are stored in public/schemas/ directory.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ country: string; procedure: string; message: string; type: string }> }
) {
  try {
    // Next.js 16: Must await params
    const { country, procedure, message, type } = await context.params;
    const searchParams = request.nextUrl.searchParams;
    const version = searchParams.get("version") || "1.0.0";

    console.log('📋 Schema API called:', { country, procedure, message, type, version });

    // Determine transaction type from PROCEDURE CODE, not message type
    // H* = import, E* = export
    const transactionType = procedure.toUpperCase().startsWith('H') ? "import" : "export";
    const schemaFileName = transactionType === "import" 
      ? "ImportDeclaration.schema.json" 
      : "ExportDeclaration.schema.json";

    const schemaPath = join(
      process.cwd(),
      "public",
      "schemas",
      "customs-filing",
      "filing-schemas",
      transactionType,
      version,
      schemaFileName
    );

    console.log('📂 Schema path:', schemaPath);
    console.log('🔍 Transaction type:', transactionType);

    // Read the schema file
    const schemaContent = await readFile(schemaPath, "utf-8");
    const schema = JSON.parse(schemaContent);

    console.log('✅ Schema loaded');

    return NextResponse.json({
      schema,
      metadata: {
        country,
        procedure,
        message,
        type,
        version,
        transactionType,
        schemaFile: schemaFileName
      }
    });

  } catch (error: any) {
    console.error("Error loading schema:", error);
    
    // Check if file not found
    if (error.code === "ENOENT") {
      return NextResponse.json(
        { 
          error: "Schema not found",
          message: "The requested schema file does not exist",
          details: error.message 
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { 
        error: "Failed to load schema",
        message: error.message 
      },
      { status: 500 }
    );
  }
}
