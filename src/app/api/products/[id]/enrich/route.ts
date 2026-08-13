import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { buildErrorResponse } from "@/lib/api/error";
import { db } from "@/lib/db";
import { productIdParamSchema } from "@/modules/product/productSchemas";

type Params = { id: string };

export interface AttributeSuggestion {
  attributeCode: string;
  attributeName: string;
  rawValue: string;
  rawUnit?: string;
  rationale: string;
  confidence: number;
}

const ENRICHMENT_SCHEMA = {
  type: "object",
  properties: {
    suggestedAttributes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          attributeCode: { type: "string" },
          attributeName: { type: "string" },
          rawValue: { type: "string" },
          rawUnit: { type: "string" },
          rationale: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["attributeCode", "attributeName", "rawValue", "rationale", "confidence"],
        additionalProperties: false,
      },
    },
    overallConfidence: { type: "number", minimum: 0, maximum: 100 },
    enrichmentNotes: { type: "string" },
  },
  required: ["suggestedAttributes", "overallConfidence"],
  additionalProperties: false,
};

const CATALOGUED_CODES =
  "NET_WEIGHT, GROSS_WEIGHT, LENGTH, WIDTH, HEIGHT, VOLUME, PRIMARY_MATERIAL, " +
  "SURFACE_TREATMENT, PROCESSING_STATE, INTENDED_USE, FUNCTION, END_USER_TYPE, " +
  "POWERED, VOLTAGE, POWER_RATING, BATTERY_TYPE, BRAND_NAME, COLOUR, " +
  "RETAIL_PACKAGED, PACKAGING_TYPE, UNIT_OF_MEASURE, HAZMAT, UN_NUMBER, " +
  "CONTAINS_WOOD_PACKAGING";

export const POST = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const path = validatePathParams(params, productIdParamSchema, requestId);
  if ("response" in path) return path.response;

  const product = await db.product.findFirst({
    where: { id: path.data.id, accountId: ctx.accountId, deletedAt: null },
    select: {
      id: true,
      productName: true,
      commercialDescription: true,
      technicalDescription: true,
      customsDescription: true,
      brand: true,
      model: true,
    },
  });

  const activeAttributes = product
    ? await db.productAttribute.findMany({
        where: { productId: path.data.id, accountId: ctx.accountId, status: "ACTIVE" },
        select: { attributeCode: true, attributeName: true, rawValue: true, rawUnit: true },
      })
    : [];

  if (product === null) {
    return buildErrorResponse(404, "PRODUCT_NOT_FOUND", "No such product.", undefined, requestId);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return buildErrorResponse(503, "AI_UNAVAILABLE", "AI enrichment is not configured on this server.", undefined, requestId);
  }

  const existingAttrs =
    activeAttributes.length > 0
      ? activeAttributes
          .map(
            (a) =>
              `  ${a.attributeCode} (${a.attributeName}): ${a.rawValue}${a.rawUnit ? ` ${a.rawUnit}` : ""}`
          )
          .join("\n")
      : "  (none yet)";

  const lines: string[] = [
    "You are a trade compliance product data specialist. Analyze the product below and suggest missing attribute values that would help with customs classification and origin determination.",
    "",
    `Product name: ${product.productName}`,
  ];
  if (product.commercialDescription) lines.push(`Commercial description: ${product.commercialDescription}`);
  if (product.technicalDescription) lines.push(`Technical description: ${product.technicalDescription}`);
  if (product.customsDescription) lines.push(`Customs description: ${product.customsDescription}`);
  if (product.brand) lines.push(`Brand: ${product.brand}`);
  if (product.model) lines.push(`Model: ${product.model}`);
  lines.push(
    "",
    "Already known attributes:",
    existingAttrs,
    "",
    `Catalogued attribute codes (prefer these where they fit): ${CATALOGUED_CODES}`,
    "",
    "Rules:",
    "- Only suggest attributes you can confidently derive from the product name or description — never invent facts.",
    "- Do not re-suggest attributes already listed above.",
    "- Use catalogued codes where they fit; use UPPER_SNAKE_CASE for any custom codes.",
    "- Omit any suggestion whose confidence is below 50.",
    "- The rationale field must quote or reference the product text that supports the suggestion.",
    "",
    "Return enrichment suggestions for this product."
  );

  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: ENRICHMENT_SCHEMA },
    },
    messages: [{ role: "user", content: lines.join("\n") }],
  });

  const final = await stream.finalMessage();

  const textBlock = final.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return buildErrorResponse(502, "AI_PARSE_ERROR", "AI returned no text output.", undefined, requestId);
  }

  let parsed: {
    suggestedAttributes: AttributeSuggestion[];
    overallConfidence: number;
    enrichmentNotes?: string;
  };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return buildErrorResponse(502, "AI_PARSE_ERROR", "AI response was not valid JSON.", undefined, requestId);
  }

  return NextResponse.json({
    productId: product.id,
    suggestedAttributes: parsed.suggestedAttributes ?? [],
    overallConfidence: parsed.overallConfidence ?? 0,
    enrichmentNotes: parsed.enrichmentNotes ?? null,
    requestId,
  });
});
