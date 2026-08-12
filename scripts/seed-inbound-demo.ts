/**
 * Idempotent, DB-only seed for the Intelligent Trade Document Inbox demo.
 *
 * Creates, or reuses, exactly what the Part III technical smoke test needs:
 * one demo Account, one admin User (upserted onto your own Clerk identity if
 * DEMO_ADMIN_EMAIL matches an existing User, so you can actually log in and
 * see it), one assignee User, one authorized InboundSenderRoute for the
 * Gmail address the demo email will come from, and one test Shipment to
 * manually assign the emailed document to.
 *
 * Does not touch Clerk. If DEMO_ADMIN_EMAIL has never signed in before,
 * there is no Clerk identity to attach a membership to -- sign in with that
 * email first (getAccountContext() auto-provisions a User row on first
 * login), then re-run this script; it is safe to run repeatedly.
 *
 * Usage:
 *   DEMO_SENDER_EMAIL="jane@gmail.com" DEMO_ADMIN_EMAIL="you@example.com" \
 *     npx tsx scripts/seed-inbound-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import { assertDemoSeedingAllowed } from "../src/lib/environment";
import { normalizeSenderEmail } from "../src/modules/inbound/emailNormalization";

assertDemoSeedingAllowed();

const db = new PrismaClient({ log: ["warn", "error"] });

const DEMO_ACCOUNT_SLUG = "demo-trade-document-inbox";
const DEMO_ASSIGNEE_EMAIL = "jane.demo@qubere-demo.local";

async function main() {
  const senderEmail = process.env.DEMO_SENDER_EMAIL?.trim();
  const adminEmail = process.env.DEMO_ADMIN_EMAIL?.trim();

  if (!senderEmail) {
    console.error("DEMO_SENDER_EMAIL is required (the Gmail address the demo email will come from).");
    process.exit(1);
  }

  console.log(`Seeding demo account "${DEMO_ACCOUNT_SLUG}"...`);

  const account = await db.account.upsert({
    where: { slug: DEMO_ACCOUNT_SLUG },
    update: {},
    create: {
      name: "Qubere Demo — Trade Document Inbox",
      slug: DEMO_ACCOUNT_SLUG,
      type: "ENTERPRISE",
      status: "ACTIVE",
      dataMode: "DEMO",
    },
  });

  // Matches the exact lookup getAccountContext() uses in src/lib/auth.ts --
  // deliberately not filtered on isSystem, since the OWNER row already in
  // this database predates that flag being set consistently.
  const ownerRole = await db.role.findFirst({ where: { accountId: null, name: "OWNER" } });
  if (!ownerRole) {
    throw new Error('System role "OWNER" not found. Run the normal app bootstrap/migrations first.');
  }

  // Demo assignee: a real User row so ShipmentDocument/InboundSenderRoute
  // assignment can point at it, but not wired to a Clerk identity -- it
  // isn't meant to log in, only to be visible as "Assigned to Jane".
  const assignee = await db.user.upsert({
    where: { email: DEMO_ASSIGNEE_EMAIL },
    update: {},
    create: {
      clerkUserId: `demo_${DEMO_ACCOUNT_SLUG}_assignee`,
      email: DEMO_ASSIGNEE_EMAIL,
      firstName: "Jane",
      lastName: "Demo",
    },
  });
  await db.accountMembership.upsert({
    where: { accountId_userId: { accountId: account.id, userId: assignee.id } },
    update: { status: "ACTIVE" },
    create: { accountId: account.id, userId: assignee.id, status: "ACTIVE" },
  });
  await db.accountMembershipRole.upsert({
    where: {
      accountMembershipId_roleId: {
        accountMembershipId: (await db.accountMembership.findFirstOrThrow({
          where: { accountId: account.id, userId: assignee.id },
        })).id,
        roleId: ownerRole.id,
      },
    },
    update: {},
    create: {
      accountMembershipId: (await db.accountMembership.findFirstOrThrow({
        where: { accountId: account.id, userId: assignee.id },
      })).id,
      roleId: ownerRole.id,
    },
  });
  console.log(`  Assignee: ${assignee.email} (${assignee.id})`);

  // Admin: only attached if a User with this email already exists (i.e. you
  // have signed into the app with this identity before). Otherwise this step
  // is skipped -- sign in first, then re-run.
  if (adminEmail) {
    const adminUser = await db.user.findUnique({ where: { email: adminEmail } });
    if (!adminUser) {
      console.warn(
        `  No existing User found for DEMO_ADMIN_EMAIL="${adminEmail}". Sign into the app with that ` +
          `email once (which auto-provisions the User row), then re-run this script to attach it as ` +
          `an OWNER of the demo account.`
      );
    } else {
      await db.accountMembership.upsert({
        where: { accountId_userId: { accountId: account.id, userId: adminUser.id } },
        update: { status: "ACTIVE" },
        create: { accountId: account.id, userId: adminUser.id, status: "ACTIVE" },
      });
      const membership = await db.accountMembership.findFirstOrThrow({
        where: { accountId: account.id, userId: adminUser.id },
      });
      await db.accountMembershipRole.upsert({
        where: { accountMembershipId_roleId: { accountMembershipId: membership.id, roleId: ownerRole.id } },
        update: {},
        create: { accountMembershipId: membership.id, roleId: ownerRole.id },
      });
      console.log(`  Admin: ${adminUser.email} (${adminUser.id}) -- switch to "${account.name}" in the account picker.`);
    }
  } else {
    console.log("  No DEMO_ADMIN_EMAIL provided -- skipping admin membership attachment.");
  }

  // Sender route: the one thing this demo is actually testing.
  const normalizedSenderEmail = normalizeSenderEmail(senderEmail);
  const existingRoute = await db.inboundSenderRoute.findUnique({ where: { normalizedSenderEmail } });
  if (existingRoute && existingRoute.accountId !== account.id) {
    throw new Error(
      `"${normalizedSenderEmail}" is already routed to a different account (${existingRoute.accountId}). ` +
        `Revoke that route first, or use a different sender address.`
    );
  }
  const route = await db.inboundSenderRoute.upsert({
    where: { normalizedSenderEmail },
    update: { status: "ACTIVE", defaultAssignedToUserId: assignee.id },
    create: {
      accountId: account.id,
      normalizedSenderEmail,
      displaySenderEmail: senderEmail,
      defaultAssignedToUserId: assignee.id,
      status: "ACTIVE",
      createdByUserId: assignee.id,
    },
  });
  console.log(`  Sender route: ${route.displaySenderEmail} -> ${assignee.email} (route ${route.id})`);

  // Test shipment to manually assign the emailed document to.
  const shipmentNumber = "DEMO-INBOX-0001";
  const existingShipment = await db.shipment.findFirst({ where: { accountId: account.id, shipmentNumber } });
  const shipment =
    existingShipment ??
    (await db.shipment.create({
      data: {
        accountId: account.id,
        shipmentNumber,
        importerName: "Qubere Demo Importer LLC",
        status: "In Progress",
        assignedBrokerId: assignee.id,
      },
    }));
  console.log(`  Test shipment: ${shipment.shipmentNumber} (${shipment.id})`);

  console.log("\nDone. Send the demo email from", senderEmail, "to your configured inbound address.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
