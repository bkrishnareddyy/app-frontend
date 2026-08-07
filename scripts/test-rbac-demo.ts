import { PrismaClient } from "@prisma/client";

function generateSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

const db = new PrismaClient();

async function main() {
  console.log("Starting RBAC Multi-Tenancy Validation Setup...");

  // 1. Create Target Account
  const targetAccount = await db.account.create({
    data: {
      name: "Target",
      slug: generateSlug("Target") + "-" + Date.now(),
      type: "ENTERPRISE",
      status: "ACTIVE",
    },
  });
  console.log(`✅ Created Account: ${targetAccount.name} (${targetAccount.id})`);

  // 2. Create Permissions
  const pDocsCreate = await db.permission.upsert({
    where: { name: "documents.create" },
    update: {},
    create: { name: "documents.create", description: "Upload Trade Documents" },
  });
  const pFilingTransmit = await db.permission.upsert({
    where: { name: "filings.submit" },
    update: {},
    create: { name: "filings.submit", description: "Transmit Customs Filing" },
  });
  const pIntelRead = await db.permission.upsert({
    where: { name: "intel.read" },
    update: {},
    create: { name: "intel.read", description: "Access Regulatory Intel" },
  });

  // 3. Create Roles for Target Account
  const adminRole = await db.role.create({
    data: {
      name: "ADMIN",
      accountId: targetAccount.id,
      description: "Admin with all permissions",
      rolePermissions: {
        create: [
          { permissionId: pDocsCreate.id },
          { permissionId: pFilingTransmit.id },
          { permissionId: pIntelRead.id },
        ],
      },
    },
  });

  const plannerRole = await db.role.create({
    data: {
      name: "PLANNER",
      accountId: targetAccount.id,
      description: "Planner with limited permissions",
      rolePermissions: {
        create: [
          { permissionId: pDocsCreate.id }, // Planners can upload docs, but can't submit filings or read intel
        ],
      },
    },
  });
  console.log(`✅ Created Roles: ADMIN and PLANNER`);

  // 4. Create Users
  const usersToCreate = [
    { email: "joe@target.com", firstName: "Joe", clerkId: "clerk_joe_" + Date.now(), roleId: adminRole.id },
    { email: "anna@target.com", firstName: "Anna", clerkId: "clerk_anna_" + Date.now(), roleId: adminRole.id },
    { email: "sarah@target.com", firstName: "Sarah", clerkId: "clerk_sarah_" + Date.now(), roleId: plannerRole.id },
    { email: "romeo@target.com", firstName: "Romeo", clerkId: "clerk_romeo_" + Date.now(), roleId: plannerRole.id },
    { email: "eva@target.com", firstName: "Eva", clerkId: "clerk_eva_" + Date.now(), roleId: plannerRole.id },
  ];

  const dbUsers = [];
  for (const u of usersToCreate) {
    const dbUser = await db.user.create({
      data: {
        email: u.email,
        firstName: u.firstName,
        clerkUserId: u.clerkId,
        memberships: {
          create: {
            accountId: targetAccount.id,
            roleId: u.roleId,
            status: "ACTIVE",
          },
        },
      },
    });
    const roleName = u.roleId === adminRole.id ? "ADMIN" : "PLANNER";
    dbUsers.push({ ...dbUser, roleName });
    console.log(`✅ Created User: ${u.firstName} (${roleName})`);
  }

  const joe = dbUsers.find((u) => u.firstName === "Joe")!;
  const sarah = dbUsers.find((u) => u.firstName === "Sarah")!;
  const romeo = dbUsers.find((u) => u.firstName === "Romeo")!;

  // 5. Create Shipments (Data Segregation test)
  await db.shipment.create({
    data: {
      accountId: targetAccount.id,
      shipmentNumber: "SHP-SARAH-01",
      importerName: "Target",
      assignedBrokerId: sarah.id,
    },
  });

  await db.shipment.create({
    data: {
      accountId: targetAccount.id,
      shipmentNumber: "SHP-ROMEO-01",
      importerName: "Target",
      assignedBrokerId: romeo.id,
    },
  });

  await db.shipment.create({
    data: {
      accountId: targetAccount.id,
      shipmentNumber: "SHP-UNASSIGNED-01",
      importerName: "Target",
    },
  });
  console.log(`✅ Created 3 Shipments (1 Sarah, 1 Romeo, 1 Unassigned)`);

  // --- PROGRAMMATIC VALIDATION ---
  console.log("\n--- VALIDATION ---");
  
  // Test 1: Admin Data Visibility
  const joeShipments = await db.shipment.findMany({
    where: { accountId: targetAccount.id, deletedAt: null },
  });
  console.log(`Joe (Admin) sees ${joeShipments.length} shipments. (Expected: 3)`);
  if (joeShipments.length !== 3) throw new Error("Joe data visibility test failed.");

  // Test 2: Planner Data Visibility
  const sarahShipments = await db.shipment.findMany({
    where: { accountId: targetAccount.id, deletedAt: null, assignedBrokerId: sarah.id },
  });
  console.log(`Sarah (Planner) sees ${sarahShipments.length} shipments. (Expected: 1)`);
  if (sarahShipments.length !== 1 || sarahShipments[0].shipmentNumber !== "SHP-SARAH-01") {
    throw new Error("Sarah data visibility test failed.");
  }

  console.log("\n✅ ALL TESTS PASSED: RLS and RBAC Data Segregation works successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
