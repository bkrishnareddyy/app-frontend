/**
 * Runtime schemas for every product write.
 *
 * Every field a client can send crosses this file first. Two things are
 * deliberately impossible to express in any schema here:
 *
 *   - There is no `accountId` on any input. Tenancy comes from the authenticated
 *     session, never from the request, so there is nothing for a caller to
 *     supply and nothing for the service to be tempted to trust.
 *   - There is no `status` on classification or country-fact creation. A caller
 *     cannot post an approved classification; approval happens through its own
 *     endpoint, against the lifecycle rules, with a named reviewer.
 */

import { z } from "zod";
import { PRODUCT_ATTRIBUTE_DEFINITIONS } from "./productAttributes";
import { isKnownJurisdiction, isValidNomenclature } from "./productVocabulary";
import { checkClassificationCode } from "./productNormalization";

const trimmedString = (max: number) => z.string().trim().max(max);
const requiredString = (max: number) => trimmedString(max).min(1);

/** Optional free text where an empty string means "not provided", not "". */
const optionalText = (max: number) =>
  trimmedString(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const productIdentifierTypeSchema = z.enum([
  "INTERNAL_SKU",
  "CUSTOMER_SKU",
  "SUPPLIER_SKU",
  "MANUFACTURER_PART_NUMBER",
  "MODEL_NUMBER",
  "GTIN",
  "UPC",
  "EAN",
  "STYLE_NUMBER",
  "OTHER",
]);

export const productSourceTypeSchema = z.enum([
  "DOCUMENT",
  "EXTRACTED_FACT",
  "ERP",
  "PIM",
  "USER",
  "MANUFACTURER_DATASHEET",
  "SUPPLIER_DECLARATION",
  "CUSTOMS_RULING",
  "REGULATORY_SOURCE",
  "IMPORT",
  "AGENT",
  "OTHER",
]);

export const productPartyRoleSchema = z.enum(["MANUFACTURER", "SUPPLIER", "BRAND_OWNER"]);

export const productCountryFactTypeSchema = z.enum([
  "MANUFACTURE_COUNTRY",
  "PRODUCTION_COUNTRY",
  "ORIGIN_CLAIM",
]);

export const productStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
  "SUPERSEDED",
  "ARCHIVED",
]);

const attributeCodes = PRODUCT_ATTRIBUTE_DEFINITIONS.map((definition) => definition.code);

/**
 * An attribute code is either catalogued or a tenant's own.
 *
 * An uncatalogued code is accepted, in upper snake case, rather than rejected —
 * the catalogue cannot anticipate every trade — and change detection treats such
 * a code as customs-significant precisely because nothing here vouches for it.
 */
export const attributeCodeSchema = requiredString(64)
  .transform((value) => value.toUpperCase().replace(/[\s-]+/g, "_"))
  .refine(
    (value) => /^[A-Z0-9_]+$/.test(value),
    "An attribute code may only contain letters, digits and underscores."
  )
  .refine(
    (value) => value.length <= 64,
    "An attribute code may be at most 64 characters."
  );

export const knownAttributeCodes: readonly string[] = attributeCodes;

export const productIdentifierInputSchema = z.object({
  identifierType: productIdentifierTypeSchema,
  value: requiredString(128),
  issuerPartyId: optionalText(64),
  isPrimary: z.boolean().optional(),
  sourceType: productSourceTypeSchema.optional(),
});

export const productAttributeInputSchema = z.object({
  attributeCode: attributeCodeSchema,
  attributeName: optionalText(128),
  rawValue: requiredString(2000),
  rawUnit: optionalText(32),
  sourceType: productSourceTypeSchema.optional(),
  evidenceId: optionalText(64),
});

export const productCompositionInputSchema = z.object({
  material: requiredString(200),
  componentName: optionalText(200),
  /** Percentage by weight. Rejected outside 0–100 rather than clamped. */
  percentage: z.number().min(0).max(100).nullable().optional(),
  quantity: z.number().finite().nullable().optional(),
  unit: optionalText(32),
  grade: optionalText(100),
  alloy: optionalText(100),
  chemicalIdentifier: optionalText(100),
  isCompleteDeclaration: z.boolean().optional(),
  sourceType: productSourceTypeSchema.optional(),
  evidenceId: optionalText(64),
});

export const productPartyInputSchema = z.object({
  legalEntityId: requiredString(64),
  role: productPartyRoleSchema,
  manufacturingSite: optionalText(300),
  sourceType: productSourceTypeSchema.optional(),
  evidenceId: optionalText(64),
});

/**
 * A country fact.
 *
 * `factType` is required and has no default. Defaulting it would mean guessing
 * whether a country a user typed is where the goods are made or where they
 * legally originate, and those are different claims with different consequences.
 */
export const productCountryFactInputSchema = z.object({
  factType: productCountryFactTypeSchema,
  country: requiredString(100),
  sourceType: productSourceTypeSchema.optional(),
  sourceReference: optionalText(500),
  evidenceId: optionalText(64),
});

export const jurisdictionSchema = requiredString(16)
  .transform((value) => value.toUpperCase())
  .refine(isKnownJurisdiction, "Unrecognised jurisdiction. Use an ISO country code or a customs union code.");

