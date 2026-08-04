import { PrismaClient } from "@prisma/client";
import { createClerkClient } from "@clerk/backend";

const prisma = new PrismaClient();
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const clerkClient = clerkSecretKey && !clerkSecretKey.startsWith("sk_test_mock")
  ? createClerkClient({ secretKey: clerkSecretKey })
  : null;

async function main() {
  console.log("Seeding PostgreSQL application database with 10 test users and syncing Clerk User IDs...");

  // 1. Seed Platform Roles
  const platformRolesData = [
    { name: "PLATFORM_ADMIN", description: "Full Qubere platform administration access" },
    { name: "CUSTOMER_SUPPORT", description: "Customer support access for account assistance" },
    { name: "BILLING_ADMIN", description: "Platform billing administration" },
    { name: "SECURITY_ADMIN", description: "Security audit and compliance management" },
  ];

  const platformRolesMap = new Map<string, string>();
  for (const pRole of platformRolesData) {
    const created = await prisma.platformRole.upsert({
      where: { name: pRole.name },
      update: { description: pRole.description },
      create: pRole,
    });
    platformRolesMap.set(pRole.name, created.id);
  }

  // 2. Seed System Permissions
  const permissionsData = [
    { name: "account.manage", description: "Manage account details, billing, and ownership" },
    { name: "users.manage", description: "Manage account members, roles, and invitations" },
    { name: "documents.create", description: "Create trade compliance documents" },
    { name: "documents.read", description: "Read trade compliance documents" },
    { name: "account.create", description: "Platform admin: Create enterprise accounts" },
    { name: "account.view_all", description: "Platform admin: View all platform accounts" },
  ];

  const permissionsMap = new Map<string, string>();
  for (const perm of permissionsData) {
    const createdPerm = await prisma.permission.upsert({
      where: { name: perm.name },
      update: { description: perm.description },
      create: perm,
    });
    permissionsMap.set(perm.name, createdPerm.id);
  }

  // 3. Seed System Roles
  const rolesData = [
    {
      name: "OWNER",
      description: "Highest customer permission with full account management and ownership rights",
      isSystem: true,
      permissions: ["account.manage", "users.manage", "documents.create", "documents.read"],
    },
    {
      name: "ADMIN",
      description: "User management and operational access without ownership transfer rights",
      isSystem: true,
      permissions: ["users.manage", "documents.create", "documents.read"],
    },
    {
      name: "MEMBER",
      description: "Standard member with document creation and reading capabilities",
      isSystem: true,
      permissions: ["documents.create", "documents.read"],
    },
    {
      name: "VIEWER",
      description: "Read-only access to account resources",
      isSystem: true,
      permissions: ["documents.read"],
    },
  ];

  const rolesMap = new Map<string, string>();
  for (const roleData of rolesData) {
    let role = await prisma.role.findFirst({
      where: { name: roleData.name, accountId: null },
    });

    if (!role) {
      role = await prisma.role.create({
        data: {
          name: roleData.name,
          description: roleData.description,
          isSystem: true,
          accountId: null,
        },
      });
    }

    rolesMap.set(roleData.name, role.id);

    for (const permName of roleData.permissions) {
      const permId = permissionsMap.get(permName);
      if (permId) {
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permId,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId: permId,
          },
        });
      }
    }
  }

  // 4. Seed Accounts
  const acmeCorp = await prisma.account.upsert({
    where: { slug: "acme-corporation" },
    update: {},
    create: {
      name: "Acme Corporation",
      slug: "acme-corporation",
      type: "ENTERPRISE",
      status: "ACTIVE",
    },
  });

  const globalTrade = await prisma.account.upsert({
    where: { slug: "global-trade-logistics" },
    update: {},
    create: {
      name: "Global Trade Logistics",
      slug: "global-trade-logistics",
      type: "ENTERPRISE",
      status: "ACTIVE",
    },
  });

  // 5. Seed 10 Users and fetch Clerk User IDs
  const usersToSeed = [
    {
      email: "admin@qubere.ai",
      firstName: "Platform",
      lastName: "Admin",
      isPlatformAdmin: true,
      accounts: [{ accountId: acmeCorp.id, roleName: "OWNER" }],
    },
    {
      email: "owner.acme@qubere.ai",
      firstName: "Alice",
      lastName: "AcmeOwner",
      isPlatformAdmin: false,
      accounts: [{ accountId: acmeCorp.id, roleName: "OWNER" }],
    },
    {
      email: "admin.acme@qubere.ai",
      firstName: "Bob",
      lastName: "AcmeAdmin",
      isPlatformAdmin: false,
      accounts: [{ accountId: acmeCorp.id, roleName: "ADMIN" }],
    },
    {
      email: "member.acme@qubere.ai",
      firstName: "Charlie",
      lastName: "AcmeMember",
      isPlatformAdmin: false,
      accounts: [{ accountId: acmeCorp.id, roleName: "MEMBER" }],
    },
    {
      email: "viewer.acme@qubere.ai",
      firstName: "David",
      lastName: "AcmeViewer",
      isPlatformAdmin: false,
      accounts: [{ accountId: acmeCorp.id, roleName: "VIEWER" }],
    },
    {
      email: "owner.global@qubere.ai",
      firstName: "Elena",
      lastName: "GlobalOwner",
      isPlatformAdmin: false,
      accounts: [{ accountId: globalTrade.id, roleName: "OWNER" }],
    },
    {
      email: "multirole@qubere.ai",
      firstName: "Frank",
      lastName: "MultiAccountUser",
      isPlatformAdmin: false,
      accounts: [
        { accountId: acmeCorp.id, roleName: "MEMBER" },
        { accountId: globalTrade.id, roleName: "ADMIN" },
      ],
    },
    {
      email: "rachit@qubere.ai",
      firstName: "Rachit",
      lastName: "Lohani",
      isPlatformAdmin: false,
      isIndividual: true,
      workspaceName: "Rachit's Workspace",
    },
    {
      email: "sarah@qubere.ai",
      firstName: "Sarah",
      lastName: "Jones",
      isPlatformAdmin: false,
      isIndividual: true,
      workspaceName: "Sarah's Workspace",
    },
    {
      email: "mike@qubere.ai",
      firstName: "Mike",
      lastName: "Brown",
      isPlatformAdmin: false,
      isIndividual: true,
      workspaceName: "Mike's Workspace",
    },
  ];

  for (const uData of usersToSeed) {
    let clerkUserId = `user_seed_${uData.email.split("@")[0]}`;

    if (clerkClient) {
      try {
        const clerkUsers = await clerkClient.users.getUserList({ emailAddress: [uData.email] });
        if (clerkUsers.data.length > 0) {
          clerkUserId = clerkUsers.data[0].id;
        }
      } catch (err) {
        console.warn(`Could not fetch Clerk ID for ${uData.email}, using fallback.`);
      }
    }

    const user = await prisma.user.upsert({
      where: { email: uData.email },
      update: {
        clerkUserId,
        firstName: uData.firstName,
        lastName: uData.lastName,
      },
      create: {
        email: uData.email,
        clerkUserId,
        firstName: uData.firstName,
        lastName: uData.lastName,
      },
    });

    if (uData.isPlatformAdmin) {
      const pAdminRoleId = platformRolesMap.get("PLATFORM_ADMIN");
      if (pAdminRoleId) {
        await prisma.platformUserRole.upsert({
          where: {
            userId_platformRoleId: {
              userId: user.id,
              platformRoleId: pAdminRoleId,
            },
          },
          update: {},
          create: {
            userId: user.id,
            platformRoleId: pAdminRoleId,
          },
        });
      }
    }

    if (uData.accounts) {
      for (const acc of uData.accounts) {
        const roleId = rolesMap.get(acc.roleName);
        if (roleId) {
          await prisma.accountMembership.upsert({
            where: {
              accountId_userId: {
                accountId: acc.accountId,
                userId: user.id,
              },
            },
            update: { roleId },
            create: {
              accountId: acc.accountId,
              userId: user.id,
              roleId,
              status: "ACTIVE",
            },
          });
        }
      }
    }

    if (uData.isIndividual && uData.workspaceName) {
      const slug = uData.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const indAccount = await prisma.account.upsert({
        where: { slug },
        update: {},
        create: {
          name: uData.workspaceName,
          slug,
          type: "INDIVIDUAL",
          status: "ACTIVE",
          ownerUserId: user.id,
        },
      });

      const ownerRoleId = rolesMap.get("OWNER");
      if (ownerRoleId) {
        await prisma.accountMembership.upsert({
          where: {
            accountId_userId: {
              accountId: indAccount.id,
              userId: user.id,
            },
          },
          update: {},
          create: {
            accountId: indAccount.id,
            userId: user.id,
            roleId: ownerRoleId,
            status: "ACTIVE",
          },
        });
      }
    }
  }

  console.log("Successfully seeded 10 test users and synced Clerk User IDs with PostgreSQL!");
}

main()
  .catch((e) => {
    console.error("Error seeding test users:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
