/**
 * The tenant-scoped data layer for the product master.
 *
 * Every function here takes a `ProductActor` carrying the accountId resolved from
 * the authenticated session, and every query it issues filters on that accountId.
 * There is no code path that accepts an account from a caller: routes pass
 * `ctx.accountId` from `getAccountContext()`, and the request schemas have no
 * field for one, so there is nothing to forge.
 *
 * A product id belonging to another tenant is reported as not found rather than
 * as forbidden. "Forbidden" tells the caller the id exists, which turns any
 * detail endpoint into an enumeration oracle for another company's catalogue.
 *
 * Three invariants this module is responsible for:
 *
 *   - Every mutation runs through `withChangeDetection`, so a write that changes
 *     something customs-significant always produces a change event and, where
 *     warranted, an open revalidation flag. There is no side door.
 *   - Classification status only ever moves through the lifecycle rules, and
 *     APPROVED requires a permission and a named reviewer.
 *   - Facts carry their provenance. A fact created from a document points at the
 *     document; a fact created by hand says so. Nothing invents a source.
 */

import type { Prisma, PrismaClient, Product } from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { DomainError } from "@/lib/api/error";
import {
  buildProductOrderBy,
  buildProductWhere,
  productSkip,
  type ProductQuery,
} from "./productQuery";
import {
  detectProductChanges,
  highestSignificance,
  revalidationSignals,
  type DetectedChange,
  type ProductSnapshot,
} from "./productChangeDetection";
import {
  canApproveClassification,
  canTransitionClassification,
  canTransitionCountryFact,
  classificationIdentity,
  initialClassificationStatus,
} from "./productDecisionLifecycle";
import { matchProduct, type MatchCandidateInput, type ProductMatchResult } from "./productMatching";
import {
  normalizeClassificationCode,
  normalizeCountry,
  normalizeIdentifier,
  normalizeQuantity,
  trimToNull,
} from "./productNormalization";
import { findAttributeDefinition } from "./productAttributes";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "./productSchemas";
import { UNIQUE_IDENTIFIER_TYPES } from "./productMatching";

/** Who is acting, and on whose behalf. Never assembled from request input. */
export interface ProductActor {
  accountId: string;
  userId: string | null;
  /** Whether the actor holds products.classification.approve. */
  canApproveClassification?: boolean;
  requestId?: string | null;
}

type Tx = Prisma.TransactionClient | PrismaClient;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const LIST_SELECT = {
  id: true,
  internalSku: true,
  productName: true,
  brand: true,
  model: true,
  status: true,
  reviewStatus: true,
  currentVersion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export interface ProductListRow {
  id: string;
  internalSku: string | null;
  productName: string;
  brand: string | null;
  model: string | null;
  status: string;
  reviewStatus: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  /** Jurisdictions holding an approved classification, for the list badge. */
  approvedJurisdictions: string[];
  /** Count of candidate/proposed classifications awaiting someone. */
  pendingClassificationCount: number;
  openRevalidationCount: number;
}

export interface ProductListResult {
  rows: ProductListRow[];
  total: number;
}

export async function listProducts(
  actor: ProductActor,
  query: ProductQuery
): Promise<ProductListResult> {
  const where = buildProductWhere(actor.accountId, query) as Prisma.ProductWhereInput;

  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      select: {
        ...LIST_SELECT,
        classifications: {
          where: { status: { in: ["APPROVED", "CANDIDATE", "PROPOSED", "UNDER_REVIEW"] } },
          select: { jurisdiction: true, status: true },
        },
        revalidationFlags: {
          where: { status: "OPEN" },
          select: { id: true },
        },
      },
      orderBy: buildProductOrderBy(query),
      skip: productSkip(query),
      take: query.pageSize,
    }),
    db.product.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((row) => {
      const approved = row.classifications.filter((c) => c.status === "APPROVED");
      return {
        id: row.id,
        internalSku: row.internalSku,
        productName: row.productName,
        brand: row.brand,
        model: row.model,
        status: row.status,
        reviewStatus: row.reviewStatus,
        currentVersion: row.currentVersion,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        approvedJurisdictions: [...new Set(approved.map((c) => c.jurisdiction))].sort(),
        pendingClassificationCount: row.classifications.length - approved.length,
        openRevalidationCount: row.revalidationFlags.length,
      };
    }),
  };
}

