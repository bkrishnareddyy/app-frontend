import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

/**
 * GET /api/filing/procedures
 * Returns available filing procedures grouped by country
 * Used by the New Filing modal to show country → procedure → message options
 * Only returns procedures where canCreateNewFiling = true (filters out amendments, cancellations, etc.)
 */
export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  // Get all active filing procedure configurations that can create new filings
  // Excludes operational messages like amendments (IE013), cancellations (IE014), etc.
  const procedures = await db.filingProcedureConfig.findMany({
    where: { 
      isActive: true,
      canCreateNewFiling: true,  // Only include messages that can create new filings
    },
    orderBy: [{ country: "asc" }, { procedureCode: "asc" }],
  });

  // Group by country
  const groupedByCountry = procedures.reduce((acc, proc) => {
    if (!acc[proc.country]) {
      acc[proc.country] = {
        country: proc.country,
        procedures: {},
      };
    }

    const procKey = proc.procedureCode;
    if (!acc[proc.country].procedures[procKey]) {
      acc[proc.country].procedures[procKey] = {
        procedureCode: proc.procedureCode,
        messages: [],
      };
    }

    acc[proc.country].procedures[procKey].messages.push({
      messageName: proc.messageName,
      id: proc.id,
    });

    return acc;
  }, {} as Record<string, {
    country: string;
    procedures: Record<string, {
      procedureCode: string;
      messages: Array<{ messageName: string; id: string }>;
    }>;
  }>);

  // Convert to array format
  const countries = Object.values(groupedByCountry).map(countryData => ({
    country: countryData.country,
    procedures: Object.values(countryData.procedures),
  }));

  return NextResponse.json({ countries });
});
