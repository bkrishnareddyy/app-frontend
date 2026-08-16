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

const RestrictedPartyMatchItem = registry.register(
  "RestrictedPartyMatchItem",
  z.object({
    matchedName: z.string(),
    nameScore: z.number().int(),
    matchMethod: z.enum(["EXACT", "RAW_WORD", "METAPHONE", "DOUBLE_METAPHONE", "COMBINED"]),
    sourceList: z.string().describe("e.g. SDN, CONSOLIDATED_NON_SDN, DPL, ISN, SSI, FSE, PLC, NS_MBS"),
    programCodes: z.array(z.string()),
    suppressedByApprovedParty: z.boolean().optional(),
  }).describe("A denial-order candidate match against a screened identity")
);

const RestrictedPartyRedFlagHitItem = registry.register(
  "RestrictedPartyRedFlagHitItem",
  z.object({ matchedWord: z.string() }).describe("A Know-Your-Customer red-flag phrase found in the screened identity")
);

const RestrictedPartyPassResult = registry.register(
  "RestrictedPartyPassResult",
  z.object({
    id: z.string().optional(),
    passType: z.enum(["PARTY_NAME", "CONTACT_NAME"]),
    status: z.enum(["CLEAR", "HIT", "REVIEW_REQUIRED", "PARTIAL", "SKIPPED", "ERROR"]),
    hitCount: z.number().int(),
    redFlagCount: z.number().int(),
    matches: z.array(RestrictedPartyMatchItem).optional(),
    redFlagHits: z.array(RestrictedPartyRedFlagHitItem).optional(),
  }).describe("One immutable screening pass outcome (party-name and contact-name passes are always separate)")
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

// POST /api/v1/screening/restricted-party
registry.registerPath({
  method: "post",
  path: "/api/v1/screening/restricted-party",
  summary: "Screen a party against restricted/denied-party lists",
  description:
    "Screens an ad-hoc identity (not a persisted Party Master record or shipment) against OFAC SDN/BIS DPL and related denial-order lists, plus Know-Your-Customer red-flag words, and persists an immutable result. API-key authenticated. Requires the compliance.restrictedParty.screen scope. Supports an Idempotency-Key header.",
  tags: ["Restricted Party Screening"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            externalReference: z.string().optional().describe("Caller-supplied correlation token"),
            party: z.object({
              name: z.string().min(1),
              address: z.string().optional(),
              city: z.string().optional(),
              country: z.string().optional(),
              contactName: z.string().optional().describe("Screened as an independent pass"),
            }),
            threshold: z.number().int().min(0).max(100).optional().describe("Minimum fuzzy-match score for a HIT-tier match"),
            addressThreshold: z.number().int().min(0).max(100).optional(),
            countryMatch: z.boolean().optional().describe("Require country alignment on a match"),
            redFlagCheck: z.boolean().optional().describe("Default true"),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Screening completed and persisted",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            correlationId: z.string(),
            results: z.array(RestrictedPartyPassResult),
            requestId: z.string(),
          }),
        },
      },
    },
    401: { description: "Missing or invalid API key" },
    403: { description: "Key does not have compliance.restrictedParty.screen scope" },
    409: { description: "Idempotency key conflict or a concurrent request is already processing" },
    429: { description: "Rate limit exceeded" },
  },
});

// GET /api/v1/screening/restricted-party/{screeningId}
registry.registerPath({
  method: "get",
  path: "/api/v1/screening/restricted-party/{screeningId}",
  summary: "Get one persisted restricted-party screening result",
  description: "Session-authenticated. Requires compliance.restrictedParty.read. A screeningId belonging to another account is reported as not found.",
  tags: ["Restricted Party Screening"],
  request: {
    params: z.object({ screeningId: z.string() }),
  },
  responses: {
    200: { description: "Screening result with matches and red-flag hits" },
    404: { description: "Screening result not found" },
  },
});

// PATCH /api/v1/screening/restricted-party/{screeningId}/disposition
registry.registerPath({
  method: "patch",
  path: "/api/v1/screening/restricted-party/{screeningId}/disposition",
  summary: "Record a reviewer disposition on a screening result",
  description:
    "The immutable screening result is never changed -- a disposition is a separate, mutable reviewer judgment layer. Session-authenticated. Requires compliance.restrictedParty.dispose (admin-only).",
  tags: ["Restricted Party Screening"],
  request: {
    params: z.object({ screeningId: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            status: z.enum(["CONFIRMED_MATCH", "FALSE_POSITIVE", "APPROVED", "BLOCKED", "REQUEST_MORE_INFORMATION"]),
            notes: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Disposition recorded" },
    403: { description: "Missing compliance.restrictedParty.dispose permission" },
    404: { description: "Screening result not found" },
  },
});

// GET /api/v1/parties/{partyId}/restricted-party-screening-history
registry.registerPath({
  method: "get",
  path: "/api/v1/parties/{partyId}/restricted-party-screening-history",
  summary: "Get a Party Master record's restricted-party screening status and history",
  description: "Session-authenticated. Requires compliance.restrictedParty.read. A partyId belonging to another account is reported as not found.",
  tags: ["Restricted Party Screening"],
  request: {
    params: z.object({ partyId: z.string() }),
  },
  responses: {
    200: {
      description: "Screening summary and up to the 50 most recent screening results",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            summary: z.object({ screeningStatus: z.string(), lastScreenedAt: z.string().nullable() }).nullable(),
            results: z.array(RestrictedPartyPassResult),
            requestId: z.string(),
          }),
        },
      },
    },
    404: { description: "Party not found" },
  },
});

// POST /api/v1/parties/{partyId}/restricted-party-screening/rescreen
registry.registerPath({
  method: "post",
  path: "/api/v1/parties/{partyId}/restricted-party-screening/rescreen",
  summary: "Re-screen a Party Master record's current identity",
  description:
    "Re-runs screening against the party's current-effective name/address/contact and upserts PartyScreeningSummary. Session-authenticated. Requires compliance.restrictedParty.screen.",
  tags: ["Restricted Party Screening"],
  request: {
    params: z.object({ partyId: z.string() }),
  },
  responses: {
    200: {
      description: "Re-screening completed",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            overallStatus: z.string(),
            results: z.array(RestrictedPartyPassResult),
            requestId: z.string(),
          }),
        },
      },
    },
    404: { description: "Party not found" },
    422: { description: "Party has no active name to screen" },
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
