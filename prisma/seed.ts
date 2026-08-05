import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Seeding relational enterprise trade compliance data into Supabase PostgreSQL...");

  // 1. Seed Default System Roles
  let ownerRole = await db.role.findFirst({ where: { name: "OWNER", isSystem: true } });
  if (!ownerRole) {
    ownerRole = await db.role.create({
      data: { name: "OWNER", description: "Full workspace ownership", isSystem: true },
    });
  }

  let adminRole = await db.role.findFirst({ where: { name: "ADMIN", isSystem: true } });
  if (!adminRole) {
    await db.role.create({
      data: { name: "ADMIN", description: "Workspace administration", isSystem: true },
    });
  }

  let memberRole = await db.role.findFirst({ where: { name: "MEMBER", isSystem: true } });
  if (!memberRole) {
    await db.role.create({
      data: { name: "MEMBER", description: "Regular member access", isSystem: true },
    });
  }

  let viewerRole = await db.role.findFirst({ where: { name: "VIEWER", isSystem: true } });
  if (!viewerRole) {
    await db.role.create({
      data: { name: "VIEWER", description: "Read-only access", isSystem: true },
    });
  }

  // 2. Find or Create Primary Enterprise Account
  let account = await db.account.findFirst({
    where: { slug: "qubere-enterprise" },
  });

  if (!account) {
    account = await db.account.create({
      data: {
        name: "Qubere Enterprise Workspace",
        slug: "qubere-enterprise",
        type: "ENTERPRISE",
        status: "ACTIVE",
      },
    });
  }

  // 3. Find Primary User
  const user = await db.user.findFirst({
    where: { email: "admin@qubere.ai" },
  });

  if (user && account) {
    const existingMembership = await db.accountMembership.findFirst({
      where: { accountId: account.id, userId: user.id },
    });

    if (!existingMembership) {
      await db.accountMembership.create({
        data: {
          accountId: account.id,
          userId: user.id,
          roleId: ownerRole.id,
          status: "ACTIVE",
        },
      });
    }
  }

  // 4. Seed Dynamic Shipments
  const demoShipments = [
    {
      shipmentNumber: "SHP-2026-004872",
      importerName: "ABC Manufacturing India Pvt Ltd",
      poReference: "PO-889900",
      entryType: "Consumption Entry",
      incoterm: "CIF Los Angeles",
      portOfEntry: "Port of Los Angeles (2704)",
      carrierName: "Maersk Line",
      countryOfExport: "Germany",
      estimatedArrival: new Date("2026-05-15"),
      status: "In Progress",
      healthStatus: "At Risk",
      readinessScore: 87,
      riskScore: 92,
      ownerName: "Stephen",
    },
    {
      shipmentNumber: "SHP-2026-004871",
      importerName: "Global Logistics Corp",
      poReference: "PO-774411",
      entryType: "Formal Entry",
      incoterm: "FOB Hamburg",
      portOfEntry: "Port of Long Beach (2709)",
      carrierName: "MSC Shipping",
      countryOfExport: "China",
      estimatedArrival: new Date("2026-05-18"),
      status: "Ready to File",
      healthStatus: "Healthy",
      readinessScore: 98,
      riskScore: 85,
      ownerName: "Priya Nair",
    },
    {
      shipmentNumber: "SHP-2026-004870",
      importerName: "Apex Automotive Inc",
      poReference: "PO-551122",
      entryType: "Informal Entry",
      incoterm: "DDP Chicago",
      portOfEntry: "Chicago O'Hare (3901)",
      carrierName: "DHL Express",
      countryOfExport: "Japan",
      estimatedArrival: new Date("2026-05-20"),
      status: "On Hold",
      healthStatus: "Critical",
      readinessScore: 62,
      riskScore: 78,
      ownerName: "Rohan Mehta",
    },
    {
      shipmentNumber: "SHP-2026-004869",
      importerName: "Vertex Energy Solutions",
      poReference: "PO-993344",
      entryType: "Consumption Entry",
      incoterm: "CIF Houston",
      portOfEntry: "Port of Houston (5301)",
      carrierName: "Hapag-Lloyd",
      countryOfExport: "India",
      estimatedArrival: new Date("2026-05-22"),
      status: "Submitted",
      healthStatus: "Healthy",
      readinessScore: 100,
      riskScore: 72,
      ownerName: "Sneha Iyer",
    },
    {
      shipmentNumber: "SHP-2026-004868",
      importerName: "Zenith Tech Systems",
      poReference: "PO-112233",
      entryType: "Consumption Entry",
      incoterm: "CIF San Francisco",
      portOfEntry: "San Francisco Int. Airport (2801)",
      carrierName: "FedEx Trade Networks",
      countryOfExport: "Germany",
      estimatedArrival: new Date("2026-05-10"),
      status: "Completed",
      healthStatus: "Healthy",
      readinessScore: 100,
      riskScore: 65,
      ownerName: "Vikram Patel",
    },
  ];

  for (const sData of demoShipments) {
    let shipment = await db.shipment.findFirst({
      where: { accountId: account.id, shipmentNumber: sData.shipmentNumber },
    });

    if (!shipment) {
      shipment = await db.shipment.create({
        data: { ...sData, accountId: account.id },
      });
    } else {
      shipment = await db.shipment.update({
        where: { id: shipment.id },
        data: sData,
      });
    }

    // Seed Documents for SHP-2026-004872
    if (sData.shipmentNumber === "SHP-2026-004872") {
      await db.shipmentDocument.deleteMany({ where: { shipmentId: shipment.id } });
      await db.shipmentDocument.createMany({
        data: [
          { shipmentId: shipment.id, accountId: account.id, docType: "Commercial Invoice", fileName: "INV-45678.pdf", pageCount: 2, confidence: 98, status: "Received", required: true },
          { shipmentId: shipment.id, accountId: account.id, docType: "Packing List", fileName: "PL-45678.pdf", pageCount: 3, confidence: 95, status: "Received", required: true },
          { shipmentId: shipment.id, accountId: account.id, docType: "Bill of Lading", fileName: "BOL-987654.pdf", pageCount: 1, confidence: 99, status: "Received", required: true },
          { shipmentId: shipment.id, accountId: account.id, docType: "Arrival Notice", fileName: "AN-202605.pdf", pageCount: 1, confidence: 92, status: "Received", required: true },
          { shipmentId: shipment.id, accountId: account.id, docType: "Insurance Certificate", fileName: "INS-77889.pdf", pageCount: 2, confidence: 94, status: "Received", required: true },
          { shipmentId: shipment.id, accountId: account.id, docType: "Certificate of Origin", fileName: "COO-PENDING.pdf", pageCount: 0, confidence: 0, status: "Missing", required: true },
        ],
      });

      // Seed Line Items
      await db.shipmentLineItem.deleteMany({ where: { shipmentId: shipment.id } });
      await db.shipmentLineItem.createMany({
        data: [
          { shipmentId: shipment.id, accountId: account.id, lineNumber: 1, partNumber: "VALVE-316-01", description: "Stainless Steel Valve 1/2\" NPT, 316 Grade", quantity: 100, unitPrice: 50.0, totalValue: 5000.0, countryOfOrigin: "Germany", htsCode: "8481.80.5090", htsConfidence: 97, status: "Valid" },
          { shipmentId: shipment.id, accountId: account.id, lineNumber: 2, partNumber: "CTRL-ECU-02", description: "Electronic Controller & Switchboard Unit", quantity: 20, unitPrice: 420.0, totalValue: 8400.0, countryOfOrigin: "China", htsCode: "8537.10.2030", htsConfidence: 76, status: "Review Required" },
        ],
      });

      // Seed Agent Decisions
      await db.agentDecision.deleteMany({ where: { shipmentId: shipment.id } });
      await db.agentDecision.createMany({
        data: [
          {
            shipmentId: shipment.id,
            accountId: account.id,
            agentName: "Classification Agent",
            status: "Review Required",
            confidence: 76,
            decisionSummary: "2 line items require HTS code human review due to ambiguous component descriptions.",
            purpose: "Determine correct HS/HTS tariff classification for all entry line items.",
            dataSources: ["Documents", "Product Master", "Historical Shipments", "WCO Explanatory Notes"],
            regulations: ["US HTS 2026", "General Rules of Interpretation (GRI 1 & 6)"],
            modelVersion: "Qubere-Taxo-v2.3",
            currentHtsCode: "8481.80.5090",
            proposedHtsCode: "8537.10.2030",
            proposedDescription: "Boards, panels, consoles, desks, cabinets and other bases for electric control",
            rulesApplied: ["GRI 1: Terms of headings & Section/Chapter Notes", "GRI 6: Subheading classification principles"],
            evidenceItems: [
              { title: "Invoice Description", detail: "Electronic Controller Unit - INV-45678.pdf Page 1 Line 2", source: "Invoice Document" },
              { title: "Historical Match", detail: "8537.10.2030 used in 14 previous shipments with 99% acceptance", source: "Customs Entry Database" },
              { title: "Tariff Ruling NY N302145", detail: "CBP ruled similar programmable controllers under 8537.10.2030", source: "CBP CROSS Rulings" },
            ],
            humanNotes: "Reviewing voltage specs with engineering before final approval.",
          },
        ],
      });

      // Seed Customs Filing
      await db.customsFiling.deleteMany({ where: { shipmentId: shipment.id } });
      const filing = await db.customsFiling.create({
        data: {
          shipmentId: shipment.id,
          accountId: account.id,
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
          dutyBreakdown: [
            { feeName: "Basic Customs Duty (2.5%)", amount: 335.0, rate: "2.5%" },
            { feeName: "Section 301 China Duty (7.5%)", amount: 630.0, rate: "7.5%" },
            { feeName: "Merchandise Processing Fee (MPF)", amount: 46.42, rate: "0.3464%" },
            { feeName: "Harbor Maintenance Fee (HMF)", amount: 16.75, rate: "0.125%" },
            { feeName: "State Harbor Tax", amount: 8.5, rate: "Fixed" },
          ],
        },
      });

      // Seed Responses
      await db.customsResponse.deleteMany({ where: { filingId: filing.id } });
      await db.customsResponse.createMany({
        data: [
          { filingId: filing.id, accountId: account.id, code: "ACK", title: "ACK - Acceptance", description: "Customs has accepted your entry summary.", status: "Accepted" },
          { filingId: filing.id, accountId: account.id, code: "RFRA", title: "RFRA - Additional Info Request", description: "CBP requested Certificate of Origin clarification.", status: "In Process" },
          { filingId: filing.id, accountId: account.id, code: "AOC", title: "AOC - Advice of Continuation", description: "Entry processing continuing under standard timeframe.", status: "In Process" },
          { filingId: filing.id, accountId: account.id, code: "RELE", title: "RELE - Release", description: "Shipment released by CBP officer.", status: "Released" },
        ],
      });
    }
  }

  // 5. Seed Regulatory Updates
  await db.regulatoryUpdate.deleteMany({});
  await db.regulatoryUpdate.createMany({
    data: [
      {
        title: "U.S. CBP Updates Section 301 Tariff Exclusions",
        description: "Extension of exclusions for certain products imported from China under List 3 and List 4A.",
        jurisdiction: "United States",
        category: "Tariffs & Duties",
        impactLevel: "High",
        effectiveDate: new Date("2026-05-20"),
        affectedShipmentsCount: 27,
        publishedText: "2h ago",
        status: "Immediate Action Required",
      },
      {
        title: "EU Deforestation Regulation (EUDR) Implementation Date",
        description: "European Commission announces revised compliance deadlines for wood, coffee, cocoa, and rubber imports.",
        jurisdiction: "European Union",
        category: "Product Regulations",
        impactLevel: "Medium",
        effectiveDate: new Date("2026-06-01"),
        affectedShipmentsCount: 15,
        publishedText: "5h ago",
        status: "Upcoming Change",
      },
      {
        title: "India DGFT Modifies Import Licensing for IT Hardware",
        description: "Directorate General of Foreign Trade updates authorization quota procedures for laptops and microcontrollers.",
        jurisdiction: "India",
        category: "Trade Policy",
        impactLevel: "High",
        effectiveDate: new Date("2026-05-18"),
        affectedShipmentsCount: 8,
        publishedText: "1d ago",
        status: "Information Update",
      },
      {
        title: "Australia ICS2 System Data Element Mandatory Fields",
        description: "Department of Home Affairs enforces new 6-digit HS code reporting prior to loading.",
        jurisdiction: "Australia",
        category: "Compliance & Reporting",
        impactLevel: "Medium",
        effectiveDate: new Date("2026-05-25"),
        affectedShipmentsCount: 5,
        publishedText: "2d ago",
        status: "New Requirement",
      },
      {
        title: "UK HMRC Customs Declaration Service (CDS) Tariff Shift",
        description: "HM Revenue & Customs publishes updated duty calculation formulas for industrial machinery.",
        jurisdiction: "United Kingdom",
        category: "Tariffs & Duties",
        impactLevel: "Low",
        effectiveDate: new Date("2026-06-15"),
        affectedShipmentsCount: 9,
        publishedText: "3d ago",
        status: "Information Update",
      },
    ],
  });

  console.log("✅ Seeded enterprise shipments, line items, agent decisions, filings & regulatory updates!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
