import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base || "enterprise-account";
}

export async function POST(req: Request) {
  try {
    const context = await getAccountContext();
    if (!context || !context.isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden: Qubere Platform Admin privileges required" }, { status: 403 });
    }

    const { companyName, ownerEmail } = await req.json();

    if (!companyName || typeof companyName !== "string" || companyName.trim().length === 0) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }

    if (!ownerEmail || typeof ownerEmail !== "string" || !ownerEmail.includes("@")) {
      return NextResponse.json({ error: "Valid owner email is required" }, { status: 400 });
    }

    let baseSlug = generateSlug(companyName);
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
          createdByUserId: context.userId,
        },
      });

      return { account: enterpriseAccount, invitation };
    });

    await createAuditLog({
      accountId: result.account.id,
      userId: context.userId,
      action: "ENTERPRISE_ACCOUNT_CREATED",
      entity: "Account",
      entityId: result.account.id,
      metadata: {
        companyName: result.account.name,
        slug: result.account.slug,
        ownerEmail,
        invitationToken: result.invitation.token,
      },
      success: true,
    });

    return NextResponse.json({ success: true, account: result.account, invitation: result.invitation });
  } catch (error) {
    console.error("Error creating enterprise account:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
