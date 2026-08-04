import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { db } from "./db";

export interface AccountContext {
  userId: string;
  clerkUserId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  isPlatformAdmin: boolean;
  platformRoles: string[];
  accountId: string;
  accountName: string;
  accountSlug: string;
  accountType: "ENTERPRISE" | "INDIVIDUAL" | string;
  ownerUserId?: string | null;
  membershipId: string;
  roleId: string;
  roleName: string; // OWNER, ADMIN, MEMBER, VIEWER, or custom
  permissions: string[];
  memberships: Array<{
    accountId: string;
    accountName: string;
    accountSlug: string;
    accountType: string;
    roleName: string;
  }>;
  account: {
    id: string;
    name: string;
    slug: string;
    type: string;
    status: string;
    ownerUserId?: string | null;
    createdAt: Date;
  };
}

export const ACTIVE_ACCOUNT_COOKIE = "qubere_active_account_id";

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base || "workspace";
}

export async function getAccountContext(): Promise<AccountContext | null> {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return null;
    }

    const clerkUser = await currentUser();
    const userEmail = clerkUser?.emailAddresses[0]?.emailAddress?.toLowerCase();

    // Query user by clerkUserId OR email address
    let dbUser = await db.user.findFirst({
      where: {
        OR: [
          { clerkUserId },
          ...(userEmail ? [{ email: userEmail }] : []),
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
    });

    // If user was found by email, sync current clerkUserId
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
      });
    }

    // Self-Service Onboarding & Invitation Processing for brand new users
    if (!dbUser && clerkUser) {
      const email = userEmail ?? `${clerkUserId}@example.com`;
      const firstName = clerkUser.firstName ?? "User";
      const lastName = clerkUser.lastName ?? "";

      const pendingInvitations = await db.invitation.findMany({
        where: { email: email.toLowerCase(), status: "PENDING" },
        include: { account: true, role: true },
      });

      let ownerRole = await db.role.findFirst({
        where: { name: "OWNER", accountId: null },
      });
      if (!ownerRole) {
        ownerRole = await db.role.create({
          data: { name: "OWNER", description: "Account Owner" },
        });
      }

      const totalUsers = await db.user.count({ where: { deletedAt: null } });
      const isFirstUser = totalUsers === 0;

      if (pendingInvitations.length > 0) {
        dbUser = await db.user.create({
          data: {
            clerkUserId,
            email: email.toLowerCase(),
            firstName,
            lastName,
          },
          include: {
            platformRoles: { include: { platformRole: true } },
            memberships: {
              include: {
                account: true,
                role: {
                  include: {
                    rolePermissions: { include: { permission: true } },
                  },
                },
              },
            },
          },
        });

        for (const inv of pendingInvitations) {
          await db.accountMembership.create({
            data: {
              accountId: inv.accountId,
              userId: dbUser.id,
              roleId: inv.roleId,
              status: "ACTIVE",
            },
          });
          await db.invitation.update({
            where: { id: inv.id },
            data: { status: "ACCEPTED" },
          });
        }
      } else {
        const accountName = firstName ? `${firstName}'s Workspace` : "Personal Workspace";
        let baseSlug = generateSlug(accountName);
        let slug = baseSlug;
        let counter = 1;
        while (await db.account.findUnique({ where: { slug } })) {
          slug = `${baseSlug}-${counter}`;
          counter++;
        }

        const individualAccount = await db.account.create({
          data: {
            name: accountName,
            slug,
            type: "INDIVIDUAL",
            status: "ACTIVE",
          },
        });

        dbUser = await db.user.create({
          data: {
            clerkUserId,
            email: email.toLowerCase(),
            firstName,
            lastName,
            memberships: {
              create: {
                accountId: individualAccount.id,
                roleId: ownerRole.id,
                status: "ACTIVE",
              },
            },
          },
          include: {
            platformRoles: { include: { platformRole: true } },
            memberships: {
              include: {
                account: true,
                role: {
                  include: {
                    rolePermissions: { include: { permission: true } },
                  },
                },
              },
            },
          },
        });

        await db.account.update({
          where: { id: individualAccount.id },
          data: { ownerUserId: dbUser.id },
        });
      }

      if (isFirstUser && dbUser) {
        let platformAdminRole = await db.platformRole.findUnique({ where: { name: "PLATFORM_ADMIN" } });
        if (!platformAdminRole) {
          platformAdminRole = await db.platformRole.create({
            data: { name: "PLATFORM_ADMIN", description: "Full Qubere platform admin" },
          });
        }
        await db.platformUserRole.create({
          data: {
            userId: dbUser.id,
            platformRoleId: platformAdminRole.id,
          },
        });
      }

      dbUser = await db.user.findFirst({
        where: { id: dbUser.id },
        include: {
          platformRoles: { include: { platformRole: true } },
          memberships: {
            where: { deletedAt: null },
            include: {
              account: true,
              role: {
                include: {
                  rolePermissions: { include: { permission: true } },
                },
              },
            },
          },
        },
      });
    }

    if (!dbUser || dbUser.memberships.length === 0) {
      return null;
    }

    const cookieStore = await cookies();
    const activeAccountIdCookie = cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value;

    let activeMembership = dbUser.memberships.find(
      (m) => m.accountId === activeAccountIdCookie && m.status === "ACTIVE" && m.account.deletedAt === null
    );

    if (!activeMembership) {
      activeMembership =
        dbUser.memberships.find((m) => m.status === "ACTIVE" && m.account.deletedAt === null) ||
        dbUser.memberships[0];
    }

    if (!activeMembership || activeMembership.account.status !== "ACTIVE" || activeMembership.account.deletedAt !== null) {
      return null;
    }

    const permissions = activeMembership.role.rolePermissions.map((rp) => rp.permission.name);

    const platformRoleNames = dbUser.platformRoles.map((pr) => pr.platformRole.name);
    const isPlatformAdmin = platformRoleNames.includes("PLATFORM_ADMIN");

    const allMemberships = dbUser.memberships
      .filter((m) => m.status === "ACTIVE" && m.account.deletedAt === null)
      .map((m) => ({
        accountId: m.account.id,
        accountName: m.account.name,
        accountSlug: m.account.slug,
        accountType: m.account.type,
        roleName: m.role.name,
      }));

    return {
      userId: dbUser.id,
      clerkUserId: dbUser.clerkUserId,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      isPlatformAdmin,
      platformRoles: platformRoleNames,
      accountId: activeMembership.account.id,
      accountName: activeMembership.account.name,
      accountSlug: activeMembership.account.slug,
      accountType: activeMembership.account.type,
      ownerUserId: activeMembership.account.ownerUserId,
      membershipId: activeMembership.id,
      roleId: activeMembership.roleId,
      roleName: activeMembership.role.name,
      permissions,
      memberships: allMemberships,
      account: activeMembership.account,
    };
  } catch (error: any) {
    if (error?.digest === "DYNAMIC_SERVER_USAGE" || error?.message?.includes("DYNAMIC_SERVER_USAGE")) {
      throw error;
    }
    console.error("Error retrieving account context:", error);
    return null;
  }
}

export async function hasPermission(requiredPermission: string): Promise<boolean> {
  const context = await getAccountContext();
  if (!context) return false;
  if (context.isPlatformAdmin || context.roleName === "OWNER" || context.roleName === "ADMIN") return true;
  return context.permissions.includes(requiredPermission);
}
