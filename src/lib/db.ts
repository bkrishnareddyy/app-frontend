import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Default interactive-transaction timeout (5s) is too tight for
    // multi-step writes over a high-latency connection to a remote/shared
    // database; widen it rather than trimming transactions to fit.
    transactionOptions: { maxWait: 15000, timeout: 30000 },
  });

// Reuse across HMR reloads in dev and across serverless invocations in prod
globalForPrisma.prisma = db;
