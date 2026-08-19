import { PrismaClient, Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import type { DataMode } from "./dataMode";

const dataModeStorage = new AsyncLocalStorage<{ mode: DataMode | null }>();

/**
 * Execute a function within an explicit DataMode context.
 * If mode is null, dataMode query isolation is bypassed (e.g. for cross-tenant platform administration).
 */
export function runWithDataMode<T>(mode: DataMode | null | undefined, fn: () => T): T {
  if (!mode && mode !== null) {
    return fn();
  }
  return dataModeStorage.run({ mode }, fn);
}

/**
 * Async wrapper for runWithDataMode.
 */
export function withDataModeContext<T>(mode: DataMode | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (!mode && mode !== null) {
    return fn();
  }
  return dataModeStorage.run({ mode }, fn);
}

/**
 * Retrieve the current active DataMode context (undefined if no context has been explicitly set).
 */
export function getDataModeContext(): DataMode | null | undefined {
  return dataModeStorage.getStore()?.mode;
}

const accountIdStorage = new AsyncLocalStorage<{ accountId: string | null }>();

/**
 * Execute a function within an explicit tenant (accountId) context. Unlike DataMode,
 * there is no sensible default tenant -- an undefined accountId bypasses isolation
 * entirely (e.g. cron/background jobs with no single-tenant scope), and an explicit
 * null is a deliberate cross-tenant opt-out (e.g. platform admin operations).
 */
export function runWithAccountId<T>(accountId: string | null | undefined, fn: () => T): T {
  if (accountId === undefined) {
    return fn();
  }
  return accountIdStorage.run({ accountId }, fn);
}

/**
 * Async wrapper for runWithAccountId.
 */
export function withAccountIdContext<T>(accountId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (accountId === undefined) {
    return fn();
  }
  return accountIdStorage.run({ accountId }, fn);
}

/**
 * Retrieve the current active tenant (accountId) context (undefined if no context
 * has been explicitly set).
 */
export function getAccountIdContext(): string | null | undefined {
  return accountIdStorage.getStore()?.accountId;
}

// Build lookup maps for models with dataMode fields or account relations from Prisma DMMF
const modelsWithDataMode = new Set<string>();
const modelsWithAccountRelation = new Set<string>();
// Tenant-isolation injection only targets models with a REQUIRED accountId field --
// the 4 nullable-accountId models (e.g. Role, which has global system roles with
// accountId: null) are deliberately excluded: auto-injecting accountId there would
// silently exclude legitimate global rows from queries that intentionally span both.
const modelsWithRequiredAccountId = new Set<string>();

if (Prisma.dmmf?.datamodel?.models) {
  for (const model of Prisma.dmmf.datamodel.models) {
    const fieldNames = new Set(model.fields.map((f) => f.name));
    if (fieldNames.has("dataMode")) {
      modelsWithDataMode.add(model.name);
    }
    if (fieldNames.has("account")) {
      modelsWithAccountRelation.add(model.name);
    }
    const accountIdField = model.fields.find((f) => f.name === "accountId");
    if (accountIdField && accountIdField.isRequired) {
      modelsWithRequiredAccountId.add(model.name);
    }
  }
}

// Actions eligible for tenant-isolation injection. Wider than DataMode's set --
// it also covers singular update/delete/upsert, since a cross-tenant write is a
// more severe failure mode than a cross-tenant read. Extended-where-unique-input
// (confirmed on this Prisma version) allows a plain scalar accountId filter
// alongside the required unique selector for update/delete/upsert, so no
// findUnique-style demotion is needed here.
const TENANT_INTERCEPTED_ACTIONS = [
  "findMany",
  "findFirst",
  "findUnique",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
  "update",
  "delete",
  "upsert",
];

export function buildTenantIsolatedQueryArgs(
  model: string,
  operation: string,
  args: any,
  contextAccountId: string | null | undefined
): any {
  if (!TENANT_INTERCEPTED_ACTIONS.includes(operation)) {
    return args;
  }

  // No context (undefined) or an explicit cross-tenant opt-out (null) bypasses isolation.
  if (contextAccountId === undefined || contextAccountId === null) {
    return args;
  }

  if (!modelsWithRequiredAccountId.has(model)) {
    return args;
  }

  const queryArgs = args || {};
  const where = (queryArgs as any).where || {};

  // Caller already specified an accountId filter (including an explicit null,
  // relevant for the nullable models this function otherwise skips) -- leave it alone.
  if (where.accountId !== undefined) {
    return args;
  }

  return {
    ...queryArgs,
    where: {
      ...where,
      accountId: contextAccountId,
    },
  };
}

const INTERCEPTED_ACTIONS = [
  "findMany",
  "findFirst",
  "findUnique",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
];

export function buildIsolatedQueryArgs(
  model: string,
  operation: string,
  args: any,
  contextMode: DataMode | null | undefined
): { newArgs: any; effectiveOperation: string } {
  if (!INTERCEPTED_ACTIONS.includes(operation)) {
    return { newArgs: args, effectiveOperation: operation };
  }

  // Explicit null context bypasses isolation
  if (contextMode === null) {
    return { newArgs: args, effectiveOperation: operation };
  }

  const targetMode: DataMode = contextMode ?? "PRODUCTION";
  const queryArgs = args || {};
  const where = (queryArgs as any).where || {};

  const hasExplicitDataMode =
    where.dataMode !== undefined ||
    (where.account &&
      typeof where.account === "object" &&
      where.account !== null &&
      where.account.dataMode !== undefined);

  if (hasExplicitDataMode) {
    return { newArgs: args, effectiveOperation: operation };
  }

  const hasDataModeField = modelsWithDataMode.has(model);
  const hasAccountRel = modelsWithAccountRelation.has(model);

  if (!hasDataModeField && !hasAccountRel) {
    return { newArgs: args, effectiveOperation: operation };
  }

  const newArgs: any = { ...queryArgs };
  let effectiveOperation = operation;

  if (hasDataModeField) {
    newArgs.where = {
      ...where,
      dataMode: targetMode,
    };
    if (operation === "findUnique") {
      effectiveOperation = "findFirst";
    }
  } else if (hasAccountRel) {
    const existingAccount =
      typeof where.account === "object" && where.account !== null ? where.account : {};
    newArgs.where = {
      ...where,
      account: {
        ...existingAccount,
        dataMode: targetMode,
      },
    };
    if (operation === "findUnique") {
      effectiveOperation = "findFirst";
    }
  }

  return { newArgs, effectiveOperation };
}

export const rawDb = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  transactionOptions: { maxWait: 15000, timeout: 30000 },
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = (globalForPrisma.prisma ??
  rawDb.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const contextMode = getDataModeContext();
          const { newArgs: dataModeArgs, effectiveOperation } = buildIsolatedQueryArgs(
            model,
            operation,
            args,
            contextMode
          );

          const contextAccountId = getAccountIdContext();
          const newArgs = buildTenantIsolatedQueryArgs(model, operation, dataModeArgs, contextAccountId);

          if (effectiveOperation === "findFirst" && operation === "findUnique") {
            const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
            const delegate = (rawDb as any)[modelKey];
            if (delegate && typeof delegate.findFirst === "function") {
              return delegate.findFirst(newArgs);
            }
          }

          return query(newArgs);
        },
      },
    },
  })) as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
