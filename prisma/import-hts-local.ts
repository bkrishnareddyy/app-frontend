/**
 * Qubere HTS Local File Importer
 * Reads ~/Downloads/htsdata.json and bulk-inserts into the HTS Master.
 * Uses createMany for speed — typically finishes in ~30-60 seconds.
 *
 * Usage:
 *   npx tsx prisma/import-hts-local.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import crypto from "crypto";

const db = new PrismaClient({ log: ["warn", "error"] });

interface HTSRow {
  htsno: string;
  indent: string;
  description: string;
  superior: string | null;
  units: string[];
  general: string;
  special: string;
  other: string;
  footnotes: any[] | null;
  quotaQuantity?: string | null;
  additionalDuties?: string | null;
}

function normalizeCode(htsno: string): string {
  return (htsno || "").replace(/[^0-9]/g, "");
}

function parseRate(raw: string | undefined | null) {
  if (!raw || raw.trim() === "" || raw.trim().toLowerCase().startsWith("free")) {
    return { rateType: "Free", adValorem: 0, isFree: true };
  }
  const t = raw.trim();
  const pct = t.match(/^([0-9]+(?:\.[0-9]+)?)\s*%/);
  if (pct) {
    return { rateType: "AdValorem", adValorem: parseFloat(pct[1]), isFree: false };
  }
  // Compound rates like "1.5¢/kg + 3.1%" — store raw, mark unparsed
  return { rateType: "Compound", adValorem: null, isFree: false };
}

const BATCH_SIZE = 500;

async function main() {
  const filePath = join(homedir(), "Downloads", "htsdata.json");
  console.log(`📂 Loading: ${filePath}`);

  const raw: HTSRow[] = JSON.parse(readFileSync(filePath, "utf-8"));
  console.log(`   Total rows in file: ${raw.length.toLocaleString()}`);

  // ─────────────────────────────────
  // Create HTS Release
  // ─────────────────────────────────
  const sha256 = crypto.createHash("sha256").update(`htsdata-local-${raw.length}`).digest("hex");

  let release = await db.htsRelease.findFirst({ where: { sha256 } });

  if (release) {
    console.log(`♻️  Release already imported (${release.id}). Skipping.\n`);
    console.log(`   Your HTS Master is ready. Try searching at http://localhost:3000/agents`);
    return;
  }

  // Mark any previous published release as superseded
  await db.htsRelease.updateMany({
    where: { publicationStatus: "PUBLISHED" },
    data: { publicationStatus: "SUPERSEDED" },
  });

  release = await db.htsRelease.create({
    data: {
      editionYear: 2025,
      revisionNumber: 1,
      releaseName: "USITC HTS 2025 (Local Import)",
      effectiveFrom: new Date("2025-01-01"),
      sourceUrl: "file://~/Downloads/htsdata.json",
      sourceFormat: "JSON",
      sha256,
      validationStatus: "VALIDATED",
      publicationStatus: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  console.log(`✅ Created HTS Release: ${release.id}\n`);

  // ─────────────────────────────────
  // Build flat node records
  // ─────────────────────────────────
  console.log("⚙️  Building node records...");

  const nodeRecords: any[] = [];
  const dutyRatesByNodeIndex: Array<Array<any>> = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    const rawCode = normalizeCode(row.htsno || "");
    const displayCode = (row.htsno || "").trim();
    const description = (row.description || "")
      .replace(/<[^>]*>/g, "")  // strip any HTML
      .trim();

    if (!rawCode || rawCode.length < 4) continue;

    const isSuperior = row.superior === "true" || row.superior === true as any;
    let codeLevel = 4;
    if (rawCode.length >= 10) codeLevel = 10;
    else if (rawCode.length >= 8) codeLevel = 8;
    else if (rawCode.length >= 6) codeLevel = 6;

    const heading = rawCode.substring(0, 4);
    const subheading6 = rawCode.length >= 6 ? rawCode.substring(0, 6) : null;
    const tariffLine8 = rawCode.length >= 8 ? rawCode.substring(0, 8) : null;
    const statisticalSuffix10 = rawCode.length >= 10 ? rawCode.substring(8, 10) : null;
    const chapter = heading.substring(0, 2);

    const nodeRecord = {
      releaseId: release.id,
      sourceRowNumber: i + 1,
      indentLevel: parseInt(row.indent || "0", 10) || 0,
      htsNumberDisplay: displayCode,
      htsNumberNormalized: rawCode,
      codeLevel,
      description,
      fullDescription: description,
      isSuperiorHeading: isSuperior,
      isClassifiable: !isSuperior && rawCode.length >= 8,
      chapter,
      heading,
      subheading6,
      tariffLine8,
      statisticalSuffix10,
    };

    // Build duty rates for this node
    const dutyRates: any[] = [];
    const generalParsed = parseRate(row.general);
    dutyRates.push({
      rateColumn: "General",
      rawRateText: row.general || "Free",
      rateType: generalParsed.rateType,
      adValoremPercent: generalParsed.adValorem,
      specificAmount: null,
      specificUnit: null,
      currency: "USD",
      isFree: generalParsed.isFree,
      parseStatus: generalParsed.rateType === "Compound" ? "UNPARSED_FALLBACK" : "PARSED",
    });
    if (row.special?.trim()) {
      const p = parseRate(row.special);
      dutyRates.push({
        rateColumn: "Special",
        rawRateText: row.special,
        rateType: p.rateType,
        adValoremPercent: p.adValorem,
        specificAmount: null,
        specificUnit: null,
        currency: "USD",
        isFree: p.isFree,
        parseStatus: p.rateType === "Compound" ? "UNPARSED_FALLBACK" : "PARSED",
      });
    }
    if (row.other?.trim()) {
      const p = parseRate(row.other);
      dutyRates.push({
        rateColumn: "Column 2",
        rawRateText: row.other,
        rateType: p.rateType,
        adValoremPercent: p.adValorem,
        specificAmount: null,
        specificUnit: null,
        currency: "USD",
        isFree: p.isFree,
        parseStatus: p.rateType === "Compound" ? "UNPARSED_FALLBACK" : "PARSED",
      });
    }

    nodeRecords.push(nodeRecord);
    dutyRatesByNodeIndex.push(dutyRates);
  }

  console.log(`   Records to insert: ${nodeRecords.length.toLocaleString()}`);

  // ─────────────────────────────────
  // Bulk insert nodes in batches
  // ─────────────────────────────────
  console.log(`\n⏳ Inserting HTS nodes in batches of ${BATCH_SIZE}...`);
  let inserted = 0;
  const totalBatches = Math.ceil(nodeRecords.length / BATCH_SIZE);

  for (let b = 0; b < nodeRecords.length; b += BATCH_SIZE) {
    const batch = nodeRecords.slice(b, b + BATCH_SIZE);
    await db.htsNode.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += batch.length;
    const batchNum = Math.floor(b / BATCH_SIZE) + 1;
    if (batchNum % 10 === 0 || batchNum === totalBatches) {
      const pct = Math.round((inserted / nodeRecords.length) * 100);
      process.stdout.write(`\r   Progress: ${inserted.toLocaleString()} / ${nodeRecords.length.toLocaleString()} (${pct}%)`);
    }
  }
  console.log(`\n✅ Inserted ${inserted.toLocaleString()} HTS nodes`);

  // ─────────────────────────────────
  // Insert duty rates in bulk
  // ─────────────────────────────────
  console.log(`\n⏳ Inserting duty rates...`);

  // Fetch all inserted node IDs in order
  const insertedNodes = await db.htsNode.findMany({
    where: { releaseId: release.id },
    orderBy: { sourceRowNumber: "asc" },
    select: { id: true, sourceRowNumber: true },
  });

  // Map sourceRowNumber -> node id
  const rowNumToId = new Map<number, string>();
  for (const n of insertedNodes) {
    rowNumToId.set(n.sourceRowNumber, n.id);
  }

  // Build all duty rate records
  const allDutyRates: any[] = [];
  for (let i = 0; i < nodeRecords.length; i++) {
    const nodeId = rowNumToId.get(nodeRecords[i].sourceRowNumber);
    if (!nodeId) continue;
    for (const dr of dutyRatesByNodeIndex[i]) {
      allDutyRates.push({ ...dr, htsNodeId: nodeId });
    }
  }

  // Insert duty rates in batches
  let drInserted = 0;
  for (let b = 0; b < allDutyRates.length; b += BATCH_SIZE) {
    const batch = allDutyRates.slice(b, b + BATCH_SIZE);
    await db.htsDutyRate.createMany({ data: batch, skipDuplicates: true });
    drInserted += batch.length;
    if (b % (BATCH_SIZE * 20) === 0) {
      const pct = Math.round((drInserted / allDutyRates.length) * 100);
      process.stdout.write(`\r   Progress: ${drInserted.toLocaleString()} / ${allDutyRates.length.toLocaleString()} (${pct}%)`);
    }
  }
  console.log(`\n✅ Inserted ${drInserted.toLocaleString()} duty rate records`);

  // ─────────────────────────────────
  // Summary
  // ─────────────────────────────────
  const finalCount = await db.htsNode.count({ where: { releaseId: release.id } });
  console.log(`\n🎉 HTS Master import complete!`);
  console.log(`   Release:       ${release.releaseName}`);
  console.log(`   Total lines:   ${finalCount.toLocaleString()}`);
  console.log(`\n   You can now search any product at http://localhost:3000/agents`);
  console.log(`   Try: "steel valves", "cotton shirts", "lithium battery", "soybeans", "8481"`);
}

main()
  .catch((e) => {
    console.error("\n❌ Import failed:", e.message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
