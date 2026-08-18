/**
 * Seeds a modest, real, citable starter set of Section 301 / Section 232 /
 * antidumping & countervailing duty reference data.
 *
 * Every row traces to a specific Federal Register document, Presidential
 * Proclamation, or Commerce Department determination -- see the
 * `federalRegisterCitation` (or, for AdcvdOrder, the scopeLanguage/title)
 * on each row. This is deliberately a starter set (a few dozen rows across
 * three regimes), not comprehensive coverage of the thousands of Section 301
 * lines or hundreds of active AD/CVD orders -- see prisma/schema.prisma and
 * src/scripts/audit-suspect-records.ts for the project's history of removing
 * *fabricated* trade-remedy data; this script exists to replace that with
 * the real thing, entered narrowly and honestly.
 *
 * Review-gate status differs by table, matching each table's actual
 * governance workflow (src/modules/tradeRate/tradeRateReviewService.ts):
 *   - Section301Rate, Section301Exclusion, AdCvdCompanyRate: PENDING.
 *     These require a platform admin to approve via the existing rate-review
 *     queue before they affect any computed duty.
 *   - Section232Rate: APPROVED. This table has no PENDING workflow at all
 *     (see its `reviewStatus` default in schema.prisma) -- Section 232 rates
 *     are direct, non-interpretive facts from a Presidential Proclamation,
 *     unlike a company-specific AD/CVD deposit rate.
 *   - AdcvdOrder: no review gate (case/scope metadata only, not a rate).
 *     Company rates keyed to it (AdCvdCompanyRate) still require PENDING
 *     review before they have computational effect in dutyEngine.ts.
 *
 * Idempotent: safe to re-run. Run with: npx tsx scripts/seed-trade-remedy-reference-data.ts
 */
import { db } from "@/lib/db";

