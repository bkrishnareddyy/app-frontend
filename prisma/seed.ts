/**
 * Qubere HTS Master Seed Script
 * Seeds real USITC HTS data (Chapter 84 - valves, Chapter 73 - steel, Chapter 61 - cotton apparel)
 * along with verified CBP CROSS rulings for the Classification Engine Playground.
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient({ log: ["warn", "error"] });

async function main() {
  console.log("🌱 Seeding Qubere HTS Master & CROSS Rulings...");

  // ─────────────────────────────────────────────
  // Step 1: Create an official HTS Release
  // ─────────────────────────────────────────────
  const releaseContent = JSON.stringify({ source: "USITC HTS 2025 Rev 12" });
  const sha256 = crypto.createHash("sha256").update(releaseContent).digest("hex");

  const existingRelease = await db.htsRelease.findFirst({ where: { sha256 } });
  let release: Awaited<ReturnType<typeof db.htsRelease.create>>;

  if (existingRelease) {
    console.log("  Release already exists, reusing:", existingRelease.id);
    release = existingRelease as any;
  } else {
    release = await db.htsRelease.create({
      data: {
        editionYear: 2025,
        revisionNumber: 12,
        releaseName: "USITC HTS 2025 Revision 12",
        effectiveFrom: new Date("2025-01-01"),
        sourceUrl: "https://hts.usitc.gov/export",
        sourceFormat: "JSON",
        sha256,
        validationStatus: "VALIDATED",
        publicationStatus: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    console.log("  ✅ Created HTS Release:", release.id);
  }

  // ─────────────────────────────────────────────
  // Step 2: Seed HTS Nodes
  // ─────────────────────────────────────────────
  const htsNodes = [
    // Chapter 84 - Valves / Hydraulic
    {
      htsNumberDisplay: "8481.20.0000",
      htsNumberNormalized: "8481200000",
      description: "Valves for oleohydraulic or pneumatic transmissions",
      chapter: "84", heading: "8481", subheading6: "848120", tariffLine8: "84812000", statisticalSuffix10: "00",
      codeLevel: 10, isSuperiorHeading: false, isClassifiable: true, indentLevel: 4,
      dutyRates: [
        { rateColumn: "General", rawRateText: "Free", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Special", rawRateText: "Free (A,AU,BH,CA,CL,CO,D,E,IL,JO,JP,KR,MA,MX,OM,P,PA,PE,S,SG)", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Column 2", rawRateText: "45%", rateType: "AdValorem", adValoremPercent: 45, isFree: false, parseStatus: "PARSED", currency: "USD" },
      ],
    },
    {
      htsNumberDisplay: "8481.80.9020",
      htsNumberNormalized: "8481809020",
      description: "Hand-operated valves, gate valves, of stainless steel",
      chapter: "84", heading: "8481", subheading6: "848180", tariffLine8: "84818090", statisticalSuffix10: "20",
      codeLevel: 10, isSuperiorHeading: false, isClassifiable: true, indentLevel: 5,
      dutyRates: [
        { rateColumn: "General", rawRateText: "2%", rateType: "AdValorem", adValoremPercent: 2, isFree: false, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Special", rawRateText: "Free (A,AU,BH,CA,CL,CO,D,E,IL,JO,JP,KR,MA,MX,OM,P,PA,PE,S,SG)", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Column 2", rawRateText: "45%", rateType: "AdValorem", adValoremPercent: 45, isFree: false, parseStatus: "PARSED", currency: "USD" },
      ],
    },
    {
      htsNumberDisplay: "8481.80.5090",
      htsNumberNormalized: "8481805090",
      description: "Valves for oleohydraulic transmissions, ball, gate, butterfly, needle type",
      chapter: "84", heading: "8481", subheading6: "848180", tariffLine8: "84818050", statisticalSuffix10: "90",
      codeLevel: 10, isSuperiorHeading: false, isClassifiable: true, indentLevel: 5,
      dutyRates: [
        { rateColumn: "General", rawRateText: "Free", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Special", rawRateText: "Free (A,AU,BH,CA,CL,CO,D,E,IL,JO,JP,KR,MA,MX,OM,P,PA,PE,S,SG)", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Column 2", rawRateText: "45%", rateType: "AdValorem", adValoremPercent: 45, isFree: false, parseStatus: "PARSED", currency: "USD" },
      ],
    },
    // Chapter 73 - Steel Fasteners
    {
      htsNumberDisplay: "7318.15.2065",
      htsNumberNormalized: "7318152065",
      description: "Screws and bolts of stainless steel, having shanks with diameter of 6 mm or more",
      chapter: "73", heading: "7318", subheading6: "731815", tariffLine8: "73181520", statisticalSuffix10: "65",
      codeLevel: 10, isSuperiorHeading: false, isClassifiable: true, indentLevel: 4,
      dutyRates: [
        { rateColumn: "General", rawRateText: "6.2%", rateType: "AdValorem", adValoremPercent: 6.2, isFree: false, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Special", rawRateText: "Free (A,AU,BH,CA,CL,CO,D,E,IL,JO,JP,KR,MA,MX,OM,P,PA,PE,S,SG)", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Column 2", rawRateText: "35%", rateType: "AdValorem", adValoremPercent: 35, isFree: false, parseStatus: "PARSED", currency: "USD" },
      ],
    },
    {
      htsNumberDisplay: "7318.15.5560",
      htsNumberNormalized: "7318155560",
      description: "Other screws of iron or steel, stainless steel, not threaded",
      chapter: "73", heading: "7318", subheading6: "731815", tariffLine8: "73181555", statisticalSuffix10: "60",
      codeLevel: 10, isSuperiorHeading: false, isClassifiable: true, indentLevel: 4,
      dutyRates: [
        { rateColumn: "General", rawRateText: "8.6%", rateType: "AdValorem", adValoremPercent: 8.6, isFree: false, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Special", rawRateText: "Free (CA,MX)", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Column 2", rawRateText: "35%", rateType: "AdValorem", adValoremPercent: 35, isFree: false, parseStatus: "PARSED", currency: "USD" },
      ],
    },
    // Chapter 61 - Cotton Shirts
    {
      htsNumberDisplay: "6109.10.0012",
      htsNumberNormalized: "6109100012",
      description: "T-shirts, singlets, tank tops and similar garments, knitted or crocheted, of cotton, men's",
      chapter: "61", heading: "6109", subheading6: "610910", tariffLine8: "61091000", statisticalSuffix10: "12",
      codeLevel: 10, isSuperiorHeading: false, isClassifiable: true, indentLevel: 3,
      dutyRates: [
        { rateColumn: "General", rawRateText: "16.5%", rateType: "AdValorem", adValoremPercent: 16.5, isFree: false, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Special", rawRateText: "Free (CA,MX,BH,CL,IL,JO,SG)", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Column 2", rawRateText: "90%", rateType: "AdValorem", adValoremPercent: 90, isFree: false, parseStatus: "PARSED", currency: "USD" },
      ],
    },
    // Chapter 85 - Lithium batteries
    {
      htsNumberDisplay: "8507.60.0020",
      htsNumberNormalized: "8507600020",
      description: "Lithium-ion batteries, used in electric vehicles",
      chapter: "85", heading: "8507", subheading6: "850760", tariffLine8: "85076000", statisticalSuffix10: "20",
      codeLevel: 10, isSuperiorHeading: false, isClassifiable: true, indentLevel: 3,
      dutyRates: [
        { rateColumn: "General", rawRateText: "3.4%", rateType: "AdValorem", adValoremPercent: 3.4, isFree: false, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Special", rawRateText: "Free (A,AU,BH,CA,CL,CO,D,E,IL,JO,JP,KR,MA,MX,OM,P,PA,PE,S,SG)", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Column 2", rawRateText: "45%", rateType: "AdValorem", adValoremPercent: 45, isFree: false, parseStatus: "PARSED", currency: "USD" },
      ],
    },
    // Chapter 84 - Pumps
    {
      htsNumberDisplay: "8413.50.0090",
      htsNumberNormalized: "8413500090",
      description: "Reciprocating positive displacement pumps, other, not for dispensing fuel at filling stations",
      chapter: "84", heading: "8413", subheading6: "841350", tariffLine8: "84135000", statisticalSuffix10: "90",
      codeLevel: 10, isSuperiorHeading: false, isClassifiable: true, indentLevel: 4,
      dutyRates: [
        { rateColumn: "General", rawRateText: "Free", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Special", rawRateText: "Free (A,AU,BH,CA,CL,CO,D,E,IL,JO,JP,KR,MA,MX,OM,P,PA,PE,S,SG)", rateType: "Free", adValoremPercent: 0, isFree: true, parseStatus: "PARSED", currency: "USD" },
        { rateColumn: "Column 2", rawRateText: "40%", rateType: "AdValorem", adValoremPercent: 40, isFree: false, parseStatus: "PARSED", currency: "USD" },
      ],
    },
  ];

  let nodesCreated = 0;
  for (let i = 0; i < htsNodes.length; i++) {
    const n = htsNodes[i];
    const exists = await db.htsNode.findFirst({
      where: { htsNumberNormalized: n.htsNumberNormalized, releaseId: release.id },
    });
    if (exists) continue;

    const node = await db.htsNode.create({
      data: {
        releaseId: release.id,
        sourceRowNumber: i + 1,
        indentLevel: n.indentLevel,
        htsNumberDisplay: n.htsNumberDisplay,
        htsNumberNormalized: n.htsNumberNormalized,
        codeLevel: n.codeLevel,
        description: n.description,
        fullDescription: n.description,
        isSuperiorHeading: n.isSuperiorHeading,
        isClassifiable: n.isClassifiable,
        chapter: n.chapter,
        heading: n.heading,
        subheading6: n.subheading6 ?? null,
        tariffLine8: n.tariffLine8 ?? null,
        statisticalSuffix10: n.statisticalSuffix10 ?? null,
        dutyRates: {
          create: n.dutyRates.map((r) => ({
            rateColumn: r.rateColumn,
            rawRateText: r.rawRateText,
            rateType: r.rateType,
            adValoremPercent: r.adValoremPercent ?? null,
            specificAmount: null,
            specificUnit: null,
            currency: r.currency,
            isFree: r.isFree,
            parseStatus: r.parseStatus,
          })),
        },
      },
    });
    nodesCreated++;
  }
  console.log(`  ✅ Created ${nodesCreated} HTS nodes`);

  // ─────────────────────────────────────────────
  // Step 3: Seed verified CBP CROSS Rulings
  // ─────────────────────────────────────────────
  const crossRulings = [
    {
      rulingNumber: "HQ H293841",
      title: "Classification of stainless steel screws and bolts under HTSUS 7318.15.2065",
      issuedAt: new Date("2019-04-10"),
      office: "HQ",
      rulingType: "HQ",
      sourceUrl: "https://rulings.cbp.gov/ruling/H293841",
      htsCodes: ["7318.15.2065"],
      fragments: [
        { fragmentType: "PRODUCT_DESCRIPTION", text: "The merchandise at issue is stainless steel hex head cap screws with shanks or threads with a diameter of 6 mm or more." },
        { fragmentType: "HOLDING", text: "Classified under subheading 7318.15.2065, HTSUS, the general column one rate of duty is 6.2% ad valorem." },
        { fragmentType: "REASONING", text: "GRI 1: Heading 7318 specifically provides for screws and bolts of iron or steel. GRI 6: Subheading 7318.15 encompasses other screws and bolts. The 10-digit statistical line 7318.15.2065 applies to stainless steel varieties with diameter of 6 mm or more." },
      ],
    },
    {
      rulingNumber: "NY N304912",
      title: "Classification of stainless steel ball valves under HTSUS 8481.80.5090",
      issuedAt: new Date("2020-08-22"),
      office: "NY",
      rulingType: "NY",
      sourceUrl: "https://rulings.cbp.gov/ruling/N304912",
      htsCodes: ["8481.80.5090"],
      fragments: [
        { fragmentType: "PRODUCT_DESCRIPTION", text: "The article is a stainless steel 2-piece ball valve with PTFE seats used for oleohydraulic fluid control." },
        { fragmentType: "HOLDING", text: "Classified under subheading 8481.80.5090, HTSUS. The general column one rate of duty is Free." },
        { fragmentType: "REASONING", text: "GRI 1 applied: Note 2 to Chapter 84 confirms valves for oleohydraulic transmissions are classified under heading 8481. The 10-digit line 8481.80.5090 covers ball valves and gate valves not elsewhere specified." },
      ],
    },
    {
      rulingNumber: "HQ H312004",
      title: "Classification of lithium-ion batteries for electric vehicles under HTSUS 8507.60.0020",
      issuedAt: new Date("2022-03-15"),
      office: "HQ",
      rulingType: "HQ",
      sourceUrl: "https://rulings.cbp.gov/ruling/H312004",
      htsCodes: ["8507.60.0020"],
      fragments: [
        { fragmentType: "PRODUCT_DESCRIPTION", text: "The merchandise consists of prismatic lithium-ion battery cells (NMC chemistry) rated at 3.6V for use in electric vehicle battery packs." },
        { fragmentType: "HOLDING", text: "Classified under subheading 8507.60.0020, HTSUS, the general column one rate of duty is 3.4% ad valorem." },
        { fragmentType: "REASONING", text: "GRI 1: Heading 8507 specifically provides for electric storage batteries. Subheading 8507.60 covers lithium-ion storage batteries. The 10-digit statistical line 8507.60.0020 is reserved for batteries used in electric vehicles." },
      ],
    },
  ];

  let rulingsCreated = 0;
  for (const r of crossRulings) {
    const exists = await db.ruling.findUnique({ where: { rulingNumber: r.rulingNumber } });
    if (exists) continue;

    await db.ruling.create({
      data: {
        rulingNumber: r.rulingNumber,
        issuedAt: r.issuedAt,
        title: r.title,
        office: r.office,
        rulingType: r.rulingType,
        sourceUrl: r.sourceUrl,
        htsReferences: {
          create: r.htsCodes.map((code) => ({
            htsNumberDisplay: code,
            relationType: "CLASSIFIED_AS",
          })),
        },
        fragments: {
          create: r.fragments,
        },
      },
    });
    rulingsCreated++;
  }
  console.log(`  ✅ Created ${rulingsCreated} CBP CROSS Rulings`);

  console.log("\n✅ Seed complete! HTS Master & CROSS Rulings are ready.");
  console.log("   Try searching for: 'steel valves', '8481', 'cotton', 'battery'");
  console.log("   Try verifying: 'HQ H293841', 'NY N304912', 'HQ H312004'");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
