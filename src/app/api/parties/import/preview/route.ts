import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { importPreviewSchema } from "@/modules/party/partySchemas";
import { previewImport } from "@/modules/party/partyImportService";

export const POST = withAuthenticatedRoute(
  async ({ req, ctx, requestId }) => {
    const body = await parseAndValidateBody(req, importPreviewSchema, requestId);
    if ("response" in body) return body.response;

    const preview = await previewImport(
      partyActor(ctx, requestId),
      body.data.content,
      body.data.fileName ?? null
    );

    return NextResponse.json({ preview, requestId });
  },
  { permission: "parties.import", write: true }
);
