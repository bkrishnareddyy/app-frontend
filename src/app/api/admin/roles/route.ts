import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { getRolesPermissionsData } from "@/lib/admin/rolesData";
import { PERMISSION_NAMES, SYSTEM_ROLES } from "@/lib/permissions";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const data = await getRolesPermissionsData(ctx);
  return NextResponse.json({ accountName: ctx.accountName, ...data, requestId });
}, { permission: "users.manage" });

const createRoleSchema = z.object({
  name: z
    .string()
    .min(2, "Role name must be at least 2 characters")
    .max(50, "Role name must be at most 50 characters")
    .regex(/^[A-Za-z0-9_\- ]+$/, "Role name may only contain letters, numbers, spaces, hyphens, and underscores"),
  description: z.string().max(255).optional(),
  // Initial permission set — empty starts the role with no permissions.
  permissions: z.array(z.string()).default([]),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createRoleSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { name, description, permissions } = bodyVal.data;

  // System role names are reserved globally.
  const upperName = name.toUpperCase();
  if ((SYSTEM_ROLES as readonly string[]).includes(upperName)) {
    return buildErrorResponse(
      409,
      "RESERVED_ROLE_NAME",
      `"${name}" is a reserved system role name. Choose a different name.`,
      undefined,
      requestId
    );
  }

  // Name must be unique within this account.
  const existing = await db.role.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, accountId: ctx.accountId },
  });
  if (existing) {
    return buildErrorResponse(409, "ROLE_EXISTS", `A custom role named "${name}" already exists.`, undefined, requestId);
  }

  // Validate every permission string is in the catalogue.
  const invalidPerms = permissions.filter((p) => !(PERMISSION_NAMES as readonly string[]).includes(p));
  if (invalidPerms.length > 0) {
    return buildErrorResponse(
      400,
      "INVALID_PERMISSIONS",
      `Unknown permissions: ${invalidPerms.join(", ")}`,
      undefined,
      requestId
    );
  }

  // Resolve Permission rows — must already exist in the DB (synced by the admin).
  const permissionRows = await db.permission.findMany({ where: { name: { in: permissions } } });
  const missingInDb = permissions.filter((p) => !permissionRows.find((r) => r.name === p));
  if (missingInDb.length > 0) {
    return buildErrorResponse(
      400,
      "PERMISSIONS_NOT_SEEDED",
      `Permissions not yet seeded: ${missingInDb.join(", ")}. Run the permissions sync first.`,
      undefined,
      requestId
    );
  }

  const role = await db.role.create({
    data: {
      name,
      description: description ?? null,
      accountId: ctx.accountId,
      isSystem: false,
      rolePermissions: {
        create: permissionRows.map((p) => ({ permissionId: p.id })),
      },
    },
    include: { rolePermissions: { include: { permission: true } } },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "ROLE_CREATED",
    entity: "Role",
    entityId: role.id,
    metadata: { name, permissions },
    success: true,
  });

  return NextResponse.json(
    {
      success: true,
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: role.rolePermissions.map((rp) => rp.permission.name),
      },
      requestId,
    },
    { status: 201 }
  );
}, { permission: "roles.manage" });

const patchRoleSchema = z.object({
  roleId: z.string().min(1),
  permissions: z.array(z.string()).min(0),
});

export const PATCH = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, patchRoleSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { roleId, permissions } = bodyVal.data;

  const role = await db.role.findFirst({
    where: { id: roleId, accountId: ctx.accountId, isSystem: false },
  });
  if (!role) {
    return buildErrorResponse(404, "NOT_FOUND", "Custom role not found", undefined, requestId);
  }

  const invalidPerms = permissions.filter((p) => !(PERMISSION_NAMES as readonly string[]).includes(p));
  if (invalidPerms.length > 0) {
    return buildErrorResponse(400, "INVALID_PERMISSIONS", `Unknown permissions: ${invalidPerms.join(", ")}`, undefined, requestId);
  }

  const permissionRows = await db.permission.findMany({ where: { name: { in: permissions } } });

  await db.$transaction([
    db.rolePermission.deleteMany({ where: { roleId } }),
    db.rolePermission.createMany({
      data: permissionRows.map((p) => ({ roleId, permissionId: p.id })),
    }),
  ]);

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "ROLE_PERMISSIONS_UPDATED",
    entity: "Role",
    entityId: roleId,
    metadata: { permissions },
    success: true,
  });

  return NextResponse.json({ success: true, requestId });
}, { permission: "roles.manage" });
