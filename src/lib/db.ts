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

// Build lookup maps for models with dataMode fields or account relations from Prisma DMMF
const modelsWithDataMode = new Set<string>();
const modelsWithAccountRelation = new Set<string>();

if (Prisma.dmmf?.datamodel?.models) {
  for (const model of Prisma.dmmf.datamodel.models) {
    const fieldNames = new Set(model.fields.map((f) => f.name));
    if (fieldNames.has("dataMode")) {
      modelsWithDataMode.add(model.name);
    }
    if (fieldNames.has("account")) {
      modelsWithAccountRelation.add(model.name);
    }
  }
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
          const { newArgs, effectiveOperation } = buildIsolatedQueryArgs(
            model,
            operation,
            args,
            contextMode
          );

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