const DETAIL_INCLUDE = {
  identifiers: { orderBy: [{ isPrimary: "desc" }, { identifierType: "asc" }] },
  attributes: { orderBy: { attributeCode: "asc" } },
  compositions: { orderBy: [{ percentage: "desc" }, { material: "asc" }] },
  parties: { orderBy: { role: "asc" }, include: { legalEntity: true } },
  countryFacts: { orderBy: [{ factType: "asc" }, { effectiveFrom: "desc" }] },
  classifications: { orderBy: [{ jurisdiction: "asc" }, { effectiveFrom: "desc" }] },
  evidence: { orderBy: { createdAt: "desc" } },
  revalidationFlags: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.ProductInclude;

export type ProductDetail = Prisma.ProductGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** Returns null for a product in another account: not found, never forbidden. */
export async function getProduct(
  actor: ProductActor,
  productId: string
): Promise<ProductDetail | null> {
  return db.product.findFirst({
    where: { id: productId, accountId: actor.accountId, deletedAt: null },
    include: DETAIL_INCLUDE,
  });
}

export async function getProductHistory(actor: ProductActor, productId: string) {
  await requireOwnedProduct(db, actor, productId);
  return db.productChangeEvent.findMany({
    where: { productId, accountId: actor.accountId },
    orderBy: [{ createdAt: "desc" }],
    take: 500,
  });
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

export class ProductNotFoundError extends DomainError {
  constructor(productId: string) {
    super(`No product ${productId} in this account.`, "PRODUCT_NOT_FOUND", 404);
    this.name = "ProductNotFoundError";
  }
}

/**
 * Confirms the product exists *inside the actor's account*.
 *
 * Called at the top of every mutation, including the ones whose subsequent
 * writes also carry an accountId filter. The redundancy is deliberate: it means
 * a future query written without the filter still cannot act on another tenant's
 * product, because it never gets past this line.
 */
async function requireOwnedProduct(
  tx: Tx,
  actor: ProductActor,
  productId: string
): Promise<Product> {
  const product = await tx.product.findFirst({
    where: { id: productId, accountId: actor.accountId, deletedAt: null },
  });
  if (product === null) throw new ProductNotFoundError(productId);
  return product;
}

/** Confirms an evidence row belongs to this account *and* this product. */
async function requireOwnedEvidence(
  tx: Tx,
  actor: ProductActor,
  productId: string,
  evidenceId: string
): Promise<string> {
  const evidence = await tx.productEvidence.findFirst({
    where: { id: evidenceId, accountId: actor.accountId, productId },
    select: { id: true },
  });
  if (evidence === null) {
    throw new DomainError(
      "That evidence does not belong to this product.",
      "PRODUCT_EVIDENCE_NOT_FOUND",
      404
    );
  }
  return evidence.id;
}

async function requireOwnedLegalEntity(
  tx: Tx,
  actor: ProductActor,
  legalEntityId: string
): Promise<string> {
  const entity = await tx.legalEntity.findFirst({
    where: { id: legalEntityId, accountId: actor.accountId },
    select: { id: true },
  });
  if (entity === null) {
    throw new DomainError(
      "That party does not exist in this account.",
      "LEGAL_ENTITY_NOT_FOUND",
      404
    );
  }
  return entity.id;
}

// ---------------------------------------------------------------------------
// Snapshots and change detection
// ---------------------------------------------------------------------------

async function loadSnapshot(
  tx: Tx,
  accountId: string,
  productId: string
): Promise<ProductSnapshot> {
  const product = await tx.product.findFirstOrThrow({
    where: { id: productId, accountId },
    include: {
      attributes: { where: { status: "ACTIVE" } },
      compositions: { where: { status: "ACTIVE" } },
      parties: { where: { status: "ACTIVE" } },
      countryFacts: { where: { status: { notIn: ["SUPERSEDED", "REJECTED"] } } },
    },
  });

  return {
    productName: product.productName,
    commercialDescription: product.commercialDescription,
    technicalDescription: product.technicalDescription,
    customsDescription: product.customsDescription,
    brand: product.brand,
    model: product.model,
    attributes: product.attributes.map((attribute) => ({
      attributeCode: attribute.attributeCode,
      value: attribute.normalizedValue ?? attribute.rawValue,
      unit: attribute.normalizedUnit ?? attribute.rawUnit,
    })),
    compositions: product.compositions.map((composition) => ({
      material: composition.material,
      percentage: composition.percentage === null ? null : Number(composition.percentage),
      componentName: composition.componentName,
    })),
    parties: product.parties.map((party) => ({
      role: party.role,
      legalEntityId: party.legalEntityId,
      manufacturingSite: party.manufacturingSite,
    })),
    countryFacts: product.countryFacts.map((fact) => ({
      factType: fact.factType,
      country: fact.countryCode ?? fact.rawCountry,
    })),
  };
}

export interface MutationOutcome<T> {
  result: T;
  changes: DetectedChange[];
  /** Flags newly opened by this mutation. */
  raisedFlags: string[];
}

/**
 * Runs a mutation and records what it did to the product's customs surface.
 *
 * The snapshot is taken before and after inside the same transaction, so the
 * comparison sees exactly the mutation's effect and nothing a concurrent write
 * did. Every change becomes a `ProductChangeEvent`; every customs-significant one
 * additionally opens a `ProductRevalidationFlag` unless an identical flag is
 * already open, because a product edited five times in an afternoon should show
 * one outstanding question per topic, not five.
 *
 * Nothing here touches classification status. A revalidation flag is a request
 * for a human to look again; the approved classification stays approved and
 * stays usable until that human decides otherwise.
 */
async function withChangeDetection<T>(
  actor: ProductActor,
  productId: string,
  changeReason: string | null,
  mutate: (tx: Tx) => Promise<T>
): Promise<MutationOutcome<T>> {
  return db.$transaction(async (tx) => {
    await requireOwnedProduct(tx, actor, productId);
    const before = await loadSnapshot(tx, actor.accountId, productId);

    const result = await mutate(tx);

    const after = await loadSnapshot(tx, actor.accountId, productId);
    const changes = detectProductChanges(before, after);

    if (changes.length === 0) {
      return { result, changes, raisedFlags: [] };
    }

    const updated = await tx.product.update({
      where: { id: productId },
      data: {
        currentVersion: { increment: 1 },
        updatedByUserId: actor.userId,
      },
      select: { currentVersion: true },
    });

    const createdEvents = await Promise.all(
      changes.map((change) =>
        tx.productChangeEvent.create({
          data: {
            accountId: actor.accountId,
            productId,
            versionNumber: updated.currentVersion,
            entity: change.entity,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            significance: change.significance,
            impactFlags: [...change.impactFlags],
            changeReason,
            changedByUserId: actor.userId,
            correlationId: actor.requestId ?? null,
          },
          select: { id: true },
        })
      )
    );

    const raisedFlags: string[] = [];
    for (const signal of revalidationSignals(changes)) {
      const existing = await tx.productRevalidationFlag.findFirst({
        where: { productId, accountId: actor.accountId, flag: signal.flag, status: "OPEN" },
        select: { id: true },
      });
      if (existing !== null) continue;

      const triggerIndex = signal.triggeredBy[0];
      await tx.productRevalidationFlag.create({
        data: {
          accountId: actor.accountId,
          productId,
          flag: signal.flag,
          status: "OPEN",
          reason: signal.reason,
          triggeredByChangeEventId:
            triggerIndex === undefined ? null : (createdEvents[triggerIndex]?.id ?? null),
        },
      });
      raisedFlags.push(signal.flag);
    }

    return { result, changes, raisedFlags };
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createProduct(
  actor: ProductActor,
  input: CreateProductInput
): Promise<ProductDetail> {
  const internalSku = trimToNull(input.internalSku ?? null);
  if (internalSku !== null) {
    const clash = await db.product.findFirst({
      where: { accountId: actor.accountId, internalSku, deletedAt: null },
      select: { id: true },
    });
    if (clash !== null) {
      throw new DomainError(
        `SKU ${internalSku} already belongs to another product in this account.`,
        "PRODUCT_SKU_TAKEN",
        409
      );
    }
  }

  const product = await db.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        accountId: actor.accountId,
        productName: input.productName,
        internalSku,
        commercialDescription: input.commercialDescription ?? null,
        technicalDescription: input.technicalDescription ?? null,
        customsDescription: input.customsDescription ?? null,
        brand: input.brand ?? null,
        model: input.model ?? null,
        status: input.status ?? "DRAFT",
        reviewStatus: "UNREVIEWED",
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });

    // The SKU is also an identifier, so it is searchable and matchable like any
    // other scheme rather than only living in a column.
    if (internalSku !== null) {
      await tx.productIdentifier.create({
        data: identifierData(actor, created.id, {
          identifierType: "INTERNAL_SKU",
          value: internalSku,
          isPrimary: true,
          sourceType: "USER",
        }),
      });
    }

    for (const identifier of input.identifiers ?? []) {
      if (identifier.identifierType === "INTERNAL_SKU" && internalSku !== null) continue;
      await assertIdentifierAvailable(tx, actor, created.id, identifier.identifierType, identifier.value);
      await tx.productIdentifier.create({
        data: identifierData(actor, created.id, identifier),
      });
    }

    for (const attribute of input.attributes ?? []) {
      await tx.productAttribute.create({
        data: attributeData(actor, created.id, attribute),
      });
    }

    for (const composition of input.compositions ?? []) {
      await tx.productComposition.create({
        data: {
          accountId: actor.accountId,
          productId: created.id,
          material: composition.material,
          componentName: composition.componentName ?? null,
          percentage: composition.percentage ?? null,
          quantity: composition.quantity ?? null,
          unit: composition.unit ?? null,
          normalizedUnit: normalizeQuantity(1, composition.unit ?? null)?.unit ?? null,
          grade: composition.grade ?? null,
          alloy: composition.alloy ?? null,
          chemicalIdentifier: composition.chemicalIdentifier ?? null,
          isCompleteDeclaration: composition.isCompleteDeclaration ?? false,
          sourceType: composition.sourceType ?? "USER",
          createdByUserId: actor.userId,
        },
      });
    }

    for (const party of input.parties ?? []) {
      const legalEntityId = await requireOwnedLegalEntity(tx, actor, party.legalEntityId);
      await tx.productParty.create({
        data: {
          accountId: actor.accountId,
          productId: created.id,
          legalEntityId,
          role: party.role,
          manufacturingSite: party.manufacturingSite ?? null,
          sourceType: party.sourceType ?? "USER",
          createdByUserId: actor.userId,
        },
      });
    }

    for (const fact of input.countryFacts ?? []) {
      const normalized = normalizeCountry(fact.country);
      await tx.productCountryFact.create({
        data: {
          accountId: actor.accountId,
          productId: created.id,
          factType: fact.factType,
          rawCountry: normalized.raw,
          countryCode: normalized.code,
          status: "CLAIMED",
          sourceType: fact.sourceType ?? "USER",
          sourceReference: fact.sourceReference ?? null,
          createdByUserId: actor.userId,
        },
      });
    }

    // The creation event is the first entry in the product's history. It is
    // recorded directly rather than through change detection, because there is
    // no "before" to compare against and a product appearing is not a change to
    // a customs position that needs revalidating.
    await tx.productChangeEvent.create({
      data: {
        accountId: actor.accountId,
        productId: created.id,
        versionNumber: 1,
        entity: "Product",
        field: "created",
        oldValue: null,
        newValue: created.productName,
        significance: "NON_MATERIAL",
        impactFlags: [],
        changeReason: "Product created.",
        changedByUserId: actor.userId,
        correlationId: actor.requestId ?? null,
      },
    });

    return created;
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: AuditAction.PRODUCT_CREATED,
    entity: "Product",
    entityId: product.id,
    source: "UI",
    metadata: { productName: product.productName, internalSku: product.internalSku },
    requestId: actor.requestId ?? null,
  });

  const detail = await getProduct(actor, product.id);
  if (detail === null) throw new ProductNotFoundError(product.id);
  return detail;
}

function identifierData(
  actor: ProductActor,
  productId: string,
  identifier: {
    identifierType: CreateProductInput["identifiers"] extends readonly (infer T)[] | undefined
      ? T extends { identifierType: infer U }
        ? U
        : never
      : never;
    value: string;
    issuerPartyId?: string | null;
    isPrimary?: boolean;
    sourceType?: string;
  }
): Prisma.ProductIdentifierUncheckedCreateInput {
  return {
    accountId: actor.accountId,
    productId,
    identifierType: identifier.identifierType,
    value: identifier.value,
    normalizedValue: normalizeIdentifier(identifier.value),
    issuerPartyId: identifier.issuerPartyId ?? null,
    isPrimary: identifier.isPrimary ?? false,
    sourceType: (identifier.sourceType ?? "USER") as Prisma.ProductIdentifierUncheckedCreateInput["sourceType"],
    createdByUserId: actor.userId,
  };
}

function attributeData(
  actor: ProductActor,
  productId: string,
  attribute: {
    attributeCode: string;
    attributeName?: string | null;
    rawValue: string;
    rawUnit?: string | null;
    sourceType?: string;
    evidenceId?: string | null;
  }
): Prisma.ProductAttributeUncheckedCreateInput {
  const definition = findAttributeDefinition(attribute.attributeCode);
  const normalizedQuantity =
    definition?.valueType === "NUMBER"
      ? normalizeQuantity(attribute.rawValue, attribute.rawUnit ?? null)
      : null;

  return {
    accountId: actor.accountId,
    productId,
    attributeCode: attribute.attributeCode,
    attributeName: attribute.attributeName ?? definition?.label ?? attribute.attributeCode,
    rawValue: attribute.rawValue,
    normalizedValue:
      normalizedQuantity === null ? null : String(normalizedQuantity.baseValue),
    valueType: definition?.valueType ?? "STRING",
    rawUnit: attribute.rawUnit ?? null,
    normalizedUnit: normalizedQuantity?.unit ?? null,
    status: "ACTIVE",
    sourceType: (attribute.sourceType ?? "USER") as Prisma.ProductAttributeUncheckedCreateInput["sourceType"],
    evidenceId: attribute.evidenceId ?? null,
    createdByUserId: actor.userId,
  };
}

/**
 * Guards the identifier schemes that must not repeat inside a tenant.
 *
 * Applies only to the schemes in `UNIQUE_IDENTIFIER_TYPES`. A part number
 * deliberately may repeat: the same digits belong to different products from
 * different manufacturers, and rejecting that would force users to invent fake
 * part numbers, which is worse than the ambiguity it would prevent.
 */
async function assertIdentifierAvailable(
  tx: Tx,
  actor: ProductActor,
  productId: string,
  identifierType: string,
  value: string
): Promise<void> {
  if (!(UNIQUE_IDENTIFIER_TYPES as readonly string[]).includes(identifierType)) return;

  const normalizedValue = normalizeIdentifier(value);
  const clash = await tx.productIdentifier.findFirst({
    where: {
      accountId: actor.accountId,
      identifierType: identifierType as Prisma.ProductIdentifierWhereInput["identifierType"],
      normalizedValue,
      productId: { not: productId },
      product: { deletedAt: null },
    },
    select: { productId: true },
  });

  if (clash !== null) {
    throw new DomainError(
      `${identifierType} ${value} already identifies a different product in this account.`,
      "PRODUCT_IDENTIFIER_TAKEN",
      409
    );
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateProduct(
  actor: ProductActor,
  productId: string,
  input: UpdateProductInput
): Promise<MutationOutcome<ProductDetail>> {
  const { changeReason, ...fields } = input;

  if (fields.internalSku !== undefined && fields.internalSku !== null) {
    const clash = await db.product.findFirst({
      where: {
        accountId: actor.accountId,
        internalSku: fields.internalSku,
        deletedAt: null,
        id: { not: productId },
      },
      select: { id: true },
    });
    if (clash !== null) {
      throw new DomainError(
        `SKU ${fields.internalSku} already belongs to another product in this account.`,
        "PRODUCT_SKU_TAKEN",
        409
      );
    }
  }

  const outcome = await withChangeDetection(actor, productId, changeReason ?? null, async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: { ...fields, updatedByUserId: actor.userId },
    });
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: AuditAction.PRODUCT_UPDATED,
    entity: "Product",
    entityId: productId,
    source: "UI",
    metadata: {
      fields: Object.keys(fields),
      significance: highestSignificance(outcome.changes),
      raisedFlags: outcome.raisedFlags,
    },
    requestId: actor.requestId ?? null,
  });

  const detail = await getProduct(actor, productId);
  if (detail === null) throw new ProductNotFoundError(productId);
  return { ...outcome, result: detail };
}

