import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import {
  buildDocumentOrderBy,
  buildDocumentWhere,
  documentSkip,
  parseDocumentQuery,
} from "@/modules/documents/documentQuery";

export async function GET(req: Request) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (!ctx) {
    return errorResponse ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const query = parseDocumentQuery(new URL(req.url).searchParams);
    const where = buildDocumentWhere(ctx.accountId, query);

    const [total, documents] = await Promise.all([
      db.shipmentDocument.count({ where }),
      db.shipmentDocument.findMany({
        where,
        select: {
          id: true,
          fileName: true,
          docType: true,
          status: true,
          pageCount: true,
          confidence: true,
          createdAt: true,
          shipmentId: true,
          shipment: {
            select: {
              shipmentNumber: true,
              clientId: true,
              client: { select: { name: true } },
            },
          },
          _count: { select: { extractionFields: true } },
        },
        orderBy: buildDocumentOrderBy(query),
        skip: documentSkip(query),
        take: query.pageSize,
      }),
    ]);

    return NextResponse.json({
      documents: documents.map((doc) => ({
        id: doc.id,
        fileName: doc.fileName,
        docType: doc.docType,
        status: doc.status,
        pageCount: doc.pageCount,
        confidence: doc.confidence,
        createdAt: doc.createdAt,
        shipmentId: doc.shipmentId,
        shipmentNumber: doc.shipment?.shipmentNumber ?? null,
        clientId: doc.shipment?.clientId ?? null,
        clientName: doc.shipment?.client?.name ?? null,
        extractedFieldCount: doc._count.extractionFields,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      sort: query.sort,
      direction: query.direction,
    });
  } catch (error) {
    console.error("GET /api/documents error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
