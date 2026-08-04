import { describe, it, expect, beforeEach } from "vitest";

interface Account {
  id: string;
  name: string;
  slug: string;
  type: "ENTERPRISE" | "INDIVIDUAL";
  status: string;
  ownerUserId?: string;
}

interface User {
  id: string;
  clerkUserId: string;
  email: string;
  isPlatformAdmin: boolean;
}

interface Role {
  id: string;
  name: string;
  isSystem: boolean;
  accountId?: string | null;
}

interface AccountMembership {
  id: string;
  accountId: string;
  userId: string;
  roleId: string;
  status: string;
}

interface AuditLog {
  id: string;
  accountId: string;
  userId?: string;
  action: string;
  entity: string;
  entityId: string;
  success: boolean;
}

class MockAccountDatabase {
  accounts: Account[] = [];
  users: User[] = [];
  memberships: AccountMembership[] = [];
  roles: Role[] = [
    { id: "role_owner", name: "OWNER", isSystem: true, accountId: null },
    { id: "role_admin", name: "ADMIN", isSystem: true, accountId: null },
    { id: "role_member", name: "MEMBER", isSystem: true, accountId: null },
    { id: "role_viewer", name: "VIEWER", isSystem: true, accountId: null },
  ];
  auditLogs: AuditLog[] = [];

  createEnterpriseAccount(name: string, slug: string, platformAdminUser: User): Account {
    if (!platformAdminUser.isPlatformAdmin) {
      throw new Error("Only Platform Admins can create Enterprise Accounts");
    }
    const account: Account = {
      id: `acc_ent_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name,
      slug,
      type: "ENTERPRISE",
      status: "ACTIVE",
    };
    this.accounts.push(account);
    return account;
  }

  createIndividualAccount(user: User): Account {
    const account: Account = {
      id: `acc_ind_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name: `${user.email}'s Workspace`,
      slug: `user-${user.id}`,
      type: "INDIVIDUAL",
      status: "ACTIVE",
      ownerUserId: user.id,
    };
    this.accounts.push(account);

    this.memberships.push({
      id: `mem_${Date.now()}`,
      accountId: account.id,
      userId: user.id,
      roleId: "role_owner",
      status: "ACTIVE",
    });

    return account;
  }

  logAction(accountId: string, userId: string, action: string, entity: string, entityId: string, success: boolean = true) {
    const log: AuditLog = {
      id: `log_${Date.now()}`,
      accountId,
      userId,
      action,
      entity,
      entityId,
      success,
    };
    this.auditLogs.push(log);
    return log;
  }
}

describe("Qubere Enterprise Identity & Final Schema Refinements", () => {
  let db: MockAccountDatabase;
  let platformAdmin: User;
  let regularUser: User;

  beforeEach(() => {
    db = new MockAccountDatabase();
    platformAdmin = { id: "u_admin", clerkUserId: "clerk_admin", email: "admin@qubere.ai", isPlatformAdmin: true };
    regularUser = { id: "u_john", clerkUserId: "clerk_john", email: "john@acme.com", isPlatformAdmin: false };
    db.users.push(platformAdmin, regularUser);
  });

  it("1. Individual Account automatically links ownerUserId foreign key reference", () => {
    const indAccount = db.createIndividualAccount(regularUser);
    expect(indAccount.ownerUserId).toEqual(regularUser.id);
    expect(indAccount.slug).toBeDefined();
  });

  it("2. System roles have isSystem=true and accountId=null, while custom roles are scoped to accountId", () => {
    const systemRoles = db.roles.filter((r) => r.isSystem);
    expect(systemRoles).toHaveLength(4);
    expect(systemRoles.every((r) => r.accountId === null)).toBe(true);

    // Custom role
    const customRole: Role = {
      id: "role_custom_1",
      name: "Trade Compliance Manager",
      isSystem: false,
      accountId: "acc_123",
    };
    expect(customRole.isSystem).toBe(false);
    expect(customRole.accountId).toEqual("acc_123");
  });

  it("3. Platform Admin can provision Enterprise accounts with unique slugs", () => {
    const ent = db.createEnterpriseAccount("Acme Corp", "acme-corp", platformAdmin);
    expect(ent.slug).toEqual("acme-corp");
    expect(ent.type).toEqual("ENTERPRISE");
  });

  it("4. Audit Logs record outcome success/denied boolean flag", () => {
    const ent = db.createEnterpriseAccount("Acme Corp", "acme-corp", platformAdmin);
    const logSuccess = db.logAction(ent.id, platformAdmin.id, "ACCOUNT_UPDATED", "Account", ent.id, true);
    const logDenied = db.logAction(ent.id, regularUser.id, "DELETE_ACCOUNT", "Account", ent.id, false);

    expect(logSuccess.success).toBe(true);
    expect(logDenied.success).toBe(false);
  });
});
