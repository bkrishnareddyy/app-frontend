import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { importPreviewSchema } from "@/modules/product/productSchemas";
import { previewImport } from "@/modules/product/productImportService";

/**
 * Validates a file and reports what committing it would do. Writes nothing.
 *
 * The response carries a digest of the file. The commit endpoint recomputes it
 * and refuses to proceed on a mismatch, so a commit can only ever apply the
 * file whose preview the user actually read.
 */
export const POST = withAuthenticatedRoute(
  async ({ req, ctx, requestId }) => {
    const body = await parseAndValidateBody(req, importPreviewSchema, requestId);
    if ("response" in body) return body.response;

    const preview = await previewImport(
      productActor(ctx, requestId),
      body.data.content,
      body.data.fileName ?? null
    );

    return NextResponse.json({ preview, requestId });
  },
  { permission: "products.import", write: true }
);
