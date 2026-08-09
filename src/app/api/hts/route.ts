import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validateQueryParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const querySchema = z.object({
  search: z.string().optional(),
  q: z.string().optional(),
  chapter: z.string().optional(),
  page: z.string().optional().transform((val) => Math.max(1, parseInt(val || "1", 10))),
  limit: z.string().optional().transform((val) => Math.min(100, Math.max(1, parseInt(val || "20", 10)))),
});

export const GET = withAuthenticatedRoute(async ({ req, requestId }) => {
  const queryVal = validateQueryParams(req.url, querySchema, requestId);
  if ("response" in queryVal) return queryVal.response;

  const { search, q, chapter, page, limit } = queryVal.data;
  const searchTerm = (search || q || "").trim();
  const skip = (page - 1) * limit;

  const where: import("@prisma/client").Prisma.HTSCodeWhereInput = {};

  if (chapter) {
    where.chapterNumber = chapter;
  }

  if (searchTerm) {
    where.OR = [
      { htsCode10: { contains: searchTerm, mode: "insensitive" } },
      { description: { contains: searchTerm, mode: "insensitive" } },
      { headingNumber: { contains: searchTerm, mode: "insensitive" } },
    ];
  }

  const [totalCount, htsCodes] = await Promise.all([
    db.hTSCode.count({ where }),
    db.hTSCode.findMany({
      where,
      orderBy: { htsCode10: "asc" },
      skip,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    htsCodes,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    },
    requestId,
  });
});
