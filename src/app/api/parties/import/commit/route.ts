import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { importCommitSchema } from "@/modules/party/partySchemas";
import { commitImport } from "@/modules/party/partyImportService";

export const POST = withAuthenticatedRoute(
  async ({ req, ctx, requestId }) => {
    const body = await parseAndValidateBody(req, importCommitSchema, requestId);
    if ("response" in body) return body.response;

    const result = await commitImport(
      partyActor(ctx, requestId),
      body.data.content,
      body.data.fileName ?? null,
      body.data.contentDigest,
      body.data.acceptedRows
    );

    return NextResponse.json({ result, requestId });
  },
  { permission: "parties.import", write: true }
);
