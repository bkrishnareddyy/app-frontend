import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { importCommitSchema } from "@/modules/product/productSchemas";
import { commitImport } from "@/modules/product/productImportService";

/**
 * Applies a previewed file.
 *
 * Idempotency comes from identity, not from a token: every row is run through
 * the deterministic matcher first, so a row whose identifiers already resolve to
 * a product is reported ALREADY_PRESENT and skipped. Re-uploading yesterday's
 * file therefore creates nothing, whatever request id it arrives under.
 *
 * Each row commits in its own transaction, so the response says exactly which
 * rows landed rather than rolling back thousands of good rows for one race.
 */
export const POST = withAuthenticatedRoute(
  async ({ req, ctx, requestId }) => {
    const body = await parseAndValidateBody(req, importCommitSchema, requestId);
    if ("response" in body) return body.response;

    const result = await commitImport(
      productActor(ctx, requestId),
      body.data.content,
      body.data.fileName ?? null,
      body.data.contentDigest,
      body.data.acceptedRows,
      { clientId: body.data.clientId ?? null }
    );

    return NextResponse.json({ result, requestId });

}, { permission: "products.import", write: true });