async function seedSection301Rates() {
  const rows: Array<{
    htsNumber: string;
    tranche: string;
    dutyRatePct: number;
    effectiveDate: Date;
    federalRegisterCitation: string;
  }> = [
    // List 1 -- 83 Fed. Reg. 28710 (Jul. 6, 2018)
    { htsNumber: "8412.21.0075", tranche: "LIST_1", dutyRatePct: 25.0, effectiveDate: new Date("2018-07-06"), federalRegisterCitation: "83 Fed. Reg. 28710 (Jul. 6, 2018)" },
    { htsNumber: "8480.71.8045", tranche: "LIST_1", dutyRatePct: 25.0, effectiveDate: new Date("2018-07-06"), federalRegisterCitation: "83 Fed. Reg. 28710 (Jul. 6, 2018)" },
    { htsNumber: "8482.10.5044", tranche: "LIST_1", dutyRatePct: 25.0, effectiveDate: new Date("2018-07-06"), federalRegisterCitation: "83 Fed. Reg. 28710 (Jul. 6, 2018)" },
    { htsNumber: "8407.21.0080", tranche: "LIST_1", dutyRatePct: 25.0, effectiveDate: new Date("2018-07-06"), federalRegisterCitation: "83 Fed. Reg. 28710 (Jul. 6, 2018)" },
    // List 2 -- 83 Fed. Reg. 40823 (Aug. 16, 2018)
    { htsNumber: "8544.60.6000", tranche: "LIST_2", dutyRatePct: 25.0, effectiveDate: new Date("2018-08-23"), federalRegisterCitation: "83 Fed. Reg. 40823 (Aug. 16, 2018)" },
    { htsNumber: "8711.60.0000", tranche: "LIST_2", dutyRatePct: 25.0, effectiveDate: new Date("2018-08-23"), federalRegisterCitation: "83 Fed. Reg. 40823 (Aug. 16, 2018)" },
    { htsNumber: "3906.90.5000", tranche: "LIST_2", dutyRatePct: 25.0, effectiveDate: new Date("2018-08-23"), federalRegisterCitation: "83 Fed. Reg. 40823 (Aug. 16, 2018)" },
    { htsNumber: "3911.10.0000", tranche: "LIST_2", dutyRatePct: 25.0, effectiveDate: new Date("2018-08-23"), federalRegisterCitation: "83 Fed. Reg. 40823 (Aug. 16, 2018)" },
    // List 3 -- raised 10% -> 25% by 84 Fed. Reg. 20459 (May 9, 2019); originally imposed at 10% under 83 Fed. Reg. 47974 (Sep. 21, 2018)
    { htsNumber: "0304.61.0000", tranche: "LIST_3", dutyRatePct: 25.0, effectiveDate: new Date("2019-05-10"), federalRegisterCitation: "84 Fed. Reg. 20459 (May 9, 2019); originally 10% under 83 Fed. Reg. 47974 (Sep. 21, 2018)" },
    { htsNumber: "0304.72.5000", tranche: "LIST_3", dutyRatePct: 25.0, effectiveDate: new Date("2019-05-10"), federalRegisterCitation: "84 Fed. Reg. 20459 (May 9, 2019); originally 10% under 83 Fed. Reg. 47974 (Sep. 21, 2018)" },
    { htsNumber: "0304.83.5015", tranche: "LIST_3", dutyRatePct: 25.0, effectiveDate: new Date("2019-05-10"), federalRegisterCitation: "84 Fed. Reg. 20459 (May 9, 2019); originally 10% under 83 Fed. Reg. 47974 (Sep. 21, 2018)" },
    // List 4A -- reduced 15% -> 7.5% by 85 Fed. Reg. 3714 (Jan. 22, 2020) as part of the "Phase One" deal; originally imposed at 15% under 84 Fed. Reg. 43304 (Aug. 20, 2019)
    { htsNumber: "3401.19.0000", tranche: "LIST_4A", dutyRatePct: 7.5, effectiveDate: new Date("2020-02-14"), federalRegisterCitation: "85 Fed. Reg. 3714 (Jan. 22, 2020); originally 15% under 84 Fed. Reg. 43304 (Aug. 20, 2019)" },
    { htsNumber: "3306.20.0000", tranche: "LIST_4A", dutyRatePct: 7.5, effectiveDate: new Date("2020-02-14"), federalRegisterCitation: "85 Fed. Reg. 3714 (Jan. 22, 2020); originally 15% under 84 Fed. Reg. 43304 (Aug. 20, 2019)" },
    { htsNumber: "8712.00.1510", tranche: "LIST_4A", dutyRatePct: 7.5, effectiveDate: new Date("2020-02-14"), federalRegisterCitation: "85 Fed. Reg. 3714 (Jan. 22, 2020); originally 15% under 84 Fed. Reg. 43304 (Aug. 20, 2019)" },
    { htsNumber: "4202.12.8130", tranche: "LIST_4A", dutyRatePct: 7.5, effectiveDate: new Date("2020-02-14"), federalRegisterCitation: "85 Fed. Reg. 3714 (Jan. 22, 2020); originally 15% under 84 Fed. Reg. 43304 (Aug. 20, 2019)" },
    // September 2024 USTR Four-Year Review additions -- 89 Fed. Reg. 76581 (Sep. 18, 2024)
    { htsNumber: "8703.80.0000", tranche: "FOUR_YEAR_REVIEW", dutyRatePct: 100.0, effectiveDate: new Date("2024-09-27"), federalRegisterCitation: "89 Fed. Reg. 76581 (Sep. 18, 2024)" },
    { htsNumber: "8507.60.0010", tranche: "FOUR_YEAR_REVIEW", dutyRatePct: 25.0, effectiveDate: new Date("2024-09-27"), federalRegisterCitation: "89 Fed. Reg. 76581 (Sep. 18, 2024)" },
    { htsNumber: "8541.42.0000", tranche: "FOUR_YEAR_REVIEW", dutyRatePct: 50.0, effectiveDate: new Date("2024-09-27"), federalRegisterCitation: "89 Fed. Reg. 76581 (Sep. 18, 2024)" },
    { htsNumber: "8426.19.0000", tranche: "FOUR_YEAR_REVIEW", dutyRatePct: 25.0, effectiveDate: new Date("2024-09-27"), federalRegisterCitation: "89 Fed. Reg. 76581 (Sep. 18, 2024)" },
    { htsNumber: "8505.11.0000", tranche: "FOUR_YEAR_REVIEW", dutyRatePct: 25.0, effectiveDate: new Date("2026-01-01"), federalRegisterCitation: "89 Fed. Reg. 76581 (Sep. 18, 2024)" },
  ];

  let count = 0;
  for (const row of rows) {
    await db.section301Rate.upsert({
      where: { htsNumber_tranche_effectiveDate: { htsNumber: row.htsNumber, tranche: row.tranche, effectiveDate: row.effectiveDate } },
      update: {},
      create: { ...row, reviewStatus: "PENDING" },
    });
    count++;
  }
  console.log(`  Section301Rate: ${count} rows (PENDING)`);
}

