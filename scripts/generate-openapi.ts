/**
 * Generates docs/openapi.yaml.
 *
 * Hand-registers schemas from src/app/api route files.
 *
 * Usage:
 *   npm run openapi
 *   npx tsx scripts/generate-openapi.ts
 *
 * The script hand-registers the schemas that are the most useful for
 * the chat tool-calling interface. It cannot auto-extract every inline Zod
 * schema from route files (that would require full TypeScript evaluation),
 * but it covers every public-facing endpoint that the chat tools call.
 */
import { OpenApiGeneratorV3, OpenAPIRegistry, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const ShipmentSummary = registry.register(
  "ShipmentSummary",
  z.object({
    id: z.string().describe("Shipment CUID"),
    shipmentNumber: z.string().describe("Human-readable reference e.g. SHP-2026-001"),
    importerName: z.string(),
    status: z.string().describe("Current shipment status"),
    portOfEntry: z.string().nullable(),
    estimatedArrival: z.string().nullable().describe("ISO-8601 date"),
    createdAt: z.string().describe("ISO-8601 datetime"),
  }).describe("Abbreviated shipment record for list views")
);

const ExceptionItem = registry.register(
  "ExceptionItem",
  z.object({
    id: z.string(),
    type: z.string().describe("Exception type code"),
    severity: z.enum(["Critical", "High", "Medium", "Low"]),
    status: z.string(),
    description: z.string(),
    shipmentId: z.string().nullable(),
    createdAt: z.string(),
  }).describe("Compliance exception requiring human review or waiver")
);

const ComplianceFinding = registry.register(
  "ComplianceFinding",
  z.object({
    id: z.string(),
    rule: z.string(),
    severity: z.enum(["Critical", "High", "Medium", "Low"]),
    status: z.string(),
    description: z.string(),
    createdAt: z.string(),
  }).describe("Finding produced by the compliance audit agent")
);

const DrawbackClaim = registry.register(
  "DrawbackClaim",
  z.object({
    id: z.string(),
    claimType: z.string(),
    status: z.string(),
    totalRefundClaimed: z.number().nullable(),
    createdAt: z.string(),
  }).describe("Duty drawback claim")
);

const PagedMeta = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  total: z.number().int(),
}).describe("Pagination metadata");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// GET /api/shipments
registry.registerPath({
  method: "get",
  path: "/api/shipments",
  summary: "List shipments",
  description: "Returns paginated shipments for the authenticated account. Supports cursor-based pagination, full-text search, and status filtering.",
  tags: ["Shipments"],
  request: {
    query: z.object({
      q: z.string().optional().describe("Full-text search across shipment number and importer name"),
      status: z.string().optional().describe("Filter by shipment status"),
      limit: z.coerce.number().int().min(1).max(200).optional().describe("Page size (default 50, max 200)"),
      cursor: z.string().optional().describe("Cursor returned from the previous page"),
    }),
  },
  responses: {
    200: {
      description: "Paginated shipment list",
      content: {
        "application/json": {
          schema: z.object({
            shipments: z.array(ShipmentSummary),
            pagination: PagedMeta,
            requestId: z.string(),
          }),
        },
      },
    },
    401: { description: "Not authenticated" },
    403: { description: "Insufficient permissions" },
  },
});

// GET /api/exceptions
registry.registerPath({
  method: "get",
  path: "/api/exceptions",
  summary: "List compliance exceptions",
  tags: ["Exceptions"],
  request: {
    query: z.object({
      status: z.string().optional().describe("Filter by status"),
      severity: z.string().optional(),
      assignedToMe: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Exception list",
      content: {
        "application/json": {
          schema: z.object({ exceptions: z.array(ExceptionItem), requestId: z.string() }),
        },
      },
    },
  },
});

// GET /api/findings
registry.registerPath({
  method: "get",
  path: "/api/findings",
  summary: "List compliance findings",
  tags: ["Findings"],
  request: {
    query: z.object({
      status: z.string().optional(),
      severity: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Finding list",
      content: {
        "application/json": {
          schema: z.object({ findings: z.array(ComplianceFinding) }),
        },
      },
    },
  },
});

// GET /api/drawback/claims
registry.registerPath({
  method: "get",
  path: "/api/drawback/claims",
  summary: "List duty drawback claims",
  tags: ["Drawback"],
  responses: {
    200: {
      description: "Drawback claim list",
      content: {
        "application/json": {
          schema: z.object({ drawbackClaims: z.array(DrawbackClaim), requestId: z.string() }),
        },
      },
    },
  },
});

// POST /api/classification/classify
registry.registerPath({
  method: "post",
  path: "/api/classification/classify",
  summary: "Classify a product by description",
  description: "Runs the HTS classification AI agent. Requires classification.create permission.",
  tags: ["Classification"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            productDescription: z.string().min(2).describe("Plain-language product description"),
            materialComposition: z.string().optional(),
            functionUsage: z.string().optional(),
            principalUse: z.string().optional(),
            partNumber: z.string().optional(),
            brandModel: z.string().optional(),
            countryOfOrigin: z.string().optional(),
            shipmentId: z.string().optional().describe("Link result to a specific shipment"),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Classification result with proposed HTS code and evidence" },
    400: { description: "Invalid input" },
    401: { description: "Not authenticated" },
    403: { description: "Missing classification.create permission" },
  },
});

// POST /api/filing/{id}/transmit
registry.registerPath({
  method: "post",
  path: "/api/filing/{id}/transmit",
  summary: "Transmit a customs filing to CBP",
  description: "Requires filings.submit permission.",
  tags: ["Filing"],
  request: {
    params: z.object({ id: z.string().describe("CustomsFiling CUID") }),
  },
  responses: {
    200: { description: "Filing transmitted" },
    403: { description: "Missing filings.submit permission" },
    404: { description: "Filing not found" },
  },
});

// POST /api/refunds/psc
registry.registerPath({
  method: "post",
  path: "/api/refunds/psc",
  summary: "Create a Post-Summary Correction",
  description: "Requires refunds.manage permission. correctedDutyAmount must be supplied by the caller — no estimated fallback is applied.",
  tags: ["Refunds"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            originalFilingId: z.string().describe("CustomsFiling CUID"),
            refundOpportunityId: z.string().optional(),
            reason: z.string().optional(),
            correctionType: z.string().optional(),
            originalDutyAmount: z.number().nonnegative().optional(),
            correctedDutyAmount: z.number().nonnegative().describe("Required — the actual corrected duty. No heuristic fallback."),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "PSC created" },
    400: { description: "Missing or invalid correctedDutyAmount" },
    403: { description: "Missing refunds.manage permission" },
    404: { description: "Filing not found" },
  },
});

// ---------------------------------------------------------------------------
// Generate and write
// ---------------------------------------------------------------------------

const generator = new OpenApiGeneratorV3(registry.definitions);

const doc = generator.generateDocument({
  openapi: "3.0.3",
  info: {
    title: "Qubere Trade Compliance API",
    version: "1.0.0",
    description: "Internal API for the Qubere trade compliance platform. Used by the AI assistant's tool-calling interface.",
  },
  servers: [{ url: "https://app.qubere.ai", description: "Production" }],
});

const outPath = path.join(process.cwd(), "docs", "openapi.yaml");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, yaml.dump(doc, { lineWidth: 120 }), "utf8");
console.log(`OpenAPI spec written to ${outPath}`);
