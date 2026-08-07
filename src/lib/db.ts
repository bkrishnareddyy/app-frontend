import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Sanitizes and optimizes PostgreSQL connection string for Serverless / Supabase Pooler environments.
 * If Supabase pooler is configured with port 5432 (Session Mode with 15 client limit),
 * this automatically patches the URL to port 6543 (Transaction Mode) and appends pgbouncer flags.
 */
function getDatasourceUrl(): string | undefined {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return undefined;

  // Check if string points to Supabase pooler on port 5432 (Session Mode)
  if (dbUrl.includes("pooler.supabase.com:5432")) {
    let patched = dbUrl.replace("pooler.supabase.com:5432", "pooler.supabase.com:6543");
    if (!patched.includes("pgbouncer=true")) {
      patched += (patched.includes("?") ? "&" : "?") + "pgbouncer=true&connection_limit=10&pool_timeout=15";
    }
    return patched;
  }

  // If pgbouncer/transaction pooler URL doesn't have connection_limit set, append reasonable defaults
  if (dbUrl.includes(":6543") && !dbUrl.includes("connection_limit")) {
    return dbUrl + (dbUrl.includes("?") ? "&" : "?") + "pgbouncer=true&connection_limit=10&pool_timeout=15";
  }

  return dbUrl;
}

const configuredUrl = getDatasourceUrl();

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: configuredUrl,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

// Always attach to globalThis in both development and serverless production to reuse active connection pool
globalForPrisma.prisma = db;