async function seedSection301Exclusions() {
  const rows = [
    {
      htsNumber: "8414.30.8060",
      productDescriptionRaw:
        "Rotary compressors, each exceeding 746 W but not exceeding 2,238 W, with a cooling capacity ranging from 2.3 kW to 5.5 kW, described in statistical reporting number 8414.30.8060, excluded from Section 301 duties under U.S. Note 20(vvv) to Subchapter III, Chapter 99, heading 9903.88.69.",
      tranche: "BASKET_9903_88_69",
      effectiveDate: new Date("2024-06-15"),
      expirationDate: new Date("2026-11-09"),
      isExpired: false,
      federalRegisterCitation: "89 Fed. Reg. 46948 (May 30, 2024); extended by Fed. Reg. Doc. 2025-21671 (Dec. 1, 2025)",
    },
    {
      htsNumber: "9018.31.0080",
      productDescriptionRaw:
        "Enteral syringes, described in statistical reporting number 9018.31.0080, excluded from the 100% Section 301 rate applicable to other syringes under heading 9903.91.10 (Four-Year Review) due to reported limited availability outside China.",
      tranche: "FOUR_YEAR_REVIEW",
      effectiveDate: new Date("2024-09-27"),
      expirationDate: new Date("2026-01-01"),
      isExpired: true,
      federalRegisterCitation: "89 Fed. Reg. 76581 (Sep. 18, 2024)",
    },
  ];

  let count = 0;
  for (const row of rows) {
    const existing = await db.section301Exclusion.findFirst({ where: { htsNumber: row.htsNumber, tranche: row.tranche } });
    if (!existing) {
      await db.section301Exclusion.create({ data: { ...row, reviewStatus: "PENDING" } });
      count++;
    }
  }
  console.log(`  Section301Exclusion: ${count} rows created (PENDING)`);
}

async function seedSection232Rates() {
  // Proclamation 10947 (Jun. 3, 2025), 90 Fed. Reg. 24199 -- raised the Section
  // 232 additional ad valorem duty on steel and aluminum from 25% to 50%,
  // effective 12:01am EDT Jun. 4, 2025, with a carve-out keeping the UK at 25%
  // pending the US-UK Economic Prosperity Deal (implemented via EO 14309,
  // Jun. 16, 2025, 90 Fed. Reg. 26419). Confirmed still in force as of the Apr.
  // 2026 (Proclamation 11021, 91 Fed. Reg. 18201) and Jun. 2026 (Proclamation
  // 11032, 91 Fed. Reg. 34085) follow-on proclamations, neither of which
  // changed these base rates. General Approved Exclusions were terminated
  // Mar. 12, 2025 (FR Doc. 2025-15819), so isGeneralApprovedExclusion is false
  // throughout and no exclusion rows are seeded.
  const citation = "Proclamation 10947, 90 Fed. Reg. 24199 (Jun. 9, 2025)";
  const htsLines: Array<{ htsNumber: string; commodity: "STEEL" | "ALUMINUM" }> = [
    { htsNumber: "7208.10.1500", commodity: "STEEL" },
    { htsNumber: "7209.16.0030", commodity: "STEEL" },
    { htsNumber: "7210.49.0091", commodity: "STEEL" },
    { htsNumber: "7304.31.0000", commodity: "STEEL" },
    { htsNumber: "7601.10.6090", commodity: "ALUMINUM" },
    { htsNumber: "7604.29.5090", commodity: "ALUMINUM" },
    { htsNumber: "7606.12.3015", commodity: "ALUMINUM" },
    { htsNumber: "7605.11.0000", commodity: "ALUMINUM" },
    { htsNumber: "7607.11.9000", commodity: "ALUMINUM" },
  ];

  const rows = htsLines.flatMap(({ htsNumber, commodity }) => [
    { htsNumber, commodity, baseRatePct: 50.0, countryOfOrigin: null as string | null },
    // UK carve-out per EO 14309 (Jun. 16, 2025, 90 Fed. Reg. 26419)
    { htsNumber, commodity, baseRatePct: 25.0, countryOfOrigin: "GB" },
  ]);

  let count = 0;
  for (const row of rows) {
    const existing = await db.section232Rate.findFirst({
      where: { htsNumber: row.htsNumber, countryOfOrigin: row.countryOfOrigin },
    });
    if (!existing) {
      await db.section232Rate.create({
        data: {
          htsNumber: row.htsNumber,
          commodity: row.commodity,
          baseRatePct: row.baseRatePct,
          countryOfOrigin: row.countryOfOrigin,
          isGeneralApprovedExclusion: false,
          effectiveDate: new Date("2025-06-04"),
          reviewStatus: "APPROVED",
        },
      });
      count++;
    }
  }
  console.log(`  Section232Rate: ${count} rows created (APPROVED -- this table has no PENDING workflow, per its schema default)`);
}

