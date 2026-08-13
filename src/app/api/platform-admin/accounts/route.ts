import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base || "enterprise-account";
}

// Requires the isPlatformAdmin flag specifically, not the OWNER-role wildcard
// that authorizeRequest's `permission` option grants — handled manually here
// rather than via `permission`, which would incorrectly admit account OWNERs.
export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json({ error: "Forbidden: Qubere Platform Admin privileges required" });
  }

  const { companyName, ownerEmail } = await req.json();

  if (!companyName || typeof companyName !== "string" || companyName.trim().length === 0) {
    return NextResponse.json({ error: "Company name is required" }, { status: 400 });
  }

  if (!ownerEmail || typeof ownerEmail !== "string" || !ownerEmail.includes("@")) {
    return NextResponse.json({ error: "Valid owner email is required" }, { status: 400 });
  }

  const baseSlug = generateSlug(companyName);
  let slug = baseSlug;
  let counter = 1;
  while (await db.account.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  let ownerRole = await db.role.findFirst({
    where: { name: "OWNER", accountId: null },
});
  if (!ownerRole) {
    ownerRole = await db.role.create({
      data: { name: "OWNER", description: "Account Owner", isSystem: true },
    });
  }

  // Create Enterprise Account and Invitation
  const result = await db.$transaction(async (tx) => {
    const enterpriseAccount = await tx.account.create({
      data: {
        name: companyName.trim(),
        slug,
        type: "ENTERPRISE",
        status: "ACTIVE",
      },
    });

    const invitation = await tx.invitation.create({
      data: {
        accountId: enterpriseAccount.id,
        email: ownerEmail.trim().toLowerCase(),
        roleId: ownerRole.id,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        createdByUserId: ctx.userId,
      },
    });

    return { account: enterpriseAccount, invitation };
  });

  await createAuditLog({
    accountId: result.account.id,
    userId: ctx.userId,
    action: "ENTERPRISE_ACCOUNT_CREATED",
    entity: "Account",
    entityId: result.account.id,
    source: "UI",
    metadata: {
      companyName: result.account.name,
      slug: result.account.slug,
      ownerEmail,
      invitationToken: "[REDACTED]",
    },
    success: true,
  });

  // token is destructured off so the raw invitation token never reaches the response body.
  const { token, ...invitationSafe } = result.invitation;
  return NextResponse.json({ success: true, account: result.account, invitation: invitationSafe });

}, { permission: "account.manage", write: true });
