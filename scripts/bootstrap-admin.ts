/**
 * scripts/bootstrap-admin.ts
 *
 * Bootstraps the platform admin for a fresh database deployment.
 *
 * Usage:
 *   PLATFORM_ADMIN_EMAIL=you@company.com npx tsx scripts/bootstrap-admin.ts
 *
 * This script is idempotent — safe to run multiple times.
 * It replaces the insecure "first database user becomes platform admin" pattern
 * that was removed from getAccountContext() (QPR-002).
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;

  if (!adminEmail) {
    console.error(
      "ERROR: PLATFORM_ADMIN_EMAIL environment variable is required.\n" +
        "Usage: PLATFORM_ADMIN_EMAIL=you@company.com npx tsx scripts/bootstrap-admin.ts"
    );
    process.exit(1);
  }

  const user = await db.user.findFirst({
    where: { email: adminEmail.toLowerCase(), deletedAt: null },
  });

  if (!user) {
    console.error(
      `ERROR: No user found with email "${adminEmail}". The user must sign in at least once before bootstrapping admin access.`
    );
    process.exit(1);
  }

  // Upsert the PLATFORM_ADMIN role
  let platformAdminRole = await db.platformRole.findUnique({
    where: { name: "PLATFORM_ADMIN" },
  });
  if (!platformAdminRole) {
    platformAdminRole = await db.platformRole.create({
      data: { name: "PLATFORM_ADMIN", description: "Full Qubere platform admin" },
    });
    console.log("Created PLATFORM_ADMIN role.");
  }

  // Upsert the platform role assignment
  const existing = await db.platformUserRole.findFirst({
    where: { userId: user.id, platformRoleId: platformAdminRole.id },
  });

  if (existing) {
    console.log(`✓ User "${adminEmail}" is already a platform admin. No changes made.`);
  } else {
    await db.platformUserRole.create({
      data: { userId: user.id, platformRoleId: platformAdminRole.id },
    });
    console.log(`✓ Successfully granted PLATFORM_ADMIN to "${adminEmail}" (userId: ${user.id}).`);
  }
}

main()
  .catch((err) => {
    console.error("Bootstrap failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