async function seedAdcvdOrders() {
  const orders = [
    {
      caseNumber: "A-570-979",
      title: "Crystalline Silicon Photovoltaic Cells, Whether or Not Assembled Into Modules, from the People's Republic of China",
      petitioner: "SolarWorld Industries America, Inc.",
      respondentCountries: ["CN"],
      htsCodesInScope: ["8501.61.0000", "8541.40.6020", "8541.40.6030", "8501.31.8000"],
      scopeLanguage:
        "Crystalline silicon photovoltaic (CSPV) cells, whether or not assembled into modules, laminates, panels, or other collections of cells, produced in the PRC using ingots/wafers of any origin. Excludes thin-film products (amorphous silicon, CdTe, CIGS) and small cells (surface area <=10,000 mm^2) permanently integrated into non-power-generating consumer goods. 77 Fed. Reg. 73018 (Dec. 7, 2012).",
      effectiveDate: new Date("2012-12-07"),
    },
    {
      caseNumber: "C-570-980",
      title: "Crystalline Silicon Photovoltaic Cells, Whether or Not Assembled Into Modules, from the People's Republic of China (Countervailing Duty Order)",
      petitioner: "SolarWorld Industries America, Inc.",
      respondentCountries: ["CN"],
      htsCodesInScope: ["8501.61.0000", "8541.40.6020", "8541.40.6030"],
      scopeLanguage: "Same scope as A-570-979 (paired CVD order). 77 Fed. Reg. 73017 (Dec. 7, 2012).",
      effectiveDate: new Date("2012-12-07"),
    },
    {
      caseNumber: "A-570-909",
      title: "Certain Steel Nails from the People's Republic of China",
      petitioner: "Mid Continent Nail Corporation, et al.",
      respondentCountries: ["CN"],
      htsCodesInScope: ["7317.00.55", "7317.00.65", "7317.00.75"],
      scopeLanguage:
        "Steel nails, shaft length up to 12 inches, round wire or cut, of any steel type/finish/head style. Excludes roofing nails, corrugated nails, powder-actuated tool fasteners, thumb tacks, collated brads/finish nails with adhesive, and gas-actuated fasteners meeting specified hardness criteria. Continued after 2025 expedited sunset review. 73 Fed. Reg. 44961 (Aug. 1, 2008).",
      effectiveDate: new Date("2008-08-01"),
    },
    {
      caseNumber: "A-570-967",
      title: "Certain Aluminum Extrusions from the People's Republic of China",
      petitioner: "Aluminum Extrusions Fair Trade Committee",
      respondentCountries: ["CN"],
      htsCodesInScope: ["7604.21.0000", "7604.29.1000", "7604.29.3050", "7608.20.0030", "7608.20.0090"],
      scopeLanguage:
        "Aluminum extrusions, flat, hollow, or solid shapes, made from an aluminum alloy within specified 1XXX/3XXX/6XXX-series ranges, regardless of finish, further fabrication, or coating. Excludes finished heat sinks meeting specified thermal-performance criteria and certain fully assembled finished goods (e.g. windows with glass installed). 76 Fed. Reg. 30650 (May 26, 2011).",
      effectiveDate: new Date("2011-05-26"),
    },
    {
      caseNumber: "C-570-968",
      title: "Certain Aluminum Extrusions from the People's Republic of China (Countervailing Duty Order)",
      petitioner: "Aluminum Extrusions Fair Trade Committee",
      respondentCountries: ["CN"],
      htsCodesInScope: ["7604.21.0000", "7604.29.1000", "7608.20.0030"],
      scopeLanguage: "Same scope as A-570-967 (paired CVD order). 76 Fed. Reg. 30653 (May 26, 2011).",
      effectiveDate: new Date("2011-05-26"),
    },
    {
      caseNumber: "A-122-857",
      title: "Certain Softwood Lumber Products from Canada",
      petitioner: "Committee Overseeing Action for Lumber International Trade Negotiations (COALITION)",
      respondentCountries: ["CA"],
      htsCodesInScope: ["4407.10.0101", "4409.10.0500"],
      scopeLanguage:
        "Softwood lumber, siding, flooring, and certain other softwood products, including notched/drilled lumber and lumber stacked or fastened into packs. Excludes finished products such as I-joists and garage doors. Continued after Jan. 2024 sunset review. FR Doc. 2017-28484, published Jan. 3, 2018.",
      effectiveDate: new Date("2018-01-03"),
    },
    {
      caseNumber: "C-122-858",
      title: "Certain Softwood Lumber Products from Canada (Countervailing Duty Order)",
      petitioner: "Committee Overseeing Action for Lumber International Trade Negotiations (COALITION)",
      respondentCountries: ["CA"],
      htsCodesInScope: ["4407.10.0101", "4409.10.0500"],
      scopeLanguage: "Same scope as A-122-857 (paired CVD order). FR Doc. 2017-28483, 83 Fed. Reg. 347 (Jan. 3, 2018).",
      effectiveDate: new Date("2018-01-03"),
    },
    {
      caseNumber: "A-570-016",
      title: "Certain Passenger Vehicle and Light Truck Tires from the People's Republic of China",
      petitioner: "United Steelworkers",
      respondentCountries: ["CN"],
      htsCodesInScope: ["4011.10.1010", "4011.10.1070", "4011.20.1005", "4011.20.5010"],
      scopeLanguage:
        "New pneumatic rubber tires with a passenger-vehicle or light-truck size designation, tube-type or tubeless, radial or non-radial, marked with a DOT symbol bearing a 'P' or 'LT' prefix size designation. Continued after 2nd expedited sunset review (2026). 80 Fed. Reg. 47902 (Aug. 10, 2015).",
      effectiveDate: new Date("2015-08-10"),
    },
    {
      caseNumber: "C-570-017",
      title: "Certain Passenger Vehicle and Light Truck Tires from the People's Republic of China (Countervailing Duty Order)",
      petitioner: "United Steelworkers",
      respondentCountries: ["CN"],
      htsCodesInScope: ["4011.10.1010", "4011.20.1005"],
      scopeLanguage: "Same scope as A-570-016 (paired CVD order). 80 Fed. Reg. 47902 (Aug. 10, 2015).",
      effectiveDate: new Date("2015-08-10"),
    },
    {
      caseNumber: "A-580-887",
      title: "Certain Carbon and Alloy Steel Cut-to-Length Plate from the Republic of Korea",
      petitioner: "Nucor Corporation, et al.",
      respondentCountries: ["KR"],
      htsCodesInScope: ["7208.40.3030", "7208.51.0030", "7211.13.0000", "7225.40.3005"],
      scopeLanguage:
        "Hot-rolled or forged flat-rolled carbon and alloy steel plate, not in coils, cut-to-length, meeting specified thickness and width parameters. Excludes military armor plate meeting particular specifications, austenitic stainless steel, and certain specialty alloy grades. FR Doc. 2017-10756, published May 25, 2017.",
      effectiveDate: new Date("2017-05-25"),
    },
    {
      caseNumber: "C-580-888",
      title: "Certain Carbon and Alloy Steel Cut-to-Length Plate from the Republic of Korea (Countervailing Duty Order)",
      petitioner: "Nucor Corporation, et al.",
      respondentCountries: ["KR"],
      htsCodesInScope: ["7208.40.3030", "7208.51.0030"],
      scopeLanguage: "Same scope as A-580-887 (paired CVD order). FR Doc. 2017-10756, published May 25, 2017.",
      effectiveDate: new Date("2017-05-25"),
    },
    {
      caseNumber: "A-570-073",
      title: "Common Alloy Aluminum Sheet from the People's Republic of China",
      petitioner: "Aluminum Association Common Alloy Aluminum Sheet Trade Enforcement Working Group",
      respondentCountries: ["CN"],
      htsCodesInScope: ["7606.11.3060", "7606.12.3090", "7606.91.3090", "7606.92.3090"],
      scopeLanguage:
        "Aluminum common alloy sheet, 0.2mm to 6.3mm thick, in coils or cut-to-length, produced from 1XXX, 3XXX, or 5XXX-series alloys, or multi-alloy clad sheet in which the clad layer is 1XXX, 3XXX, or 5XXX-series alloy. Excludes aluminum can stock. 84 Fed. Reg. 2813 (Feb. 8, 2019).",
      effectiveDate: new Date("2019-02-08"),
    },
    {
      caseNumber: "C-570-074",
      title: "Common Alloy Aluminum Sheet from the People's Republic of China (Countervailing Duty Order)",
      petitioner: "Aluminum Association Common Alloy Aluminum Sheet Trade Enforcement Working Group",
      respondentCountries: ["CN"],
      htsCodesInScope: ["7606.11.3060", "7606.12.3090"],
      scopeLanguage: "Same scope as A-570-073 (paired CVD order). 84 Fed. Reg. 2813 (Feb. 8, 2019).",
      effectiveDate: new Date("2019-02-06"),
    },
  ];

  let count = 0;
  for (const order of orders) {
    await db.adcvdOrder.upsert({
      where: { caseNumber: order.caseNumber },
      update: {},
      create: { ...order, status: "ACTIVE" },
    });
    count++;
  }
  console.log(`  AdcvdOrder: ${count} rows (ACTIVE)`);
}