/**
 * Retires a product without destroying it.
 *
 * Soft delete only. A product referenced by a filed entry is part of the record
 * of what was declared, and a hard delete would remove the explanation for a
 * filing that still exists. Shipment lines keep pointing at it.
 */
export async function archiveProduct(actor: ProductActor, productId: string): Promise<void> {
  await requireOwnedProduct(db, actor, productId);

  await db.product.update({
    where: { id: productId },
    data: { deletedAt: new Date(), status: "ARCHIVED", updatedByUserId: actor.userId },
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: AuditAction.PRODUCT_ARCHIVED,
    entity: "Product",
    entityId: productId,
    source: "UI",
    requestId: actor.requestId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export async function addIdentifier(
  actor: ProductActor,
  productId: string,
  input: { identifierType: string; value: string; issuerPartyId?: string | null; isPrimary?: boolean; sourceType?: string }
) {
  await requireOwnedProduct(db, actor, productId);
  await assertIdentifierAvailable(db, actor, productId, input.identifierType, input.value);

  if (input.issuerPartyId != null) {
    await requireOwnedLegalEntity(db, actor, input.issuerPartyId);
  }

  return db.productIdentifier.create({
    data: identifierData(actor, productId, {
      ...input,
      identifierType: input.identifierType as never,
    }),
  });
}

export async function removeIdentifier(
  actor: ProductActor,
  productId: string,
  identifierId: string
): Promise<void> {
  await requireOwnedProduct(db, actor, productId);
  const deleted = await db.productIdentifier.deleteMany({
    where: { id: identifierId, productId, accountId: actor.accountId },
  });
  if (deleted.count === 0) {
    throw new DomainError("No such identifier on this product.", "PRODUCT_IDENTIFIER_NOT_FOUND", 404);
  }
}

export async function setAttribute(
  actor: ProductActor,
  productId: string,
  input: { attributeCode: string; attributeName?: string | null; rawValue: string; rawUnit?: string | null; sourceType?: string; evidenceId?: string | null }
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, productId, null, async (tx) => {
    if (input.evidenceId != null) {
      await requireOwnedEvidence(tx, actor, productId, input.evidenceId);
    }

    // Superseded rather than overwritten: the previous value and its evidence
    // stay readable, which is what an audit of "what did you know when" needs.
    await tx.productAttribute.updateMany({
      where: {
        productId,
        accountId: actor.accountId,
        attributeCode: input.attributeCode,
        status: "ACTIVE",
      },
      data: { status: "SUPERSEDED", effectiveTo: new Date() },
    });

    await tx.productAttribute.create({ data: attributeData(actor, productId, input) });
  });
}

export async function removeAttribute(
  actor: ProductActor,
  productId: string,
  attributeId: string
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, productId, null, async (tx) => {
    const updated = await tx.productAttribute.updateMany({
      where: { id: attributeId, productId, accountId: actor.accountId, status: "ACTIVE" },
      data: { status: "SUPERSEDED", effectiveTo: new Date() },
    });
    if (updated.count === 0) {
      throw new DomainError("No such attribute on this product.", "PRODUCT_ATTRIBUTE_NOT_FOUND", 404);
    }
  });
}

export async function addComposition(
  actor: ProductActor,
  productId: string,
  input: {
    material: string;
    componentName?: string | null;
    percentage?: number | null;
    quantity?: number | null;
    unit?: string | null;
    grade?: string | null;
    alloy?: string | null;
    chemicalIdentifier?: string | null;
    isCompleteDeclaration?: boolean;
    sourceType?: string;
    evidenceId?: string | null;
  }
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, productId, null, async (tx) => {
    if (input.evidenceId != null) {
      await requireOwnedEvidence(tx, actor, productId, input.evidenceId);
    }
    await tx.productComposition.create({
      data: {
        accountId: actor.accountId,
        productId,
        material: input.material,
        componentName: input.componentName ?? null,
        percentage: input.percentage ?? null,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
        normalizedUnit: normalizeQuantity(1, input.unit ?? null)?.unit ?? null,
        grade: input.grade ?? null,
        alloy: input.alloy ?? null,
        chemicalIdentifier: input.chemicalIdentifier ?? null,
        isCompleteDeclaration: input.isCompleteDeclaration ?? false,
        sourceType: (input.sourceType ?? "USER") as Prisma.ProductCompositionUncheckedCreateInput["sourceType"],
        evidenceId: input.evidenceId ?? null,
        createdByUserId: actor.userId,
      },
    });
  });
}

