/**
 * API endpoint for updating/deleting specific UI configuration
 * 
 * GET /api/filing-config/ui-configuration/[id] - Get specific config
 * PUT /api/filing-config/ui-configuration/[id] - Update config
 * DELETE /api/filing-config/ui-configuration/[id] - Delete config
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAccountContext } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const config = await db.filingUIConfig.findUnique({
      where: { id },
    });

    if (!config) {
      return NextResponse.json(
        { error: "Configuration not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error("Error fetching UI configuration:", error);
    return NextResponse.json(
      { error: "Failed to fetch UI configuration" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;

    const config = await db.filingUIConfig.update({
      where: { id },
      data: {
        configData: body.configData,
        version: { increment: 1 },
        description: body.description,
        isActive: body.isActive !== undefined ? body.isActive : undefined,
        updatedAt: new Date(),
        updatedBy: userIdentifier,
      },
    });

    return NextResponse.json(config);
  } catch (error) {
    console.error("Error updating UI configuration:", error);
    return NextResponse.json(
      { error: "Failed to update UI configuration" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db.filingUIConfig.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting UI configuration:", error);
    return NextResponse.json(
      { error: "Failed to delete UI configuration" },
      { status: 500 }
    );
  }
}
