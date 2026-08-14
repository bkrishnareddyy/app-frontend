/**
 * Read-only report of rows that may have been written by the 14 hardcoded
 * "official" ingesters removed in commit cc75b87 ("building pipeline - one
 * data at a time."). This script does not delete or modify anything -- it
 * only prints what exists so a human can decide what, if anything, in the
 * configured database needs to be treated as untrusted and rebuilt from a
 * real, checksummed source artifact instead.
 *
 * Run against whichever DATABASE_URL is currently configured:
 *   npx tsx src/scripts/audit-suspect-records.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// The removed ingesters' last commit. Anything written at or before this
// timestamp is suspect for the tables below; it is not proof either way --
// legitimate seeding (or the surviving live pipelines, which write some of
// the same tables) could also predate it. Treat this as a starting point for
// manual review, not a verdict.
const REMOVED_INGESTERS_CUTOFF = new Date("2026-08-13T22:36:00-07:00");

type TableCheck = {
  table: string;
  removedIngester: string;
  note?: string;
  count: (cutoff: Date) => Promise<number>;
  sample: (cutoff: Date) => Promise<unknown[]>;
};

const checks: TableCheck[] = [
  {
    table: "ScreeningEntity",
    removedIngester: "screeningIngestionService.ts (OFAC SDN + others)",
    note: "The current live BIS CSL pipeline (bisCslIngestionService.ts) also writes this table, so a pre-cutoff row is not proof of fabrication by itself -- cross-check sourceList and publicationStatus against what BIS CSL actually ingests.",
    count: (cutoff) => db.screeningEntity.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.screeningEntity.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, sourceList: true, name: true, publicationStatus: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "AcePortCode",
    removedIngester: "customsIngestionService.ts (ACE port codes)",
    count: (cutoff) => db.acePortCode.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.acePortCode.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, portCode: true, portName: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "AdCvdCompanyRate",
    removedIngester: "adCvdIngestionService.ts (AD/CVD orders + company rates)",
    count: (cutoff) => db.adCvdCompanyRate.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.adCvdCompanyRate.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, caseNumber: true, manufacturerName: true, reviewStatus: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "HtsPgaRequirement",
    removedIngester: "pgaIngestionService.ts (PGA requirements)",
    count: (cutoff) => db.htsPgaRequirement.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.htsPgaRequirement.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, htsNumber: true, agencyCode: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "ScheduleBCode",
    removedIngester: "tradeDataIngestionService.ts (Census Schedule B)",
    count: (cutoff) => db.scheduleBCode.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.scheduleBCode.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, scheduleBNumber: true, description: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "Section232Rate",
    removedIngester: "tariffRemedyIngestionService.ts (Section 232)",
    count: (cutoff) => db.section232Rate.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.section232Rate.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, htsNumber: true, commodity: true, reviewStatus: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "Section301Exclusion",
    removedIngester: "tariffRemedyIngestionService.ts (Section 301 exclusions)",
    count: (cutoff) => db.section301Exclusion.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.section301Exclusion.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, htsNumber: true, tranche: true, reviewStatus: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "Section301Rate",
    removedIngester: "tariffRemedyIngestionService.ts (Section 301 rates)",
    count: (cutoff) => db.section301Rate.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.section301Rate.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, htsNumber: true, tranche: true, reviewStatus: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "TradeAgreementRule",
    removedIngester: "tradeAgreementIngestionService.ts (USMCA + CAFTA-DR rules)",
    count: (cutoff) => db.tradeAgreementRule.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.tradeAgreementRule.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, agreementCode: true, ruleType: true, reviewStatus: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "WtoTariffRate",
    removedIngester: "tradeDataIngestionService.ts (WTO tariff facility)",
    count: (cutoff) => db.wtoTariffRate.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.wtoTariffRate.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, reporterIso2: true, hsCode6: true, tariffYear: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "CbpImportTrend",
    removedIngester: "customsIngestionService.ts (CBP import statistics)",
    count: (cutoff) => db.cbpImportTrend.count({ where: { createdAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.cbpImportTrend.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, reportingPeriod: true, entryCount: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
  },
  {
    table: "Ruling",
    removedIngester: "crossFetchService.ts (old CBP CROSS fetcher)",
    note: "Ruling has no createdAt column; lastVerifiedAt (defaults to now() on write) is used as a proxy for ingestion time. The old and current CBP CROSS fetchers share the same CrossIngestionService.ingestRuling() write path, so a pre-cutoff row does not by itself indicate which fetcher wrote it -- check rulingNumber/sourceUrl plausibility instead.",
    count: (cutoff) => db.ruling.count({ where: { lastVerifiedAt: { lte: cutoff } } }),
    sample: (cutoff) =>
      db.ruling.findMany({
        where: { lastVerifiedAt: { lte: cutoff } },
        select: { id: true, rulingNumber: true, title: true, publicationStatus: true, lastVerifiedAt: true },
        orderBy: { lastVerifiedAt: "asc" },
        take: 10,
      }),
  },
];

async function main() {
  console.log(`Suspect-record audit -- rows at or before ${REMOVED_INGESTERS_CUTOFF.toISOString()}`);
  console.log("Read-only: nothing in this script writes, updates, or deletes any row.\n");

  let totalSuspect = 0;

  for (const check of checks) {
    const count = await check.count(REMOVED_INGESTERS_CUTOFF);
    totalSuspect += count;
    console.log(`## ${check.table}  (${check.removedIngester})`);
    console.log(`   pre-cutoff rows: ${count}`);
    if (check.note) console.log(`   note: ${check.note}`);
    if (count > 0) {
      const sample = await check.sample(REMOVED_INGESTERS_CUTOFF);
      console.log(`   sample (up to 10):`);
      for (const row of sample) {
        console.log(`     ${JSON.stringify(row)}`);
      }
    }
    console.log("");
  }

  console.log(`Total pre-cutoff rows across all checked tables: ${totalSuspect}`);
  console.log(
    "\nThis script made no changes. Decide table-by-table what to keep, re-source, or delete -- that decision needs a human, not an automated sweep."
  );
}

main()
  .catch((e) => {
    console.error("Audit failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