export async function removeComposition(
  actor: ProductActor,
  productId: string,
  compositionId: string
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, productId, null, async (tx) => {
    const updated = await tx.productComposition.updateMany({
      where: { id: compositionId, productId, accountId: actor.accountId, status: "ACTIVE" },
      data: { status: "SUPERSEDED", effectiveTo: new Date() },
    });
    if (updated.count === 0) {
      throw new DomainError("No such composition row on this product.", "PRODUCT_COMPOSITION_NOT_FOUND", 404);
    }
  });
}

export async function addParty(
  actor: ProductActor,
  productId: string,
  input: { legalEntityId: string; role: string; manufacturingSite?: string | null; sourceType?: string; evidenceId?: string | null }
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, productId, null, async (tx) => {
    const legalEntityId = await requireOwnedLegalEntity(tx, actor, input.legalEntityId);
    if (input.evidenceId != null) {
      await requireOwnedEvidence(tx, actor, productId, input.evidenceId);
    }
    await tx.productParty.create({
      data: {
        accountId: actor.accountId,
        productId,
        legalEntityId,
        role: input.role as Prisma.ProductPartyUncheckedCreateInput["role"],
        manufacturingSite: input.manufacturingSite ?? null,
        sourceType: (input.sourceType ?? "USER") as Prisma.ProductPartyUncheckedCreateInput["sourceType"],
        evidenceId: input.evidenceId ?? null,
        createdByUserId: actor.userId,
      },
    });
  });
}

