import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { db } from "./db";
import type { DataMode } from "./dataMode";

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
  dataMode: DataMode;
  ownerUserId?: string | null;
  membershipId: string;
  // A membership can hold multiple simultaneous roles (e.g. Admin + Agent) --
  // roleIds/roleNames are always arrays, never a single value. `permissions`
  // is the union of every assigned role's permissions.
  roleIds: string[];
  roleNames: string[]; // e.g. ["OWNER"], or ["ADMIN", "AGENT"], or custom role names
  permissions: string[];
  memberships: Array<{
    accountId: string;
    accountName: string;
    accountSlug: string;
    accountType: string;
    roleNames: string[];
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

    // Self-Service Onboarding for brand new users.
    // SECURITY NOTE: Invitation acceptance is NOT handled here (QPR-002).
    // Invitations are accepted explicitly via /invite/[token] page only.
    // This keeps getAccountContext() side-effect-free.
    if (!dbUser && clerkUser) {
      const email = userEmail ?? `${clerkUserId}@example.com`;
      const firstName = clerkUser.firstName ?? "User";
      const lastName = clerkUser.lastName ?? "";

      let ownerRole = await db.role.findFirst({
        where: { name: "OWNER", accountId: null },
      });
      if (!ownerRole) {
        ownerRole = await db.role.create({
          data: { name: "OWNER", description: "Account Owner", isSystem: true },
        });
      }

      const accountName = firstName ? `${firstName}'s Workspace` : "Personal Workspace";
      const baseSlug = generateSlug(accountName);
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
              status: "ACTIVE",
              roles: {
                create: { roleId: ownerRole.id },
              },
            },
          },
        },
        include: {
          platformRoles: { include: { platformRole: true } },
          memberships: {
            include: {
              account: true,
              roles: {
                include: {
                  role: {
                    include: {
                      rolePermissions: { include: { permission: true } },
                    },
                  },
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

      // SECURITY: Platform admin is bootstrapped only via PLATFORM_ADMIN_EMAIL env var
      // (scripts/bootstrap-admin.ts), not by being the first database user.
      // The old "first user = platform admin" pattern is intentionally removed (QPR-002).

      dbUser = await db.user.findFirst({
        where: { id: dbUser.id },
        include: {
          platformRoles: { include: { platformRole: true } },
          memberships: {
            where: { deletedAt: null },
            include: {
              account: true,
              roles: {
                include: {
                  role: {
                    include: {
                      rolePermissions: { include: { permission: true } },
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
      return null;
    }

    const cookieStore = await cookies();
    const activeAccountIdCookie = cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value;

    let activeMembership = dbUser.memberships.find(
      (m) => m.accountId === activeAccountIdCookie && m.status === "ACTIVE" && m.account.deletedAt === null
    );

    if (!activeMembership) {
      // No fallback to memberships[0]: that granted access through a membership
      // whose status was INACTIVE or DISABLED, since only the account was checked below.
      activeMembership = dbUser.memberships.find(
        (m) => m.status === "ACTIVE" && m.account.deletedAt === null
      );
    }

    if (
      !activeMembership ||
      activeMembership.status !== "ACTIVE" ||
      activeMembership.account.status !== "ACTIVE" ||
      activeMembership.account.deletedAt !== null
    ) {
      return null;
    }

    // Union of permissions across every role assigned to this membership,
    // deduplicated.
    const permissions = Array.from(
      new Set(
        activeMembership.roles.flatMap((mr) => mr.role.rolePermissions.map((rp) => rp.permission.name))
      )
    );
    const roleIds = activeMembership.roles.map((mr) => mr.roleId);
    const roleNames = activeMembership.roles.map((mr) => mr.role.name);

    const platformRoleNames = dbUser.platformRoles.map((pr) => pr.platformRole.name);
    const isPlatformAdmin = platformRoleNames.includes("PLATFORM_ADMIN");

    const allMemberships = dbUser.memberships
      .filter((m) => m.status === "ACTIVE" && m.account.deletedAt === null)
      .map((m) => ({
        accountId: m.account.id,
        accountName: m.account.name,
        accountSlug: m.account.slug,
        accountType: m.account.type,
        roleNames: m.roles.map((mr) => mr.role.name),
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
      dataMode: activeMembership.account.dataMode,
      ownerUserId: activeMembership.account.ownerUserId,
      membershipId: activeMembership.id,
      roleIds,
      roleNames,
      permissions,
      memberships: allMemberships,
      account: activeMembership.account,
    };
  } catch (error: unknown) {
    if (
      (error instanceof Error && error.message.includes("DYNAMIC_SERVER_USAGE")) ||
      (typeof error === "object" && error !== null && "digest" in error && (error as Record<string, unknown>).digest === "DYNAMIC_SERVER_USAGE")
    ) {
      throw error;
    }
    console.error("Error retrieving account context:", error);
    return null;
  }
}

export async function hasPermission(requiredPermission: string): Promise<boolean> {
  const context = await getAccountContext();
  if (!context) return false;
  if (context.isPlatformAdmin) return true;
  // Account OWNER has wildcard management access, if held among the
  // membership's assigned roles
  if (context.roleNames.includes("OWNER")) return true;
  return context.permissions.includes(requiredPermission);
}