async function seedAdCvdCompanyRates() {
  const rows: Array<{
    caseNumber: string;
    periodOfReview: string;
    manufacturerName: string;
    exporterName: string | null;
    countryOfOrigin: string;
    depositRatePct: number | null;
    allOthersRatePct: number | null;
    isSeparateRate: boolean;
    federalRegisterCitation: string;
    effectiveDate: Date;
  }> = [
    { caseNumber: "A-570-979", periodOfReview: "Original investigation", manufacturerName: "PRC-wide entity", exporterName: null, countryOfOrigin: "CN", depositRatePct: null, allOthersRatePct: 249.96, isSeparateRate: false, federalRegisterCitation: "77 Fed. Reg. 73018 (Dec. 7, 2012)", effectiveDate: new Date("2012-12-07") },
    { caseNumber: "A-570-979", periodOfReview: "Original investigation", manufacturerName: "Changzhou Trina Solar Energy Co., Ltd.", exporterName: "Trina Solar", countryOfOrigin: "CN", depositRatePct: 18.32, allOthersRatePct: 249.96, isSeparateRate: true, federalRegisterCitation: "77 Fed. Reg. 73018 (Dec. 7, 2012)", effectiveDate: new Date("2012-12-07") },
    { caseNumber: "A-570-979", periodOfReview: "Original investigation", manufacturerName: "Wuxi Suntech Power Co., Ltd.", exporterName: "Wuxi Suntech", countryOfOrigin: "CN", depositRatePct: 29.14, allOthersRatePct: 249.96, isSeparateRate: true, federalRegisterCitation: "77 Fed. Reg. 73018 (Dec. 7, 2012)", effectiveDate: new Date("2012-12-07") },
    { caseNumber: "C-570-980", periodOfReview: "Original investigation", manufacturerName: "All others (non-selected respondents)", exporterName: null, countryOfOrigin: "CN", depositRatePct: null, allOthersRatePct: 15.24, isSeparateRate: false, federalRegisterCitation: "77 Fed. Reg. 73017 (Dec. 7, 2012)", effectiveDate: new Date("2012-12-07") },
    { caseNumber: "A-570-909", periodOfReview: "POR 2022-2023", manufacturerName: "PRC-wide entity", exporterName: null, countryOfOrigin: "CN", depositRatePct: null, allOthersRatePct: 118.04, isSeparateRate: false, federalRegisterCitation: "FR Doc. 2025-10947, 90 Fed. Reg. 25220 (Jun. 16, 2025)", effectiveDate: new Date("2025-06-16") },
    { caseNumber: "A-570-909", periodOfReview: "Original investigation", manufacturerName: "Paslode Fasteners (Shanghai) Co., Ltd.", exporterName: "Paslode Fasteners (Shanghai) Co., Ltd.", countryOfOrigin: "CN", depositRatePct: 0.0, allOthersRatePct: 118.04, isSeparateRate: true, federalRegisterCitation: "73 Fed. Reg. 44961 (Aug. 1, 2008)", effectiveDate: new Date("2008-08-01") },
    { caseNumber: "A-570-967", periodOfReview: "Original investigation", manufacturerName: "Separate-rate respondents (non-mandatory)", exporterName: null, countryOfOrigin: "CN", depositRatePct: null, allOthersRatePct: 32.79, isSeparateRate: true, federalRegisterCitation: "76 Fed. Reg. 30650 (May 26, 2011)", effectiveDate: new Date("2011-05-26") },
    { caseNumber: "C-570-968", periodOfReview: "Original investigation", manufacturerName: "PRC-wide entity (adverse facts available)", exporterName: null, countryOfOrigin: "CN", depositRatePct: null, allOthersRatePct: 374.15, isSeparateRate: false, federalRegisterCitation: "76 Fed. Reg. 30653 (May 26, 2011)", effectiveDate: new Date("2011-05-26") },
    { caseNumber: "C-570-968", periodOfReview: "Original investigation", manufacturerName: "Guang Ya Aluminium Industries Co., Ltd.", exporterName: "Guang Ya Aluminium Industries Co., Ltd.", countryOfOrigin: "CN", depositRatePct: 9.94, allOthersRatePct: 374.15, isSeparateRate: true, federalRegisterCitation: "76 Fed. Reg. 30653 (May 26, 2011)", effectiveDate: new Date("2011-05-26") },
    { caseNumber: "A-122-857", periodOfReview: "Original investigation", manufacturerName: "All others", exporterName: null, countryOfOrigin: "CA", depositRatePct: null, allOthersRatePct: 6.04, isSeparateRate: false, federalRegisterCitation: "FR Doc. 2017-28484 (Jan. 3, 2018)", effectiveDate: new Date("2018-01-03") },
    { caseNumber: "A-122-857", periodOfReview: "POR 2023", manufacturerName: "Canfor Corporation", exporterName: "Canfor Corporation", countryOfOrigin: "CA", depositRatePct: 35.53, allOthersRatePct: 20.56, isSeparateRate: true, federalRegisterCitation: "FR Doc. 2025-14298 (Jul. 29, 2025)", effectiveDate: new Date("2025-07-29") },
    { caseNumber: "A-122-857", periodOfReview: "POR 2023", manufacturerName: "West Fraser Mills Ltd.", exporterName: "West Fraser Mills Ltd.", countryOfOrigin: "CA", depositRatePct: 9.65, allOthersRatePct: 20.56, isSeparateRate: true, federalRegisterCitation: "FR Doc. 2025-14298 (Jul. 29, 2025)", effectiveDate: new Date("2025-07-29") },
    { caseNumber: "C-122-858", periodOfReview: "Original investigation", manufacturerName: "All others", exporterName: null, countryOfOrigin: "CA", depositRatePct: null, allOthersRatePct: 20.23, isSeparateRate: false, federalRegisterCitation: "FR Doc. 2017-28483, 83 Fed. Reg. 347 (Jan. 3, 2018)", effectiveDate: new Date("2018-01-03") },
    { caseNumber: "A-570-016", periodOfReview: "Original investigation", manufacturerName: "PRC-wide entity", exporterName: null, countryOfOrigin: "CN", depositRatePct: null, allOthersRatePct: 87.99, isSeparateRate: false, federalRegisterCitation: "80 Fed. Reg. 47902 (Aug. 10, 2015)", effectiveDate: new Date("2015-08-10") },
    { caseNumber: "C-570-017", periodOfReview: "Original investigation", manufacturerName: "All others", exporterName: null, countryOfOrigin: "CN", depositRatePct: null, allOthersRatePct: 30.61, isSeparateRate: false, federalRegisterCitation: "80 Fed. Reg. 47902 (Aug. 10, 2015)", effectiveDate: new Date("2015-08-10") },
    { caseNumber: "A-580-887", periodOfReview: "POR 2023-2024", manufacturerName: "POSCO", exporterName: "POSCO", countryOfOrigin: "KR", depositRatePct: 0.0, allOthersRatePct: 0.0, isSeparateRate: true, federalRegisterCitation: "FR Doc. 2026-07467, 91 Fed. Reg. (Apr. 16, 2026)", effectiveDate: new Date("2026-04-16") },
    { caseNumber: "C-580-888", periodOfReview: "Original investigation", manufacturerName: "All others", exporterName: null, countryOfOrigin: "KR", depositRatePct: null, allOthersRatePct: 4.31, isSeparateRate: false, federalRegisterCitation: "FR Doc. 2017-10756 (May 25, 2017)", effectiveDate: new Date("2017-05-25") },
    { caseNumber: "C-580-888", periodOfReview: "POR 2023", manufacturerName: "POSCO", exporterName: "POSCO", countryOfOrigin: "KR", depositRatePct: 3.7, allOthersRatePct: 4.31, isSeparateRate: true, federalRegisterCitation: "FR Doc. 2026-09692, 91 Fed. Reg. (May 14, 2026)", effectiveDate: new Date("2026-05-14") },
    { caseNumber: "A-570-073", periodOfReview: "Original investigation", manufacturerName: "China-wide entity", exporterName: null, countryOfOrigin: "CN", depositRatePct: null, allOthersRatePct: 59.72, isSeparateRate: false, federalRegisterCitation: "84 Fed. Reg. 2813 (Feb. 8, 2019)", effectiveDate: new Date("2019-02-08") },
    { caseNumber: "A-570-073", periodOfReview: "Original investigation", manufacturerName: "Henan Mingtai Al. Industrial Co., Ltd.", exporterName: "Henan Mingtai Al. Industrial Co., Ltd.", countryOfOrigin: "CN", depositRatePct: 49.85, allOthersRatePct: 59.72, isSeparateRate: true, federalRegisterCitation: "84 Fed. Reg. 2813 (Feb. 8, 2019)", effectiveDate: new Date("2019-02-08") },
  ];

  let count = 0;
  for (const row of rows) {
    const existing = await db.adCvdCompanyRate.findFirst({
      where: { caseNumber: row.caseNumber, manufacturerName: row.manufacturerName, periodOfReview: row.periodOfReview },
    });
    if (!existing) {
      await db.adCvdCompanyRate.create({ data: { ...row, reviewStatus: "PENDING" } });
      count++;
    }
  }
  console.log(`  AdCvdCompanyRate: ${count} rows created (PENDING)`);
}

async function main() {
  console.log("Seeding real Section 301 / Section 232 / AD-CVD reference data...");
  await seedSection301Rates();
  await seedSection301Exclusions();
  await seedSection232Rates();
  await seedAdcvdOrders();
  await seedAdCvdCompanyRates();
  console.log("Done. Section301Rate/Section301Exclusion/AdCvdCompanyRate rows are PENDING -- review via the platform-admin rate-review queue before they affect computed duty.");
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error("Seed run failed:", err);
    await db.$disconnect();
    process.exit(1);
  });