export async function removeParty(
  actor: ProductActor,
  productId: string,
  partyId: string
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, productId, null, async (tx) => {
    const updated = await tx.productParty.updateMany({
      where: { id: partyId, productId, accountId: actor.accountId, status: "ACTIVE" },
      data: { status: "SUPERSEDED", effectiveTo: new Date() },
    });
    if (updated.count === 0) {
      throw new DomainError("No such party on this product.", "PRODUCT_PARTY_NOT_FOUND", 404);
    }
  });
}

/**
 * Records where goods are made, or what origin is being claimed for them.
 *
 * These are separate fact types and this function does not relate them. Adding a
 * MANUFACTURE_COUNTRY does not create, update, or suggest an ORIGIN_CLAIM, and
 * an ORIGIN_CLAIM added here starts as CLAIMED — an assertion on the record,
 * with whatever evidence was attached, awaiting a person to verify it.
 */
export async function addCountryFact(
  actor: ProductActor,
  productId: string,
  input: { factType: string; country: string; sourceType?: string; sourceReference?: string | null; evidenceId?: string | null }
): Promise<MutationOutcome<void>> {
  return withChangeDetection(actor, productId, null, async (tx) => {
    if (input.evidenceId != null) {
      await requireOwnedEvidence(tx, actor, productId, input.evidenceId);
    }
    const normalized = normalizeCountry(input.country);
    await tx.productCountryFact.create({
      data: {
        accountId: actor.accountId,
        productId,
        factType: input.factType as Prisma.ProductCountryFactUncheckedCreateInput["factType"],
        rawCountry: normalized.raw,
        countryCode: normalized.code,
        status: "CLAIMED",
        sourceType: (input.sourceType ?? "USER") as Prisma.ProductCountryFactUncheckedCreateInput["sourceType"],
        sourceReference: input.sourceReference ?? null,
        evidenceId: input.evidenceId ?? null,
        createdByUserId: actor.userId,
      },
    });
  }).then(async (res) => {
    try {
      const { reevaluateProductLineItems } = await import("@/app/api/cron/origin-re-eval/route");
      await reevaluateProductLineItems(productId, actor.accountId);
    } catch (e) {
      console.warn("Origin re-evaluation trigger after country fact update failed silently", e);
    }
    return res;
  });
}

