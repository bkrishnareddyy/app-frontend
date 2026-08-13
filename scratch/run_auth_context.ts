import { db } from "../src/lib/db";
import { generateSlug, ACTIVE_ACCOUNT_COOKIE } from "../src/lib/auth";

// Mock implementation of loadAccountContext
async function mockLoadAccountContext(clerkUserId: string, userEmail: string, activeAccountIdCookie?: string) {
  try {
    let dbUser = await db.user.findFirst({
      where: {
        OR: [
          { clerkUserId },
          { email: userEmail },
        ],
        deletedAt: null,
      },
      include: {
        platformRoles: {
          include: { platformRole: true },
        },
        memberships: {
          where: { deletedAt: null },
          include: {
            account: true,
            roles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: { permission: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (dbUser && dbUser.clerkUserId !== clerkUserId) {
      dbUser = await db.user.update({
        where: { id: dbUser.id },
        data: { clerkUserId },
        include: {
          platformRoles: {
            include: { platformRole: true },
          },
          memberships: {
            where: { deletedAt: null },
            include: {
              account: true,
              roles: {
                include: {
                  role: {
                    include: {
                      rolePermissions: {
                        include: { permission: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
    }

    if (!dbUser || dbUser.memberships.length === 0) {
      console.log("No dbUser or no memberships found.");
      return null;
    }

    let activeMembership = dbUser.memberships.find(
      (m) => m.accountId === activeAccountIdCookie && m.status === "ACTIVE" && m.account.deletedAt === null
    );

    if (!activeMembership) {
      activeMembership = dbUser.memberships.find(
        (m) => m.status === "ACTIVE" && m.account.deletedAt === null
      );
    }

    if (!activeMembership) {
      console.log("No active membership found.");
      return null;
    }

    const roleIds = activeMembership.roles.map((r) => r.role.id);
    const roleNames = activeMembership.roles.map((r) => r.role.name);
    const permissions = [
      ...new Set(
        activeMembership.roles.flatMap((r) =>
          r.role.rolePermissions.map((rp) => rp.permission.name)
        )
      ),
    ];

    const memberships = dbUser.memberships
      .filter((m) => m.status === "ACTIVE" && m.account.deletedAt === null)
      .map((m) => ({
        accountId: m.accountId,
        accountName: m.account.name,
        accountSlug: m.account.slug,
        accountType: m.account.type,
        roleNames: m.roles.map((r) => r.role.name),
      }));

    const context = {
      userId: dbUser.id,
      clerkUserId,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      isPlatformAdmin: dbUser.platformRoles.some((pr) => pr.platformRole.name === "PLATFORM_ADMIN"),
      platformRoles: dbUser.platformRoles.map((pr) => pr.platformRole.name),
      accountId: activeMembership.accountId,
      accountName: activeMembership.account.name,
      accountSlug: activeMembership.account.slug,
      accountType: activeMembership.account.type,
      dataMode: activeMembership.account.dataMode,
      ownerUserId: activeMembership.account.ownerUserId,
      membershipId: activeMembership.id,
      roleIds,
      roleNames,
      permissions,
      memberships,
      account: {
        id: activeMembership.account.id,
        name: activeMembership.account.name,
        slug: activeMembership.account.slug,
        type: activeMembership.account.type,
        status: activeMembership.account.status,
        ownerUserId: activeMembership.account.ownerUserId,
        createdAt: activeMembership.account.createdAt,
      },
    };

    return context;
  } catch (error) {
    console.error("Error loading account context:", error);
    return null;
  }
}

async function main() {
  console.log("Running mockLoadAccountContext for admin@qubere.ai with activeAccountIdCookie...");
  const ctx = await mockLoadAccountContext("user_3HTRkeKvg2EcUQq9AQSbRLBwpws", "admin@qubere.ai", "cmsph3y020000fxa1vkjxa03e");
  console.log("Context returned:", JSON.stringify(ctx, null, 2));
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
