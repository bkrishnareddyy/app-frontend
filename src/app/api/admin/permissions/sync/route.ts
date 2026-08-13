import { NextResponse } from "next/server";
import { authorizeWrite } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId, errorMessage } from "@/lib/api/error";
import { createAuditLog } from "@/lib/audit";
import {
  databasePermissionSyncStore,
  syncPermissionCatalogue,
} from "@/modules/admin/permissionSync";

/**
 * Creates the Permission rows the code already gates on, and grants each system
 * role its defaults.
 *
 * This is a POST because it writes. The admin screen that reports the catalogue
 * gap is a GET and reports only; a read that repaired itself would hide the fact
 * that the account was ever missing its permissions.
 */
export async function POST() {
  const requestId = generateRequestId();
  // account.manage is held by OWNER, and hasPermission() lets an OWNER through
  // before any Permission row exists. That is what makes bootstrapping possible.
  const { ctx, errorResponse } = await authorizeWrite("account.manage");
  if (errorResponse) return errorResponse;

  try {
    const result = await syncPermissionCatalogue(databasePermissionSyncStore);

    await createAuditLog({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
      action: "permissions.sync",
      entity: "Permission",
      entityId: "catalogue",
      source: "UI",
      metadata: {
        permissionsCreated: result.permissionsCreated,
        grantsAdded: result.grantsAdded.map((g) => `${g.roleName}:${g.permission}`),
        rolesMissing: result.rolesMissing,
      },
      failClosed: true,
    });

    return NextResponse.json({ result, requestId });
  } catch (error: unknown) {
    return buildErrorResponse(
      500,
      "SYNC_FAILED",
      errorMessage(error) || "The permission catalogue could not be synced.",
      undefined,
      requestId
    );
  }
}
