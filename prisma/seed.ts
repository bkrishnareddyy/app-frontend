import { PrismaClient } from "@prisma/client";
import { createClerkClient } from "@clerk/backend";

const prisma = new PrismaClient();
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const clerkClient = clerkSecretKey && !clerkSecretKey.startsWith("sk_test_mock")
  ? createClerkClient({ secretKey: clerkSecretKey })
  : null;

async function main() {
  console.log("Seeding PostgreSQL application database with 10 test users, shipments, decisions, filings & regulatory updates...");

  // 1. Seed Platform Roles
  const platformRolesData = [
    { name: "PLATFORM_ADMIN", description: "Full Qubere platform administration access" },
    { name: "CUSTOMER_SUPPORT", description: "Customer support access for account assistance" },
    { name: "BILLING_ADMIN", description: "Platform billing administration" },
    { name: "SECURITY_ADMIN", description: "Security audit and compliance management" },
  ];

  const platformRolesMap = new Map<string, string>();
  for (const pRole of platformRolesData) {
    const created = await prisma.platformRole.upsert({
      where: { name: pRole.name },
      update: { description: pRole.description },
      create: pRole,
    });
    platformRolesMap.set(pRole.name, created.id);
  }

  // 2. Seed System Permissions
  const permissionsData = [
    { name: "account.manage", description: "Manage account details, billing, and ownership" },
    { name: "users.manage", description: "Manage account members, roles, and invitations" },
    { name: "documents.create", description: "Create trade compliance documents" },
    { name: "documents.read", description: "Read trade compliance documents" },
    { name: "account.create", description: "Platform admin: Create enterprise accounts" },
    { name: "account.view_all", description: "Platform admin: View all platform accounts" },
  ];

  const permissionsMap = new Map<string, string>();
  for (const perm of permissionsData) {
    const createdPerm = await prisma.permission.upsert({
      where: { name: perm.name },
      update: { description: perm.description },
      create: perm,
    });
    permissionsMap.set(perm.name, createdPerm.id);
  }

  // 3. Seed System Roles
  const rolesData = [
    {
      name: "OWNER",
      description: "Highest customer permission with full account management and ownership rights",
      isSystem: true,
      permissions: ["account.manage", "users.manage", "documents.create", "documents.read"],
    },
    {
      name: "ADMIN",
      description: "User management and operational access without ownership transfer rights",
      isSystem: true,
      permissions: ["users.manage", "documents.create", "documents.read"],
    },
    {
      name: "MEMBER",
      description: "Standard member with document creation and reading capabilities",
      isSystem: true,
      permissions: ["documents.create", "documents.read"],
    },
    {
      name: "VIEWER",
      description: "Read-only access to account resources",
      isSystem: true,
      permissions: ["documents.read"],
    },
  ];

  const rolesMap = new Map<string, string>();
  for (const roleData of rolesData) {
    let role = await prisma.role.findFirst({
      where: { name: roleData.name, accountId: null },
    });

    if (!role) {
      role = await prisma.role.create({
        data: {
          name: roleData.name,
          description: roleData.description,
          isSystem: true,
          accountId: null,
        },
      });
    }

    rolesMap.set(roleData.name, role.id);

    for (const permName of roleData.permissions) {
      const permId = permissionsMap.get(permName);
      if (permId) {
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permId,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId: permId,
          },
        });
      }
    }
  }

  // 4. Seed Accounts
  const acmeCorp = await prisma.account.upsert({
    where: { slug: "acme-corporation" },
    update: {},
    create: {
      name: "Acme Corporation",
      slug: "acme-corporation",
      type: "ENTERPRISE",
      status: "ACTIVE",
    },
  });

  const globalTrade = await prisma.account.upsert({
    where: { slug: "global-trade-logistics" },
    update: {},
    create: {
      name: "Global Trade Logistics",
      slug: "global-trade-logistics",
      type: "ENTERPRISE",
      status: "ACTIVE",
    },
  });

  // 5. Seed 10 Users and fetch Clerk User IDs
  const usersToSeed = [
    {
      email: "admin@qubere.ai",
      firstName: "Platform",
      lastName: "Admin",
      isPlatformAdmin: true,
      accounts: [{ accountId: acmeCorp.id, roleName: "OWNER" }],
    },
    {
      email: "owner.acme@qubere.ai",
      firstName: "Alice",
      lastName: "AcmeOwner",
      isPlatformAdmin: false,
      accounts: [{ accountId: acmeCorp.id, roleName: "OWNER" }],
    },
    {
      email: "admin.acme@qubere.ai",
      firstName: "Bob",
      lastName: "AcmeAdmin",
      isPlatformAdmin: false,
      accounts: [{ accountId: acmeCorp.id, roleName: "ADMIN" }],
    },
    {
      email: "member.acme@qubere.ai",
      firstName: "Charlie",
      lastName: "AcmeMember",
      isPlatformAdmin: false,
      accounts: [{ accountId: acmeCorp.id, roleName: "MEMBER" }],
    },
    {
      email: "viewer.acme@qubere.ai",
      firstName: "David",
      lastName: "AcmeViewer",
      isPlatformAdmin: false,
      accounts: [{ accountId: acmeCorp.id, roleName: "VIEWER" }],
    },
    {
      email: "owner.global@qubere.ai",
      firstName: "Elena",
      lastName: "GlobalOwner",
      isPlatformAdmin: false,
      accounts: [{ accountId: globalTrade.id, roleName: "OWNER" }],
    },
    {
      email: "multirole@qubere.ai",
      firstName: "Frank",
      lastName: "MultiAccountUser",
      isPlatformAdmin: false,
      accounts: [
        { accountId: acmeCorp.id, roleName: "MEMBER" },
        { accountId: globalTrade.id, roleName: "ADMIN" },
      ],
    },
    {
      email: "rachit@qubere.ai",
      firstName: "Rachit",
      lastName: "Lohani",
      isPlatformAdmin: false,
      isIndividual: true,
      workspaceName: "Rachit's Workspace",
    },
    {
      email: "sarah@qubere.ai",
      firstName: "Sarah",
      lastName: "Jones",
      isPlatformAdmin: false,
      isIndividual: true,
      workspaceName: "Sarah's Workspace",
    },
    {
      email: "mike@qubere.ai",
      firstName: "Mike",
      lastName: "Brown",
      isPlatformAdmin: false,
      isIndividual: true,
      workspaceName: "Mike's Workspace",
    },
  ];

  for (const uData of usersToSeed) {
    let clerkUserId = `user_seed_${uData.email.split("@")[0]}`;

    if (clerkClient) {
      try {
        const clerkUsers = await clerkClient.users.getUserList({ emailAddress: [uData.email] });
        if (clerkUsers.data.length > 0) {
          clerkUserId = clerkUsers.data[0].id;
        }
      } catch (err) {
        console.warn(`Could not fetch Clerk ID for ${uData.email}, using fallback.`);
      }
    }

    const user = await prisma.user.upsert({
      where: { email: uData.email },
      update: {
        clerkUserId,
        firstName: uData.firstName,
        lastName: uData.lastName,
      },
      create: {
        email: uData.email,
        clerkUserId,
        firstName: uData.firstName,
        lastName: uData.lastName,
      },
    });

    if (uData.isPlatformAdmin) {
      const pAdminRoleId = platformRolesMap.get("PLATFORM_ADMIN");
      if (pAdminRoleId) {
        await prisma.platformUserRole.upsert({
          where: {
            userId_platformRoleId: {
              userId: user.id,
              platformRoleId: pAdminRoleId,
            },
          },
          update: {},
          create: {
            userId: user.id,
            platformRoleId: pAdminRoleId,
          },
        });
      }
    }

    if (uData.accounts) {
      for (const acc of uData.accounts) {
        const roleId = rolesMap.get(acc.roleName);
        if (roleId) {
          await prisma.accountMembership.upsert({
            where: {
              accountId_userId: {
                accountId: acc.accountId,
                userId: user.id,
              },
            },
            update: { roleId },
            create: {
              accountId: acc.accountId,
              userId: user.id,
              roleId,
              status: "ACTIVE",
            },
          });
        }
      }
    }

    if (uData.isIndividual && uData.workspaceName) {
      const slug = uData.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const indAccount = await prisma.account.upsert({
        where: { slug },
        update: {},
        create: {
          name: uData.workspaceName,
          slug,
          type: "INDIVIDUAL",
          status: "ACTIVE",
          ownerUserId: user.id,
        },
      });

      const ownerRoleId = rolesMap.get("OWNER");
      if (ownerRoleId) {
        await prisma.accountMembership.upsert({
          where: {
            accountId_userId: {
              accountId: indAccount.id,
              userId: user.id,
            },
          },
          update: {},
          create: {
            accountId: indAccount.id,
            userId: user.id,
            roleId: ownerRoleId,
            status: "ACTIVE",
          },
        });
      }
    }
  }

  // 6. Seed Demo Shipment: SHP-2026-004872
  const shipment1 = await prisma.shipment.upsert({
    where: {
      accountId_shipmentNumber: {
        accountId: acmeCorp.id,
        shipmentNumber: "SHP-2026-004872",
      },
    },
    update: {},
    create: {
      accountId: acmeCorp.id,
      shipmentNumber: "SHP-2026-004872",
      importerName: "ABC Manufacturing India Pvt Ltd",
      poReference: "PO-778899",
      entryType: "Consumption Entry",
      incoterm: "CIF Los Angeles",
      estimatedArrival: new Date("2026-05-15"),
      status: "In Progress",
      healthStatus: "Healthy",
      readinessScore: 87,
      riskScore: 28,
      ownerName: "Stephen",
    },
  });

  // Seed Shipment Documents (5/6 Received, 1 Missing)
  const docsData = [
    { docType: "Commercial Invoice", fileName: "INV-45678.pdf", pageCount: 2, confidence: 98, status: "Received" },
    { docType: "Packing List", fileName: "PL-45678.pdf", pageCount: 3, confidence: 96, status: "Received" },
    { docType: "Bill of Lading", fileName: "BL-78910.pdf", pageCount: 2, confidence: 82, status: "Received" },
    { docType: "Arrival Notice", fileName: "AN-112233.pdf", pageCount: 1, confidence: 94, status: "Received" },
    { docType: "Insurance Certificate", fileName: "INS-90001.pdf", pageCount: 1, confidence: 91, status: "Received" },
    { docType: "Certificate of Origin", fileName: "COO-Pending.pdf", pageCount: 0, confidence: 0, status: "Missing" },
  ];

  for (const doc of docsData) {
    const existingDoc = await prisma.shipmentDocument.findFirst({
      where: { shipmentId: shipment1.id, docType: doc.docType },
    });
    if (!existingDoc) {
      await prisma.shipmentDocument.create({
        data: {
          shipmentId: shipment1.id,
          accountId: acmeCorp.id,
          docType: doc.docType,
          fileName: doc.fileName,
          pageCount: doc.pageCount,
          confidence: doc.confidence,
          status: doc.status,
        },
      });
    }
  }

  // Seed Shipment Line Items
  const itemsData = [
    { lineNumber: 1, partNumber: "VALVE-SS-316", description: "Stainless Steel Valve 1/2\" NPT, 316 Grade", quantity: 100, unitPrice: 50.0, totalValue: 5000.0, countryOfOrigin: "Germany", htsCode: "8481.80.5090", htsConfidence: 97, status: "Valid" },
    { lineNumber: 2, partNumber: "CTRL-EC-2000", description: "Electronic Controller Model EC-2000", quantity: 20, unitPrice: 420.0, totalValue: 8400.0, countryOfOrigin: "China", htsCode: "8537.10.2030", htsConfidence: 76, status: "Review Required" },
  ];

  for (const item of itemsData) {
    const existingItem = await prisma.shipmentLineItem.findFirst({
      where: { shipmentId: shipment1.id, lineNumber: item.lineNumber },
    });
    if (!existingItem) {
      await prisma.shipmentLineItem.create({
        data: {
          shipmentId: shipment1.id,
          accountId: acmeCorp.id,
          ...item,
        },
      });
    }
  }

  // Seed Agent Decisions
  const decisionsData = [
    { agentName: "Classification Agent", status: "Review Required", confidence: 76, decisionSummary: "2 line items need review", purpose: "Determine correct HS/HTS classification for all line items", dataSources: ["Documents", "Product Master", "Historical Shipments", "Tariff Rulings"], regulations: ["US HTS 2025", "GRI 1 & 6"] },
    { agentName: "Origin Agent", status: "Approved", confidence: 94, decisionSummary: "All items determined", purpose: "Verify country of origin and trade agreement eligibility", dataSources: ["Commercial Invoice", "Certificate of Origin"], regulations: ["US-Mexico-Canada Agreement (USMCA)"] },
    { agentName: "Valuation Agent", status: "Approved", confidence: 92, decisionSummary: "Customs value calculated", purpose: "Verify transaction value, assists, and freight adjustments", dataSources: ["Commercial Invoice", "Bill of Lading"], regulations: ["CBP Customs Valuation Code"] },
    { agentName: "Compliance Agent", status: "Attention", confidence: 88, decisionSummary: "1 issue requires attention", purpose: "Screen against OFAC, BIS denied parties and PGA requirements", dataSources: ["OFAC SDN List", "FDA Registration DB"], regulations: ["19 CFR § 163", "FDA FSVP"] },
    { agentName: "Filing Readiness Agent", status: "Attention", confidence: 90, decisionSummary: "87% ready to file", purpose: "Validate completeness of ABI entry summary payload", dataSources: ["Entry Summary Schema 7501"], regulations: ["US CBP ABI Specifications"] },
    { agentName: "Customs Filing Agent", status: "Pending", confidence: 0, decisionSummary: "Waiting for approvals", purpose: "Transmit ABI entry to CBP ACE portal", dataSources: ["CBP ACE Gateway"], regulations: ["Automated Broker Interface Protocol"] },
    { agentName: "Response Management Agent", status: "Pending", confidence: 0, decisionSummary: "Waiting for filing", purpose: "Process CBP entry status notifications and RFIs", dataSources: ["ACE Messaging Pipeline"], regulations: ["CBP ACE Status Code Engine"] },
  ];

  for (const dec of decisionsData) {
    const existingDec = await prisma.agentDecision.findFirst({
      where: { shipmentId: shipment1.id, agentName: dec.agentName },
    });
    if (!existingDec) {
      await prisma.agentDecision.create({
        data: {
          shipmentId: shipment1.id,
          accountId: acmeCorp.id,
          ...dec,
        },
      });
    }
  }

  // Seed Customs Filing & Responses
  const existingFiling = await prisma.customsFiling.findFirst({
    where: { shipmentId: shipment1.id },
  });

  let filingId = existingFiling?.id;
  if (!existingFiling) {
    const createdFiling = await prisma.customsFiling.create({
      data: {
        shipmentId: shipment1.id,
        accountId: acmeCorp.id,
        entryNumber: "5901-26-004872",
        authority: "US Customs (CBP)",
        entryType: "Consumption Entry",
        filingType: "ABI - Automated",
        filingStatus: "Filed",
        paymentStatus: "Paid",
        totalValue: 17750.0,
        totalDuties: 2850.0,
        totalTaxes: 13100.0,
        totalAmount: 16250.0,
      },
    });
    filingId = createdFiling.id;
  }

  if (filingId) {
    const responsesData = [
      { code: "ACK", title: "ACK - Acceptance", description: "Customs has accepted your entry summary.", status: "Accepted" },
      { code: "RFRA", title: "RFRA - Additional Info Request", description: "Request for FDA facility registration number.", status: "Responded" },
      { code: "AOC", title: "AOC - Advice of Continuation", description: "Your entry is in process with Partner Government Agencies.", status: "In Process" },
      { code: "RELE", title: "RELE - Release", description: "Entry released by customs. Cargo cleared for delivery.", status: "Released" },
    ];

    for (const resp of responsesData) {
      const existingResp = await prisma.customsResponse.findFirst({
        where: { filingId, code: resp.code },
      });
      if (!existingResp) {
        await prisma.customsResponse.create({
          data: {
            filingId,
            accountId: acmeCorp.id,
            ...resp,
          },
        });
      }
    }
  }

  // 7. Seed Regulatory Intelligence Updates
  const regUpdatesData = [
    { title: "U.S. CBP Updates Section 301 Tariff Exclusions", description: "Extension of exclusions for certain machinery products imported from China.", jurisdiction: "United States", category: "Tariffs & Duties", impactLevel: "High", effectiveDate: new Date("2026-05-20"), affectedShipmentsCount: 27, publishedText: "2h ago", status: "Immediate Action Required" },
    { title: "EU Regulation on Deforestation-free Products (EUDR)", description: "New compliance requirements and due diligence statements for imported commodities.", jurisdiction: "European Union", category: "Product Regulations", impactLevel: "Medium", effectiveDate: new Date("2026-12-30"), affectedShipmentsCount: 15, publishedText: "5h ago", status: "Upcoming Change" },
    { title: "India DGFT Import Policy Update - April 2026", description: "Changes in import policy and licensing requirements for restricted electronics items.", jurisdiction: "India", category: "Trade Policy", impactLevel: "Medium", effectiveDate: new Date("2026-05-15"), affectedShipmentsCount: 8, publishedText: "6h ago", status: "Upcoming Change" },
    { title: "Australia Customs Modernization - ICS2 Alignment", description: "New pre-arrival data requirements for sea and air cargo shipments.", jurisdiction: "Australia", category: "Compliance & Reporting", impactLevel: "Low", effectiveDate: new Date("2026-07-01"), affectedShipmentsCount: 5, publishedText: "8h ago", status: "New Requirement" },
    { title: "OFAC Sanctions List Update", description: "New entities added to the Specially Designated Nationals (SDN) list.", jurisdiction: "United States", category: "Sanctions & Restrictions", impactLevel: "High", effectiveDate: new Date("2026-05-13"), affectedShipmentsCount: 3, publishedText: "10h ago", status: "Immediate Action Required" },
  ];

  for (const reg of regUpdatesData) {
    const existingReg = await prisma.regulatoryUpdate.findFirst({
      where: { title: reg.title },
    });
    if (!existingReg) {
      await prisma.regulatoryUpdate.create({
        data: reg,
      });
    }
  }

  console.log("Successfully seeded demo shipments, decisions, filings & regulatory updates!");
}

main()
  .catch((e) => {
    console.error("Error seeding test data:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
