/**
 * API endpoint for fetching UI configuration for filing forms
 * 
 * GET /api/filing/ui-config?country=NL&procedureCode=H1&messageName=IE501&messageType=request&transactionType=import
 * 
 * Returns the complete UI configuration with tabs, sections, panels, and fields
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FilingUIConfigData } from "@/types/ui-config.types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const country = searchParams.get("country");
    const procedureCode = searchParams.get("procedureCode");
    const messageName = searchParams.get("messageName");
    const messageType = searchParams.get("messageType") || "request";
    const transactionType = searchParams.get("transactionType") || "import";

    // Validate required parameters
    if (!country || !procedureCode || !messageName) {
      return NextResponse.json(
        { error: "Missing required parameters: country, procedureCode, messageName" },
        { status: 400 }
      );
    }

    // Validate messageType
    if (messageType !== "request" && messageType !== "response") {
      return NextResponse.json(
        { error: "messageType must be 'request' or 'response'" },
        { status: 400 }
      );
    }

    // Validate transactionType
    if (transactionType !== "import" && transactionType !== "export") {
      return NextResponse.json(
        { error: "transactionType must be 'import' or 'export'" },
        { status: 400 }
      );
    }

    // Fetch UI configuration
    const config = await db.filingUIConfig.findUnique({
      where: {
        country_procedureCode_messageName_messageType_transactionType: {
          country,
          procedureCode,
          messageName,
          messageType,
          transactionType,
        },
        isActive: true,
      },
    });

    if (!config) {
      return NextResponse.json(
        { 
          error: "No UI configuration found for the specified parameters",
          details: { country, procedureCode, messageName, messageType, transactionType }
        },
        { status: 404 }
      );
    }

    // Extract full configData structure
    const configData = config.configData as FilingUIConfigData;
    
    // Backward compatibility: if no proper structure, return legacy format
    if (!configData.version || !configData.layout) {
      // Legacy format (old structure with just fields array)
      const fields = (configData as any).fields || [];
      const visibleFields = fields.filter((field: any) => field.isVisible !== false);
      
      // Group fields by section
      const sections = visibleFields.reduce((acc: Record<string, any[]>, field: any) => {
        if (!acc[field.section]) {
          acc[field.section] = [];
        }
        acc[field.section].push(field);
        return acc;
      }, {});
      
      // Sort fields within each section by displayOrder
      Object.keys(sections).forEach(section => {
        sections[section].sort((a, b) => a.displayOrder - b.displayOrder);
      });
      
      return NextResponse.json({
        country,
        procedureCode,
        messageName,
        messageType,
        transactionType,
        version: config.version,
        legacy: true,
        sections,
        totalFields: visibleFields.length,
      });
    }
    
    // New format: return complete structure
    // Filter out invisible elements
    const visibleFields = configData.fields.filter(field => field.isVisible !== false);
    const visibleSections = configData.sections.filter(section => section.isVisible !== false);
    const visibleTabs = configData.tabs?.filter(tab => tab.isVisible !== false);
    
    return NextResponse.json({
      country,
      procedureCode,
      messageName,
      messageType,
      transactionType,
      dbVersion: config.version,
      configVersion: configData.version,
      metadata: configData.metadata,
      layout: configData.layout,
      tabs: visibleTabs,
      sections: visibleSections,
      panels: configData.panels,
      fields: visibleFields,
      validation: configData.validation,
      conditionalLogic: configData.conditionalLogic,
      translations: configData.translations,
      theme: configData.theme,
      permissions: configData.permissions,
      totalFields: visibleFields.length,
      totalSections: visibleSections.length,
      totalTabs: visibleTabs?.length || 0,
    });
  } catch (error) {
    console.error("Error fetching UI configuration:", error);
    return NextResponse.json(
      { error: "Failed to fetch UI configuration" },
      { status: 500 }
    );
  }
}
