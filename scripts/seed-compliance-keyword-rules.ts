/**
 * Seeds a starter set of ComplianceKeywordRule rows for End-Use Screening
 * (EAR Part 744.2/744.3/744.4 restricted end-uses), Military End-Use
 * Screening (EAR Part 744.21), and Anti-Boycott Screening (15 CFR 760.2
 * boycott-request language).
 *
 * There is no automated regulatory feed for this phrase data (unlike the
 * BIS CSL / OFAC SDN entity lists, which have real API/XML ingestion
 * services) -- this is a hand-authored starter set, inserted as DRAFT.
 * Per the DRAFT/PUBLISHED gating used throughout this platform's reference
 * data, these rows will never be read by the screening checks (which only
 * query publicationStatus: "PUBLISHED") until a compliance/legal reviewer
 * promotes them -- see BisCslIngestionService.publishStagedEntities for the
 * equivalent promotion pattern.
 *
 * Run with: npx tsx scripts/seed-compliance-keyword-rules.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const AUTHORITY = "US BIS / Dept of Commerce";

const RULES: Array<{
  category: string;
  phrase: string;
  citation: string;
  severity: string;
  authority?: string;
}> = [
  // ---- End-Use Screening: EAR 744.2 -- nuclear end-uses ----
  { category: "END_USE_NUCLEAR", phrase: "uranium enrichment", citation: "15 CFR 744.2", severity: "CRITICAL" },
  { category: "END_USE_NUCLEAR", phrase: "plutonium reprocessing", citation: "15 CFR 744.2", severity: "CRITICAL" },
  { category: "END_USE_NUCLEAR", phrase: "unsafeguarded nuclear facility", citation: "15 CFR 744.2", severity: "CRITICAL" },
  { category: "END_USE_NUCLEAR", phrase: "nuclear explosive device", citation: "15 CFR 744.2", severity: "CRITICAL" },
  { category: "END_USE_NUCLEAR", phrase: "heavy water production facility", citation: "15 CFR 744.2", severity: "HIGH" },

  // ---- End-Use Screening: EAR 744.3(a) -- missile end-uses ----
  { category: "END_USE_MISSILE", phrase: "ballistic missile", citation: "15 CFR 744.3(a)", severity: "CRITICAL" },
  { category: "END_USE_MISSILE", phrase: "missile guidance system", citation: "15 CFR 744.3(a)", severity: "CRITICAL" },
  { category: "END_USE_MISSILE", phrase: "cruise missile", citation: "15 CFR 744.3(a)", severity: "CRITICAL" },
  { category: "END_USE_MISSILE", phrase: "missile technology control regime", citation: "15 CFR 744.3(a)", severity: "HIGH" },

  // ---- End-Use Screening: EAR 744.3(b) -- rocket systems / UAV end-uses ----
  { category: "END_USE_ROCKET_UAV", phrase: "unmanned aerial vehicle", citation: "15 CFR 744.3(b)", severity: "HIGH" },
  { category: "END_USE_ROCKET_UAV", phrase: "unmanned air vehicle", citation: "15 CFR 744.3(b)", severity: "HIGH" },
  { category: "END_USE_ROCKET_UAV", phrase: "rocket system", citation: "15 CFR 744.3(b)", severity: "HIGH" },
  { category: "END_USE_ROCKET_UAV", phrase: "unmanned combat aerial vehicle", citation: "15 CFR 744.3(b)", severity: "CRITICAL" },

  // ---- End-Use Screening: EAR 744.4 -- chemical/biological weapons end-uses ----
  { category: "END_USE_CHEM_BIO", phrase: "chemical weapon", citation: "15 CFR 744.4", severity: "CRITICAL" },
  { category: "END_USE_CHEM_BIO", phrase: "biological weapon", citation: "15 CFR 744.4", severity: "CRITICAL" },
  { category: "END_USE_CHEM_BIO", phrase: "precursor chemical for chemical weapons", citation: "15 CFR 744.4", severity: "CRITICAL" },
  { category: "END_USE_CHEM_BIO", phrase: "CBW proliferation", citation: "15 CFR 744.4", severity: "HIGH" },

  // ---- Military End-Use Screening: EAR 744.21 ----
  { category: "MILITARY_END_USE", phrase: "military end use", citation: "15 CFR 744.21", severity: "CRITICAL" },
  { category: "MILITARY_END_USE", phrase: "military end user", citation: "15 CFR 744.21", severity: "CRITICAL" },
  { category: "MILITARY_END_USE", phrase: "military aircraft maintenance", citation: "15 CFR 744.21", severity: "HIGH" },
  { category: "MILITARY_END_USE", phrase: "incorporation into a military commodity", citation: "15 CFR 744.21", severity: "CRITICAL" },
  { category: "MILITARY_END_USE", phrase: "operation of a military system", citation: "15 CFR 744.21", severity: "HIGH" },

  // ---- Anti-Boycott Screening: 15 CFR 760.2 boycott-request language ----
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "goods not of Israeli origin", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "not manufactured in Israel", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "no connection with Israel", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "vessel is eligible to enter Arab ports", citation: "15 CFR 760.2", severity: "MEDIUM", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "blacklisted by the Arab League", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "boycott of Israel", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const rule of RULES) {
    const existing = await db.complianceKeywordRule.findFirst({
      where: { category: rule.category, phrase: rule.phrase },
    });

    if (existing) {
      await db.complianceKeywordRule.update({
        where: { id: existing.id },
        data: {
          citation: rule.citation,
          severity: rule.severity,
          authority: rule.authority ?? AUTHORITY,
        },
      });
      updated++;
    } else {
      await db.complianceKeywordRule.create({
        data: {
          category: rule.category,
          phrase: rule.phrase,
          matchType: "CONTAINS",
          citation: rule.citation,
          severity: rule.severity,
          authority: rule.authority ?? AUTHORITY,
          publicationStatus: "DRAFT",
        },
      });
      created++;
    }
  }

  console.log(`ComplianceKeywordRule seed complete: ${created} created, ${updated} updated, all as DRAFT.`);
  console.log("These rows will not affect live screening until explicitly promoted to PUBLISHED after review.");
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await db.$disconnect();
    process.exit(1);
  });