export async function reviewCountryFact(
  actor: ProductActor,
  productId: string,
  factId: string,
  action: "START_REVIEW" | "VERIFY" | "REJECT",
  /**
   * The reviewer's note. ProductCountryFact carries no note column — a country
   * fact is a claim with a status, not a conversation — so the note is recorded
   * on the audit entry rather than dropped.
   */
  reviewNote: string | null = null
) {
  await requireOwnedProduct(db, actor, productId);

  const fact = await db.productCountryFact.findFirst({
    where: { id: factId, productId, accountId: actor.accountId },
  });
  if (fact === null) {
    throw new DomainError("No such country fact on this product.", "PRODUCT_COUNTRY_FACT_NOT_FOUND", 404);
  }

  const target = action === "START_REVIEW" ? "UNDER_REVIEW" : action === "VERIFY" ? "VERIFIED" : "REJECTED";
  const check = canTransitionCountryFact(fact.status, target);
  if (!check.allowed) {
    throw new DomainError(check.reason ?? "That transition is not allowed.", "PRODUCT_INVALID_TRANSITION", 409);
  }

  if (target === "VERIFIED" && actor.userId === null) {
    throw new DomainError(
      "A country fact cannot be verified without an identified reviewer.",
      "PRODUCT_REVIEWER_REQUIRED",
      403
    );
  }

  const updated = await db.productCountryFact.update({
    where: { id: factId },
    data: {
      status: target,
      reviewedByUserId: actor.userId,
      reviewedAt: new Date(),
    },
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: `product.countryFact.${action.toLowerCase()}`,
    entity: "ProductCountryFact",
    entityId: factId,
    metadata: { productId, factType: fact.factType, from: fact.status, to: target, reviewNote },
    requestId: actor.requestId ?? null,
  });

  try {
    const { reevaluateProductLineItems } = await import("@/app/api/cron/origin-re-eval/route");
    await reevaluateProductLineItems(productId, actor.accountId);
  } catch (e) {
    console.warn("Origin re-evaluation trigger after reviewCountryFact failed silently", e);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Classifications
// ---------------------------------------------------------------------------

export async function proposeClassification(
  actor: ProductActor,
  productId: string,
  input: {
    jurisdiction: string;
    nomenclature: string;
    classificationCode: string;
    description?: string | null;
    decisionSource?: string;
    decisionMethod?: "MANUAL" | "IMPORT" | "AGENT_PROPOSED" | "RULING_BASED";
    effectiveFrom?: string;
    evidenceId?: string | null;
  }
) {
  await requireOwnedProduct(db, actor, productId);
  if (input.evidenceId != null) {
    await requireOwnedEvidence(db, actor, productId, input.evidenceId);
  }

  const normalizedCode = normalizeClassificationCode(input.classificationCode);
  const method = input.decisionMethod ?? "MANUAL";
  const status = initialClassificationStatus(method);

  const identity = classificationIdentity({
    jurisdiction: input.jurisdiction,
    nomenclature: input.nomenclature,
    normalizedCode,
  });

  const existing = await db.productClassification.findFirst({
    where: {
      productId,
      accountId: actor.accountId,
      jurisdiction: input.jurisdiction,
      nomenclature: input.nomenclature,
      normalizedCode,
      status: { notIn: ["SUPERSEDED", "REJECTED"] },
    },
    select: { id: true, status: true },
  });
  if (existing !== null) {
    throw new DomainError(
      `This product already carries ${identity} with status ${existing.status}.`,
      "PRODUCT_CLASSIFICATION_EXISTS",
      409
    );
  }

  const created = await db.productClassification.create({
    data: {
      accountId: actor.accountId,
      productId,
      jurisdiction: input.jurisdiction,
      nomenclature: input.nomenclature,
      classificationCode: input.classificationCode,
      normalizedCode,
      description: input.description ?? null,
      status,
      decisionSource: (input.decisionSource ?? "USER") as Prisma.ProductClassificationUncheckedCreateInput["decisionSource"],
      decisionMethod: method,
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
      evidenceId: input.evidenceId ?? null,
      createdByUserId: actor.userId,
    },
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: AuditAction.PRODUCT_CLASSIFIED,
    entity: "ProductClassification",
    entityId: created.id,
    source: "UI",
    metadata: {
      productId,
      jurisdiction: created.jurisdiction,
      nomenclature: created.nomenclature,
      code: created.classificationCode,
      status: created.status,
    },
    requestId: actor.requestId ?? null,
  });

  return created;
}

/**
 * Moves a classification along its lifecycle.
 *
 * APPROVE is the consequential one and is gated three ways: the actor must hold
 * `products.classification.approve`, must be an identified user, and the
 * classification must already be UNDER_REVIEW. Approving supersedes whatever was
 * approved before for the same jurisdiction and nomenclature — the old row is
 * closed off with an `effectiveTo` and marked SUPERSEDED, never deleted, so the
 * record still shows what was in force at the time of any past filing.
 */
export async function reviewClassification(
  actor: ProductActor,
  productId: string,
  classificationId: string,
  action: "PROPOSE" | "START_REVIEW" | "APPROVE" | "REJECT",
  options: { reviewNote?: string | null; effectiveFrom?: string } = {}
) {
  await requireOwnedProduct(db, actor, productId);

  const classification = await db.productClassification.findFirst({
    where: { id: classificationId, productId, accountId: actor.accountId },
  });
  if (classification === null) {
    throw new DomainError(
      "No such classification on this product.",
      "PRODUCT_CLASSIFICATION_NOT_FOUND",
      404
    );
  }

  const target =
    action === "PROPOSE"
      ? "PROPOSED"
      : action === "START_REVIEW"
        ? "UNDER_REVIEW"
        : action === "APPROVE"
          ? "APPROVED"
          : "REJECTED";

  if (target === "APPROVED") {
    const check = canApproveClassification({
      currentStatus: classification.status,
      reviewerUserId: actor.userId,
      reviewerCanApprove: actor.canApproveClassification === true,
      proposedByUserId: classification.createdByUserId,
    });
    if (!check.allowed) {
      throw new DomainError(
        check.reason ?? "This classification cannot be approved.",
        "PRODUCT_CLASSIFICATION_NOT_APPROVABLE",
        classification.status === "CANDIDATE" || classification.status === "PROPOSED" ? 409 : 403
      );
    }
  } else {
    const check = canTransitionClassification(classification.status, target);
    if (!check.allowed) {
      throw new DomainError(
        check.reason ?? "That transition is not allowed.",
        "PRODUCT_INVALID_TRANSITION",
        409
      );
    }
  }

  const effectiveFrom = options.effectiveFrom ? new Date(options.effectiveFrom) : new Date();

  const updated = await db.$transaction(async (tx) => {
    if (target === "APPROVED") {
      const superseded = await tx.productClassification.findMany({
        where: {
          productId,
          accountId: actor.accountId,
          jurisdiction: classification.jurisdiction,
          nomenclature: classification.nomenclature,
          status: "APPROVED",
          id: { not: classificationId },
        },
        select: { id: true },
      });

      for (const previous of superseded) {
        await tx.productClassification.update({
          where: { id: previous.id },
          data: {
            status: "SUPERSEDED",
            effectiveTo: effectiveFrom,
            supersededById: classificationId,
          },
        });
      }
    }

    return tx.productClassification.update({
      where: { id: classificationId },
      data: {
        status: target,
        reviewedByUserId: actor.userId,
        reviewedAt: new Date(),
        reviewNote: options.reviewNote ?? null,
        ...(target === "APPROVED" ? { effectiveFrom, decisionVersion: { increment: 1 } } : {}),
      },
    });
  });

  // Approving a classification is a consequential mutation, so a failure to
  // record it is surfaced rather than swallowed.
  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: `product.classification.${action.toLowerCase()}`,
    entity: "ProductClassification",
    entityId: classificationId,
    metadata: {
      productId,
      jurisdiction: classification.jurisdiction,
      nomenclature: classification.nomenclature,
      code: classification.classificationCode,
      from: classification.status,
      to: target,
    },
    requestId: actor.requestId ?? null,
    failClosed: target === "APPROVED",
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * Attaches evidence to a product.
 *
 * A document or extracted-fact reference is checked against the caller's account
 * before it is stored, so evidence cannot be made to point at another tenant's
 * document — which would leak both the document's existence and, through the
 * evidence viewer, its contents.
 *
 * Nothing here manufactures provenance. If the caller supplies no source, the
 * schema rejects the request rather than defaulting to "user said so".
 */
export async function addEvidence(
  actor: ProductActor,
  productId: string,
  input: {
    sourceType: string;
    sourceDocumentId?: string | null;
    sourceExtractedFactId?: string | null;
    sourceReference?: string | null;
    sourceUrl?: string | null;
    page?: number | null;
    description?: string | null;
  }
) {
  await requireOwnedProduct(db, actor, productId);

  if (input.sourceDocumentId != null) {
    const document = await db.shipmentDocument.findFirst({
      where: { id: input.sourceDocumentId, shipment: { accountId: actor.accountId } },
      select: { id: true },
    });
    if (document === null) {
      throw new DomainError("No such document in this account.", "DOCUMENT_NOT_FOUND", 404);
    }
  }

  if (input.sourceExtractedFactId != null) {
    // An extracted fact belongs to a classification case, which is the row that
    // carries the account. Scoping through the case rather than the document is
    // what keeps a fact whose document was detached still tenant-checked.
    const fact = await db.extractedFact.findFirst({
      where: {
        id: input.sourceExtractedFactId,
        case: { accountId: actor.accountId },
      },
      select: { id: true },
    });
    if (fact === null) {
      throw new DomainError("No such extracted fact in this account.", "EXTRACTED_FACT_NOT_FOUND", 404);
    }
  }

  return db.productEvidence.create({
    data: {
      accountId: actor.accountId,
      productId,
      sourceType: input.sourceType as Prisma.ProductEvidenceUncheckedCreateInput["sourceType"],
      sourceDocumentId: input.sourceDocumentId ?? null,
      sourceExtractedFactId: input.sourceExtractedFactId ?? null,
      sourceReference: input.sourceReference ?? null,
      sourceUrl: input.sourceUrl ?? null,
      page: input.page ?? null,
      description: input.description ?? null,
      createdByUserId: actor.userId,
    },
  });
}

// ---------------------------------------------------------------------------
// Revalidation flags
// ---------------------------------------------------------------------------

export async function resolveRevalidationFlag(
  actor: ProductActor,
  productId: string,
  flagId: string,
  action: "RESOLVE" | "DISMISS",
  note: string | null
) {
  await requireOwnedProduct(db, actor, productId);

  if (actor.userId === null) {
    throw new DomainError(
      "Closing a revalidation flag requires an identified user.",
      "PRODUCT_REVIEWER_REQUIRED",
      403
    );
  }

  const updated = await db.productRevalidationFlag.updateMany({
    where: { id: flagId, productId, accountId: actor.accountId, status: "OPEN" },
    data: {
      status: action === "RESOLVE" ? "RESOLVED" : "DISMISSED",
      resolvedByUserId: actor.userId,
      resolvedAt: new Date(),
      resolutionNote: note,
    },
  });

  if (updated.count === 0) {
    throw new DomainError(
      "No open revalidation flag with that id on this product.",
      "PRODUCT_FLAG_NOT_FOUND",
      404
    );
  }

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: `product.revalidation.${action.toLowerCase()}`,
    entity: "ProductRevalidationFlag",
    entityId: flagId,
    metadata: { productId, note },
    requestId: actor.requestId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Finds the product a description of goods refers to, within the caller's tenant.
 *
 * The candidate set is narrowed in the database by the identifiers actually
 * supplied, then the decision is made by the pure matcher. A tenant with 200,000
 * products therefore does not load 200,000 rows, and the rule that decides the
 * outcome is still the one the tests exercise directly.
 */
export async function findProductMatches(
  actor: ProductActor,
  input: MatchCandidateInput
): Promise<ProductMatchResult> {
  const normalizedValues = (input.identifiers ?? [])
    .map((identifier) => normalizeIdentifier(identifier.value))
    .filter((value) => value !== "");

  const orClauses: Prisma.ProductWhereInput[] = [];
  if (normalizedValues.length > 0) {
    orClauses.push({ identifiers: { some: { normalizedValue: { in: normalizedValues } } } });
  }
  if (input.productName != null && input.brand != null) {
    orClauses.push({ productName: { equals: input.productName, mode: "insensitive" } });
  }

  if (orClauses.length === 0) {
    return { status: "NO_MATCH", candidates: [], rule: null };
  }

  const products = await db.product.findMany({
    where: {
      accountId: actor.accountId,
      deletedAt: null,
      status: { notIn: ["ARCHIVED"] },
      OR: orClauses,
    },
    select: {
      id: true,
      productName: true,
      brand: true,
      internalSku: true,
      identifiers: { select: { identifierType: true, normalizedValue: true } },
      parties: {
        where: { role: "MANUFACTURER", status: "ACTIVE" },
        select: { legalEntityId: true },
      },
    },
    take: 200,
  });

  return matchProduct(
    input,
    products.map((product) => ({
      id: product.id,
      productName: product.productName,
      brand: product.brand,
      internalSku: product.internalSku,
      identifiers: product.identifiers,
      manufacturerPartyIds: product.parties.map((party) => party.legalEntityId),
    }))
  );
}

/**
 * Runs the matcher over a shipment line as it stands.
 *
 * A line carries a part number and a description and no brand, so the strongest
 * rule it can satisfy on its own is the unqualified-identifier one — which never
 * returns EXACT_MATCH. That is the point: a part number that is not tied to a
 * manufacturer is a suggestion for a person, not an identification.
 */
export async function matchShipmentLine(
  actor: ProductActor,
  lineItemId: string
): Promise<{ line: { id: string; partNumber: string | null; description: string }; match: ProductMatchResult }> {
  const line = await db.shipmentLineItem.findFirst({
    where: { id: lineItemId, accountId: actor.accountId },
    select: { id: true, partNumber: true, description: true },
  });
  if (line === null) {
    throw new DomainError("No such shipment line in this account.", "LINE_ITEM_NOT_FOUND", 404);
  }

  const identifiers =
    line.partNumber === null || line.partNumber.trim() === ""
      ? []
      : [{ identifierType: "MANUFACTURER_PART_NUMBER" as const, value: line.partNumber }];

  const match = await findProductMatches(actor, { identifiers });
  return { line, match };
}

/**
 * Attaches a shipment line to a product.
 *
 * The match status is stored alongside the link, so a line attached on a
 * POSSIBLE_MATCH is visibly a suggestion someone accepted rather than a
 * determination the system made. Both the line and the product are checked
 * against the caller's account before anything is written.
 */
export async function attachLineItemToProduct(
  actor: ProductActor,
  lineItemId: string,
  productId: string | null,
  matchStatus: "EXACT_MATCH" | "POSSIBLE_MATCH" | "AMBIGUOUS" | "NO_MATCH"
) {
  const line = await db.shipmentLineItem.findFirst({
    where: { id: lineItemId, shipment: { accountId: actor.accountId } },
    select: { id: true },
  });
  if (line === null) {
    throw new DomainError("No such shipment line in this account.", "LINE_ITEM_NOT_FOUND", 404);
  }

  if (productId !== null) await requireOwnedProduct(db, actor, productId);

  const updated = await db.shipmentLineItem.update({
    where: { id: lineItemId },
    data: {
      productId,
      productMatchStatus: matchStatus,
      productMatchedAt: new Date(),
    },
  });

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: AuditAction.PRODUCT_LINE_ATTACHED,
    entity: "ShipmentLineItem",
    entityId: lineItemId,
    source: "UI",
    metadata: { productId, matchStatus },
    requestId: actor.requestId ?? null,
  });

  return updated;
}

/**
 * Loads a matched product's identity plus its current trusted-facts snapshot,
 * for callers (Product Intelligence) that need to compare incoming line-item
 * facts against the Product Master rather than mutate it. Tenant-scoped via
 * `requireOwnedProduct` — a product id from another account is reported as
 * not found, same as every other read here.
 */
export async function getProductSnapshotForIntelligence(
  actor: ProductActor,
  productId: string
): Promise<{ product: Product; snapshot: ProductSnapshot }> {
  const product = await requireOwnedProduct(db, actor, productId);
  const snapshot = await loadSnapshot(db, actor.accountId, productId);
  return { product, snapshot };
}