export const productClassificationInputSchema = z
  .object({
    jurisdiction: jurisdictionSchema,
    nomenclature: requiredString(32).transform((value) => value.toUpperCase()),
    classificationCode: requiredString(32),
    description: optionalText(1000),
    decisionSource: productSourceTypeSchema.optional(),
    decisionMethod: z.enum(["MANUAL", "IMPORT", "AGENT_PROPOSED", "RULING_BASED"]).optional(),
    effectiveFrom: z.iso.datetime({ offset: true }).optional(),
    evidenceId: optionalText(64),
  })
  .superRefine((value, ctx) => {
    if (!isValidNomenclature(value.jurisdiction, value.nomenclature)) {
      ctx.addIssue({
        code: "custom",
        path: ["nomenclature"],
        message: `${value.nomenclature} is not a nomenclature used by ${value.jurisdiction}.`,
      });
    }

    const check = checkClassificationCode(value.nomenclature, value.classificationCode);
    if (check.normalized === "") {
      ctx.addIssue({
        code: "custom",
        path: ["classificationCode"],
        message: "A classification code must contain digits.",
      });
      return;
    }
    if (!check.wellFormed) {
      const expected = check.expectedLengths?.join(" or ") ?? "at least 6";
      ctx.addIssue({
        code: "custom",
        path: ["classificationCode"],
        message: `${value.nomenclature} codes carry ${expected} digits; this one has ${check.normalized.length}. Note that Qubere checks the shape of a code, not whether it exists in the tariff.`,
      });
    }
  });

export const createProductSchema = z.object({
  clientId: optionalText(64),
  productName: requiredString(300),
  internalSku: optionalText(100),
  commercialDescription: optionalText(4000),
  technicalDescription: optionalText(4000),
  customsDescription: optionalText(4000),
  brand: optionalText(200),
  model: optionalText(200),
  status: productStatusSchema.optional(),
  identifiers: z.array(productIdentifierInputSchema).max(50).optional(),
  attributes: z.array(productAttributeInputSchema).max(200).optional(),
  compositions: z.array(productCompositionInputSchema).max(200).optional(),
  parties: z.array(productPartyInputSchema).max(50).optional(),
  countryFacts: z.array(productCountryFactInputSchema).max(50).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * Product edits.
 *
 * Only the product's own descriptive fields are editable here. Identifiers,
 * attributes, compositions, parties, country facts and classifications each have
 * their own endpoints, because each of them carries provenance and a lifecycle
 * that a bulk PATCH would flatten.
 */
export const updateProductSchema = z
  .object({
    productName: requiredString(300).optional(),
    internalSku: optionalText(100),
    commercialDescription: optionalText(4000),
    technicalDescription: optionalText(4000),
    customsDescription: optionalText(4000),
    brand: optionalText(200),
    model: optionalText(200),
    status: productStatusSchema.optional(),
    changeReason: optionalText(1000),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "changeReason"),
    "An update must change at least one field."
  );

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const classificationReviewSchema = z.object({
  action: z.enum(["PROPOSE", "START_REVIEW", "APPROVE", "REJECT"]),
  reviewNote: optionalText(2000),
  effectiveFrom: z.iso.datetime({ offset: true }).optional(),
});

export const countryFactReviewSchema = z.object({
  action: z.enum(["START_REVIEW", "VERIFY", "REJECT"]),
  reviewNote: optionalText(2000),
});

export const productEvidenceInputSchema = z
  .object({
    sourceType: productSourceTypeSchema,
    sourceDocumentId: optionalText(64),
    sourceExtractedFactId: optionalText(64),
    sourceReference: optionalText(500),
    sourceUrl: optionalText(2000),
    page: z.number().int().min(1).nullable().optional(),
    description: optionalText(1000),
  })
  .refine(
    (value) =>
      value.sourceDocumentId != null ||
      value.sourceExtractedFactId != null ||
      value.sourceReference != null ||
      value.sourceUrl != null,
    "Evidence must point at something: a document, an extracted fact, a reference, or a URL."
  );

export const productMatchRequestSchema = z.object({
  productName: optionalText(300),
  brand: optionalText(200),
  manufacturerPartyId: optionalText(64),
  identifiers: z
    .array(z.object({ identifierType: productIdentifierTypeSchema, value: requiredString(128) }))
    .max(20)
    .optional(),
});

export const productListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  clientId: z.string().trim().max(100).optional(),
  status: productStatusSchema.optional(),
  jurisdiction: z.string().trim().max(16).optional(),
  reviewStatus: z.enum(["UNREVIEWED", "IN_REVIEW", "APPROVED", "REJECTED", "NEEDS_REVIEW"]).optional(),
  needsRevalidation: z.enum(["true", "false"]).optional(),
  sort: z.string().trim().max(64).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const productIdParamSchema = z.object({
  id: requiredString(64),
});

/** The CSV text itself. 8 MB is roughly 40,000 product rows. */
const csvContent = z.string().min(1).max(8_000_000);

export const importPreviewSchema = z.object({
  content: csvContent,
  fileName: optionalText(255),
});

export const importCommitSchema = z.object({
  content: csvContent,
  fileName: optionalText(255),
  /**
   * The digest the preview reported. The commit recomputes it and refuses to
   * proceed if it differs, so a commit can only ever apply the file the user was
   * shown — not a second file uploaded in between.
   */
  contentDigest: requiredString(128),
  /** Rows the user chose to keep, by row number in the uploaded file. */
  acceptedRows: z.array(z.number().int().min(1)).max(50_000).optional(),
});

/**
 * Kept well below the CSV path's implicit row count: this runs synchronously
 * in one request, with no batching or background job behind it, so the limit
 * is what one invocation can process rather than a business rule.
 */
export const BULK_CREATE_PRODUCT_MAX_ITEMS = 500;

export const bulkCreateProductSchema = z.object({
  items: z.array(createProductSchema).min(1).max(BULK_CREATE_PRODUCT_MAX_ITEMS),
});

export type BulkCreateProductInput = z.infer<typeof bulkCreateProductSchema>;
