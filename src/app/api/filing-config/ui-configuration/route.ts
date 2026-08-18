/**
 * API endpoint for managing UI configuration
 * 
 * POST /api/filing-config/ui-configuration - Create/Update complete configuration
 * GET /api/filing-config/ui-configuration - List all configurations
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAccountContext } from "@/lib/auth";
import { validateConfig, getValidationSummary, formatValidationErrors } from "@/lib/ui-config/config-validator";
import { FilingUIConfigData } from "@/types/ui-config.types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const country = searchParams.get("country");
    const procedureCode = searchParams.get("procedureCode");
    const messageName = searchParams.get("messageName");
    const messageType = searchParams.get("messageType");
    const transactionType = searchParams.get("transactionType");

    // Build where clause
    const where: any = { isActive: true };
    if (country) where.country = country;
    if (procedureCode) where.procedureCode = procedureCode;
    if (messageName) where.messageName = messageName;
    if (messageType) where.messageType = messageType;
    if (transactionType) where.transactionType = transactionType;

    const configs = await db.filingUIConfig.findMany({
      where,
      orderBy: [
        { country: 'asc' },
        { procedureCode: 'asc' },
        { messageName: 'asc' },
      ]
    });

    // Transform to match FilingConfigClient expected format: { rows: [...] }
    const rows = configs.map(c => {
      const configData = c.configData as FilingUIConfigData;
      return {
        id: c.id,
        country: c.country,
        procedureCode: c.procedureCode,
        messageName: c.messageName,
        messageType: c.messageType,
        transactionType: c.transactionType,
        version: c.version,
        description: c.description,
        totalFields: configData.fields?.length || 0,
        totalTabs: configData.tabs?.length || 0,
        totalSections: configData.sections?.length || 0,
        layoutMode: configData.layout?.mode || 'single-page',
        configVersion: configData.version || 'unknown',
        isActive: c.isActive,
        updatedAt: c.updatedAt.toISOString(),
        createdBy: c.createdBy,
        updatedBy: c.updatedBy,
      };
    });

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Error fetching UI configurations:", error);
    return NextResponse.json(
      { error: "Failed to fetch UI configurations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const accountContext = await getAccountContext();
    if (!accountContext) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userIdentifier = accountContext.email || accountContext.userId;

    const body = await request.json();

    // Validate required fields
    if (!body.country || !body.procedureCode || !body.messageName || !body.messageType) {
      return NextResponse.json(
        { error: "Missing required fields: country, procedureCode, messageName, messageType" },
        { status: 400 }
      );
    }

    if (!body.configData) {
      return NextResponse.json(
        { error: "configData is required" },
        { status: 400 }
      );
    }

    // Validate configData structure
    const configData = body.configData as FilingUIConfigData;
    const validationResult = validateConfig(configData);
    
    if (!validationResult.valid) {
      return NextResponse.json(
        { 
          error: "Configuration validation failed",
          summary: getValidationSummary(validationResult),
          errors: formatValidationErrors(validationResult.errors),
          warnings: formatValidationErrors(validationResult.warnings),
        },
        { status: 400 }
      );
    }
    
    // Ensure metadata includes last modified timestamp
    if (configData.metadata) {
      configData.metadata.lastModifiedBy = userIdentifier;
      configData.metadata.lastModifiedAt = new Date().toISOString();
    }

    // Check if configuration already exists
    const existing = await db.filingUIConfig.findUnique({
      where: {
        country_procedureCode_messageName_messageType_transactionType: {
          country: body.country,
          procedureCode: body.procedureCode,
          messageName: body.messageName,
          messageType: body.messageType,
          transactionType: body.transactionType || "import",
        }
      }
    });

    let config;
    if (existing) {
      // Update existing configuration
      config = await db.filingUIConfig.update({
        where: { id: existing.id },
        data: {
          configData: body.configData,
          version: { increment: 1 },
          description: body.description,
          isActive: body.isActive !== undefined ? body.isActive : undefined, // Allow updating isActive
          updatedAt: new Date(),
          updatedBy: userIdentifier,
        },
      });
    } else {
      // Create new configuration
      config = await db.filingUIConfig.create({
        data: {
          country: body.country,
          procedureCode: body.procedureCode,
          messageName: body.messageName,
          messageType: body.messageType,
          transactionType: body.transactionType || "import",
          configData: body.configData,
          version: 1,
          description: body.description,
          isActive: body.isActive !== undefined ? body.isActive : true, // Default to active
          createdBy: userIdentifier,
          updatedBy: userIdentifier,
        },
      });
    }

    return NextResponse.json(config, { status: existing ? 200 : 201 });
  } catch (error) {
    console.error("Error creating/updating UI configuration:", error);
    return NextResponse.json(
      { error: "Failed to save UI configuration" },
      { status: 500 }
    );
  }
}
