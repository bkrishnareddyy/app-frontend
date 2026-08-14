/**
 * Runtime schemas for every party write.
 *
 * Every field a client can send crosses this file first. Two things are
 * deliberately impossible to express in any schema here, mirroring the same
 * guarantee in `productSchemas.ts`:
 *
 *   - There is no `accountId` on any input. Tenancy comes from the
 *     authenticated session, never from the request.
 *   - There is no `reviewStatus` on party creation or update, and no
 *     `status` on registration creation. A caller cannot post an approved
 *     party or a verified registration; those happen through their own
 *     endpoints, against the lifecycle rules, with a named reviewer.
 */

import { z } from "zod";

const trimmedString = (max: number) => z.string().trim().max(max);
const requiredString = (max: number) => trimmedString(max).min(1);

/** Optional free text where an empty string means "not provided", not "". */
const optionalText = (max: number) =>
  trimmedString(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const partyKindSchema = z.enum(["ORGANIZATION", "INDIVIDUAL"]);

export const partyStatusSchema = z.enum(["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "ARCHIVED"]);

export const partyReviewStatusSchema = z.enum(["UNREVIEWED", "IN_REVIEW", "APPROVED", "REJECTED", "NEEDS_REVIEW"]);

export const partyNameTypeSchema = z.enum(["LEGAL", "TRADE", "DBA", "FORMER_LEGAL", "TRANSLATED"]);

export const partyIdentifierTypeSchema = z.enum([
  "EORI",
  "DUNS",
  "LEI",
  "VAT",
  "TAX_ID",
  "CUSTOMS_ID",
  "INTERNAL_PARTY_CODE",
  "CUSTOMER_NUMBER",
  "SUPPLIER_NUMBER",
  "OTHER",
]);

export const partySourceTypeSchema = z.enum([
  "DOCUMENT",
  "EXTRACTED_FACT",
  "ERP",
  "CRM",
  "USER",
  "CUSTOMER_DECLARATION",
  "SUPPLIER_DECLARATION",
  "EXTERNAL_REGISTRY",
  "IMPORT",
  "AGENT",
  "OTHER",
]);

export const partyAddressTypeSchema = z.enum(["REGISTERED", "MAILING", "BILLING", "SITE", "OPERATING"]);

export const partyRoleTypeSchema = z.enum([
  "IMPORTER",
  "EXPORTER",
  "MANUFACTURER",
  "SUPPLIER",
  "CUSTOMER",
  "CONSIGNEE",
  "CONSIGNOR",
  "CARRIER",
  "FREIGHT_FORWARDER",
  "CUSTOMS_BROKER",
  "BUYER",
  "SELLER",
  "NOTIFY_PARTY",
  "OTHER",
]);

export const partyRelationshipTypeSchema = z.enum([
  "PARENT_OF",
  "SUBSIDIARY_OF",
  "AFFILIATE_OF",
  "AGENT_OF",
  "SUCCESSOR_OF",
  "PREDECESSOR_OF",
]);

export const partyNameInputSchema = z.object({
  nameType: partyNameTypeSchema,
  rawName: requiredString(300),
  language: optionalText(16),
  isPrimary: z.boolean().optional(),
  sourceType: partySourceTypeSchema.optional(),
  evidenceId: optionalText(64),
});

export const partyIdentifierInputSchema = z.object({
  identifierType: partyIdentifierTypeSchema,
  value: requiredString(128),
  issuingCountry: optionalText(100),
  issuingAuthority: optionalText(200),
  isPrimary: z.boolean().optional(),
  sourceType: partySourceTypeSchema.optional(),
  evidenceId: optionalText(64),
});

/**
 * A registration. `country` is required and has no default — defaulting it
 * would mean guessing which jurisdiction a registration number belongs to,
 * and a wrong guess here is a compliance misstatement, not a display quirk.
 */
export const partyRegistrationInputSchema = z.object({
  registrationNumber: requiredString(128),
  registeringAuthority: optionalText(200),
  country: requiredString(100),
  legalForm: optionalText(100),
  registeredOn: z.iso.date().optional(),
  sourceType: partySourceTypeSchema.optional(),
  evidenceId: optionalText(64),
});

export const partyAddressInputSchema = z.object({
  addressType: partyAddressTypeSchema,
  addressLine1: requiredString(300),
  addressLine2: optionalText(300),
  city: optionalText(150),
  stateProvince: optionalText(150),
  postalCode: optionalText(32),
  country: requiredString(100),
  isPrimary: z.boolean().optional(),
  sourceType: partySourceTypeSchema.optional(),
  evidenceId: optionalText(64),
});

export const partyContactInputSchema = z.object({
  name: optionalText(200),
  title: optionalText(200),
  email: z.string().trim().max(320).email().nullable().optional(),
  phone: optionalText(64),
  isPrimary: z.boolean().optional(),
  sourceType: partySourceTypeSchema.optional(),
});

export const partyRoleInputSchema = z.object({
  roleType: partyRoleTypeSchema,
  sourceType: partySourceTypeSchema.optional(),
  evidenceId: optionalText(64),
});

/**
 * A stated relationship to another party. Never a beneficial-ownership graph
 * and never inferred — `toPartyId` must be a party the caller named, and the
 * service checks it belongs to the same account before recording anything.
 */
export const partyRelationshipInputSchema = z.object({
  toPartyId: requiredString(64),
  relationshipType: partyRelationshipTypeSchema,
  sourceType: partySourceTypeSchema.optional(),
  evidenceId: optionalText(64),
});

export const partySiteInputSchema = z.object({
  siteName: requiredString(300),
  addressId: optionalText(64),
});

export const createPartySchema = z.object({
  clientId: optionalText(64),
  partyKind: partyKindSchema.optional(),
  internalPartyCode: optionalText(100),
  names: z.array(partyNameInputSchema).min(1).max(50),
  identifiers: z.array(partyIdentifierInputSchema).max(50).optional(),
  registrations: z.array(partyRegistrationInputSchema).max(20).optional(),
  addresses: z.array(partyAddressInputSchema).max(50).optional(),
  contacts: z.array(partyContactInputSchema).max(50).optional(),
  roles: z.array(partyRoleInputSchema).max(20).optional(),
});

export type CreatePartyInput = z.infer<typeof createPartySchema>;

/**
 * Party edits.
 *
 * Only the party's own top-level fields are editable here. Names,
 * identifiers, registrations, addresses, contacts, roles and relationships
 * each have their own endpoints, because each carries provenance and, for
 * several of them, a lifecycle that a bulk PATCH would flatten.
 */
export const updatePartySchema = z
  .object({
    partyKind: partyKindSchema.optional(),
    internalPartyCode: optionalText(100),
    status: partyStatusSchema.optional(),
    changeReason: optionalText(1000),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "changeReason"),
    "An update must change at least one field."
  );

export type UpdatePartyInput = z.infer<typeof updatePartySchema>;

export const partyReviewActionSchema = z.object({
  action: z.enum(["START_REVIEW", "APPROVE", "REJECT"]),
  reviewNote: optionalText(2000),
});

export const partyRegistrationReviewSchema = z.object({
  action: z.enum(["START_REVIEW", "VERIFY", "REJECT"]),
  reviewNote: optionalText(2000),
  /** Required to VERIFY. Not accepted for any other action. */
  evidenceId: optionalText(64),
});

export const partyEvidenceInputSchema = z
  .object({
    sourceType: partySourceTypeSchema,
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

export const partyMatchRequestSchema = z.object({
  legalName: optionalText(300),
  country: optionalText(100),
  registrationNumber: optionalText(128),
  registrationCountry: optionalText(100),
  identifiers: z
    .array(
      z.object({
        identifierType: partyIdentifierTypeSchema,
        value: requiredString(128),
        issuingCountry: optionalText(100),
      })
    )
    .max(20)
    .optional(),
});

export const partyListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  clientId: z.string().trim().max(100).optional(),
  status: partyStatusSchema.optional(),
  reviewStatus: partyReviewStatusSchema.optional(),
  roleType: partyRoleTypeSchema.optional(),
  needsRevalidation: z.enum(["true", "false"]).optional(),
  sort: z.string().trim().max(64).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const partyIdParamSchema = z.object({
  id: requiredString(64),
});

/** The CSV text itself. 8 MB is roughly 40,000 party rows. */
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
   * proceed if it differs, so a commit can only ever apply the file the user
   * was shown — not a second file uploaded in between.
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
export const BULK_CREATE_PARTY_MAX_ITEMS = 500;

export const bulkCreatePartySchema = z.object({
  items: z.array(createPartySchema).min(1).max(BULK_CREATE_PARTY_MAX_ITEMS),
});

export type BulkCreatePartyInput = z.infer<typeof bulkCreatePartySchema>;
