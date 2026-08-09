import { PrismaClient } from "@prisma/client";
import { createClerkClient } from "@clerk/backend";
import * as dotenv from "dotenv";

dotenv.config();

const db = new PrismaClient();
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!clerkSecretKey || clerkSecretKey.startsWith("sk_test_mock")) {
  console.error("Error: Valid CLERK_SECRET_KEY is required in .env file.");
  process.exit(1);
}

const clerkClient = createClerkClient({ secretKey: clerkSecretKey });
const defaultPassword = "QuberePass2026!";

const targetUsers = [
  { email: "joe@target.com", firstName: "Joe", lastName: "TargetAdmin", roleName: "ADMIN" },
  { email: "anna@target.com", firstName: "Anna", lastName: "TargetAdmin", roleName: "ADMIN" },
  { email: "sarah@target.com", firstName: "Sarah", lastName: "TargetPlanner", roleName: "PLANNER" },
  { email: "romeo@target.com", firstName: "Romeo", lastName: "TargetPlanner", roleName: "PLANNER" },
  { email: "eva@target.com", firstName: "Eva", lastName: "TargetPlanner", roleName: "PLANNER" },
];

function generateSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

async function main() {
  console.log("🚀 Starting seeding of Target.com accounts in Clerk and Database...");

  // 1. Get or create Target account
  let targetAccount = await db.account.findFirst({
    where: { name: "Target", type: "ENTERPRISE" }
  });

  if (!targetAccount) {
    targetAccount = await db.account.create({
      data: {
        name: "Target",
        slug: generateSlug("Target") + "-" + Date.now(),
        type: "ENTERPRISE",
        status: "ACTIVE",
      }
    });
    console.log(`✅ Created Target account: ${targetAccount.id}`);
  } else {
    console.log(`ℹ️ Found existing Target account: ${targetAccount.id}`);
  }

  // 2. Fetch permissions (required for role mapping)
  const pDocsCreate = await db.permission.upsert({
    where: { name: "documents.create" },
    update: {},
    create: { name: "documents.create", description: "Upload Trade Documents" },
  });
  const pFilingTransmit = await db.permission.upsert({
    where: { name: "filings.submit" },
    update: {},
    create: { name: "filings.submit", description: "Transmit Customs Filing" },
  });
  const pIntelRead = await db.permission.upsert({
    where: { name: "intel.read" },
    update: {},
    create: { name: "intel.read", description: "Access Regulatory Intel" },
  });

  // 3. Get or create ADMIN and PLANNER roles scoped to Target account
  let adminRole = await db.role.findFirst({
    where: { name: "ADMIN", accountId: targetAccount.id }
  });
  if (!adminRole) {
    adminRole = await db.role.create({
      data: {
        name: "ADMIN",
        accountId: targetAccount.id,
        description: "Admin with all permissions",
        rolePermissions: {
          create: [
            { permissionId: pDocsCreate.id },
            { permissionId: pFilingTransmit.id },
            { permissionId: pIntelRead.id },
          ],
        },
      },
    });
    console.log("✅ Created ADMIN role for Target account");
  }

  let plannerRole = await db.role.findFirst({
    where: { name: "PLANNER", accountId: targetAccount.id }
  });
  if (!plannerRole) {
    plannerRole = await db.role.create({
      data: {
        name: "PLANNER",
        accountId: targetAccount.id,
        description: "Planner with limited permissions",
        rolePermissions: {
          create: [
            { permissionId: pDocsCreate.id },
          ],
        },
      },
    });
    console.log("✅ Created PLANNER role for Target account");
  }

  // 4. Create in Clerk and Upsert/Connect in database
  for (const tu of targetUsers) {
    console.log(`\nProcessing ${tu.email}...`);
    let clerkUserId = "";

    try {
      // Check Clerk
      const clerkResult = await clerkClient.users.getUserList({ emailAddress: [tu.email] });
      if (clerkResult.data.length > 0) {
        clerkUserId = clerkResult.data[0].id;
        console.log(`- Clerk user already exists: ${clerkUserId}`);
      } else {
        const newUser = await clerkClient.users.createUser({
          emailAddress: [tu.email],
          password: defaultPassword,
          firstName: tu.firstName,
          lastName: tu.lastName,
          skipPasswordChecks: true,
          skipPasswordRequirement: false,
        });
        clerkUserId = newUser.id;
        console.log(`- Created in Clerk: ${clerkUserId}`);
      }

      // Upsert user in database
      const dbUser = await db.user.upsert({
        where: { email: tu.email },
        update: { clerkUserId },
        create: {
          email: tu.email,
          firstName: tu.firstName,
          lastName: tu.lastName,
          clerkUserId,
        }
      });
      console.log(`- Database user synced: ${dbUser.id}`);

      // Upsert membership
      const targetRoleId = tu.roleName === "ADMIN" ? adminRole.id : plannerRole.id;
      const membership = await db.accountMembership.findFirst({
        where: { accountId: targetAccount.id, userId: dbUser.id }
      });

      if (membership) {
        await db.accountMembership.update({
          where: { id: membership.id },
          data: { roleId: targetRoleId, status: "ACTIVE", deletedAt: null }
        });
        console.log(`- Updated membership to role: ${tu.roleName}`);
      } else {
        await db.accountMembership.create({
          data: {
            accountId: targetAccount.id,
            userId: dbUser.id,
            roleId: targetRoleId,
            status: "ACTIVE",
          }
        });
        console.log(`- Created new membership to role: ${tu.roleName}`);
      }
    } catch (err) {
      console.error(`❌ Failed to process ${tu.email}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\n✨ Done seeding Target.com accounts!");
}

main().catch(console.error).finally(() => db.$disconnect());
