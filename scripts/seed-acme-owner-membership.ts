import { db } from "../src/lib/db";

const EMAIL = "owner.acme@qubere.ai";
const ACCOUNT_NAME = "Acme Corporation";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  const user = await db.user.findFirst({ where: { email: EMAIL, deletedAt: null } });
  if (!user) {
    console.error(`No User row for ${EMAIL} yet -- sign in once first so the app auto-provisions the user record, then re-run this script.`);
    process.exit(1);
  }

  let account = await db.account.findFirst({ where: { name: ACCOUNT_NAME, type: "ENTERPRISE" } });
  if (!account) {
    account = await db.account.create({
      data: { name: ACCOUNT_NAME, slug: `${slugify(ACCOUNT_NAME)}-${Date.now()}`, type: "ENTERPRISE", status: "ACTIVE" },
    });
    console.log(`Created ENTERPRISE account "${ACCOUNT_NAME}" (${account.id})`);
  } else {
    console.log(`Found existing ENTERPRISE account "${ACCOUNT_NAME}" (${account.id})`);
  }

  let ownerRole = await db.role.findFirst({ where: { accountId: account.id, name: "OWNER" } });
  if (!ownerRole) {
    ownerRole = await db.role.create({
      data: { accountId: account.id, name: "OWNER", description: "Account owner", isSystem: true },
    });
    console.log(`Created OWNER role for ${ACCOUNT_NAME}`);
  }

  let membership = await db.accountMembership.findFirst({ where: { accountId: account.id, userId: user.id } });
  if (!membership) {
    membership = await db.accountMembership.create({
      data: { accountId: account.id, userId: user.id, status: "ACTIVE" },
    });
    console.log(`Created AccountMembership linking ${EMAIL} to ${ACCOUNT_NAME}`);
  }

  const hasOwnerRole = await db.accountMembershipRole.findFirst({
    where: { accountMembershipId: membership.id, roleId: ownerRole.id },
  });
  if (!hasOwnerRole) {
    await db.accountMembershipRole.create({
      data: { accountMembershipId: membership.id, roleId: ownerRole.id },
    });
    console.log(`Granted OWNER role on ${ACCOUNT_NAME} to ${EMAIL}`);
  } else {
    console.log(`${EMAIL} already holds OWNER on ${ACCOUNT_NAME} -- nothing to do.`);
  }

  if (!account.ownerUserId) {
    await db.account.update({ where: { id: account.id }, data: { ownerUserId: user.id } });
  }

  console.log("Done. Refresh the app and use the account switcher to select Acme Corporation.");
}

main().catch(console.error).finally(() => db.$disconnect());
