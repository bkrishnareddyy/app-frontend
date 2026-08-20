/**
 * Seeds a starter set of ComplianceKeywordRule rows for End-Use Screening
 * (EAR Part 744.2/744.3/744.4 restricted end-uses), Military End-Use
 * Screening (EAR Part 744.21), Anti-Boycott Screening (15 CFR 760.2
 * boycott-request language), and Restricted Party Screening's red-flag word
 * check (15 CFR Part 732, Supp. No. 3 "Know Your Customer" red flags).
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
  { category: "END_USE_NUCLEAR", phrase: "unsafeguarded nuclear fuel cycle activity", citation: "15 CFR 744.2", severity: "CRITICAL" },
  { category: "END_USE_NUCLEAR", phrase: "special nuclear material", citation: "15 CFR 744.2", severity: "HIGH" },
  { category: "END_USE_NUCLEAR", phrase: "isotope separation facility", citation: "15 CFR 744.2", severity: "HIGH" },
  { category: "END_USE_NUCLEAR", phrase: "nuclear weapon", citation: "15 CFR 744.2", severity: "CRITICAL" },

  // ---- End-Use Screening: EAR 744.3(a) -- missile end-uses ----
  { category: "END_USE_MISSILE", phrase: "ballistic missile", citation: "15 CFR 744.3(a)", severity: "CRITICAL" },
  { category: "END_USE_MISSILE", phrase: "missile guidance system", citation: "15 CFR 744.3(a)", severity: "CRITICAL" },
  { category: "END_USE_MISSILE", phrase: "cruise missile", citation: "15 CFR 744.3(a)", severity: "CRITICAL" },
  { category: "END_USE_MISSILE", phrase: "missile technology control regime", citation: "15 CFR 744.3(a)", severity: "HIGH" },
  { category: "END_USE_MISSILE", phrase: "MTCR annex item", citation: "15 CFR 744.3(a)", severity: "HIGH" },
  { category: "END_USE_MISSILE", phrase: "missile production facility", citation: "15 CFR 744.3(a)", severity: "CRITICAL" },
  { category: "END_USE_MISSILE", phrase: "rocket propulsion system", citation: "15 CFR 744.3(a)", severity: "HIGH" },

  // ---- End-Use Screening: EAR 744.3(b) -- rocket systems / UAV end-uses ----
  { category: "END_USE_ROCKET_UAV", phrase: "unmanned aerial vehicle", citation: "15 CFR 744.3(b)", severity: "HIGH" },
  { category: "END_USE_ROCKET_UAV", phrase: "unmanned air vehicle", citation: "15 CFR 744.3(b)", severity: "HIGH" },
  { category: "END_USE_ROCKET_UAV", phrase: "rocket system", citation: "15 CFR 744.3(b)", severity: "HIGH" },
  { category: "END_USE_ROCKET_UAV", phrase: "unmanned combat aerial vehicle", citation: "15 CFR 744.3(b)", severity: "CRITICAL" },
  { category: "END_USE_ROCKET_UAV", phrase: "remotely piloted vehicle", citation: "15 CFR 744.3(b)", severity: "HIGH" },
  { category: "END_USE_ROCKET_UAV", phrase: "target drone", citation: "15 CFR 744.3(b)", severity: "MEDIUM" },
  { category: "END_USE_ROCKET_UAV", phrase: "sounding rocket", citation: "15 CFR 744.3(b)", severity: "MEDIUM" },

  // ---- End-Use Screening: EAR 744.4 -- chemical/biological weapons end-uses ----
  { category: "END_USE_CHEM_BIO", phrase: "chemical weapon", citation: "15 CFR 744.4", severity: "CRITICAL" },
  { category: "END_USE_CHEM_BIO", phrase: "biological weapon", citation: "15 CFR 744.4", severity: "CRITICAL" },
  { category: "END_USE_CHEM_BIO", phrase: "precursor chemical for chemical weapons", citation: "15 CFR 744.4", severity: "CRITICAL" },
  { category: "END_USE_CHEM_BIO", phrase: "CBW proliferation", citation: "15 CFR 744.4", severity: "HIGH" },
  { category: "END_USE_CHEM_BIO", phrase: "Australia Group controlled precursor", citation: "15 CFR 744.4", severity: "HIGH" },
  { category: "END_USE_CHEM_BIO", phrase: "nerve agent", citation: "15 CFR 744.4", severity: "CRITICAL" },
  { category: "END_USE_CHEM_BIO", phrase: "toxin weapon", citation: "15 CFR 744.4", severity: "CRITICAL" },
  { category: "END_USE_CHEM_BIO", phrase: "biological agent for hostile purposes", citation: "15 CFR 744.4", severity: "CRITICAL" },

  // ---- Military End-Use Screening: EAR 744.21 ----
  { category: "MILITARY_END_USE", phrase: "military end use", citation: "15 CFR 744.21", severity: "CRITICAL" },
  { category: "MILITARY_END_USE", phrase: "military end user", citation: "15 CFR 744.21", severity: "CRITICAL" },
  { category: "MILITARY_END_USE", phrase: "military aircraft maintenance", citation: "15 CFR 744.21", severity: "HIGH" },
  { category: "MILITARY_END_USE", phrase: "incorporation into a military commodity", citation: "15 CFR 744.21", severity: "CRITICAL" },
  { category: "MILITARY_END_USE", phrase: "operation of a military system", citation: "15 CFR 744.21", severity: "HIGH" },
  { category: "MILITARY_END_USE", phrase: "military intelligence organization", citation: "15 CFR 744.21", severity: "CRITICAL" },
  { category: "MILITARY_END_USE", phrase: "paramilitary organization", citation: "15 CFR 744.21", severity: "HIGH" },
  { category: "MILITARY_END_USE", phrase: "repair or overhaul of a military item", citation: "15 CFR 744.21", severity: "HIGH" },
  { category: "MILITARY_END_USE", phrase: "national guard or state police performing a military function", citation: "15 CFR 744.21", severity: "HIGH" },

  // ---- Anti-Boycott Screening: 15 CFR 760.2 / Supp. No. 1 boycott-request language ----
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "goods not of Israeli origin", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "not manufactured in Israel", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "no connection with Israel", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "vessel is eligible to enter Arab ports", citation: "15 CFR 760.2", severity: "MEDIUM", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "blacklisted by the Arab League", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "boycott of Israel", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "does not contain any Israeli boycotted materials", citation: "15 CFR 760.2, Supp. No. 1", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "manufacturer is not blacklisted by the Arab League", citation: "15 CFR 760.2, Supp. No. 1", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "vessel is not owned by an Israeli company", citation: "15 CFR 760.2, Supp. No. 1", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "vessel is not scheduled to call at an Israeli port", citation: "15 CFR 760.2, Supp. No. 1", severity: "MEDIUM", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "negative certificate of origin", citation: "15 CFR 760.2, Supp. No. 1", severity: "MEDIUM", authority: "US BIS Office of Antiboycott Compliance" },
  { category: "ANTI_BOYCOTT_REQUEST", phrase: "supplier is not a blacklisted company", citation: "15 CFR 760.2, Supp. No. 1", severity: "HIGH", authority: "US BIS Office of Antiboycott Compliance" },

  // ---- Restricted Party Screening: 15 CFR Part 732, Supp. No. 3 -- "Know Your Customer" red flags ----
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "reluctant to offer information about end use", citation: "15 CFR Part 732, Supp. No. 3", severity: "MEDIUM" },
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "unfamiliar with the product", citation: "15 CFR Part 732, Supp. No. 3", severity: "MEDIUM" },
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "freight forwarder listed as the ultimate consignee", citation: "15 CFR Part 732, Supp. No. 3", severity: "HIGH" },
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "vague delivery dates", citation: "15 CFR Part 732, Supp. No. 3", severity: "MEDIUM" },
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "willing to pay cash for a very expensive item", citation: "15 CFR Part 732, Supp. No. 3", severity: "HIGH" },
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "packing inconsistent with the stated method of shipment", citation: "15 CFR Part 732, Supp. No. 3", severity: "MEDIUM" },
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "order inconsistent with the needs of the purchaser's business", citation: "15 CFR Part 732, Supp. No. 3", severity: "HIGH" },
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "customer declines routine installation or training services", citation: "15 CFR Part 732, Supp. No. 3", severity: "MEDIUM" },
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "requests to omit shipping insurance", citation: "15 CFR Part 732, Supp. No. 3", severity: "MEDIUM" },
  { category: "RESTRICTED_PARTY_RED_FLAG", phrase: "transaction involves a country of diversion concern", citation: "15 CFR Part 732, Supp. No. 3", severity: "HIGH" },
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
