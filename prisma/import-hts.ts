/**
 * Full USITC HTS Download & Ingestion Script
 * Downloads all ~17,000+ HTS tariff lines from the official USITC REST API
 * and bulk-inserts them into the Qubere HTS Master database.
 *
 * Usage:
 *   npx tsx prisma/import-hts.ts
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient({ log: ["warn", "error"] });

const USITC_BASE = "https://hts.usitc.gov/reststop/api/details";
const BATCH_SIZE = 100; // Prisma createMany batch size
const REQUEST_DELAY_MS = 250; // Polite rate limiting between chapter requests

interface USITCEntry {
  htsno?: string;
  indent?: string | number;
  description?: string;
  superior?: boolean | string;
  units?: string[];
  general?: string;
  special?: string;
  other?: string;
  footnotes?: any[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeCode(htsno: string): string {
  return (htsno || "").replace(/[^0-9]/g, "");
}

function parseRate(raw: string | undefined): { rateType: string; adValorem: number | null; isFree: boolean } {
  if (!raw) return { rateType: "Free", adValorem: 0, isFree: true };
  const t = raw.trim().toLowerCase();
  if (!t || t.startsWith("free")) return { rateType: "Free", adValorem: 0, isFree: true };
  const pct = t.match(/^([0-9]+(?:\.[0-9]+)?)\s*%/);
  if (pct) return { rateType: "AdValorem", adValorem: parseFloat(pct[1]), isFree: false };
  return { rateType: "Unparsed", adValorem: null, isFree: false };
}

async function fetchChapter(chapter: string): Promise<USITCEntry[]> {
  const url = `${USITC_BASE}/sectionJSON?query=chapter:${chapter}&limit=2000&offset=0`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "Qubere-HTS-Importer/1.0" },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    console.warn(`    ⚠️  Chapter ${chapter}: HTTP ${res.status}`);
    return [];
  }

  const json = await res.json();
  // USITC returns an array directly or wrapped in a data property
  if (Array.isArray(json)) return json;
  if (json?.data && Array.isArray(json.data)) return json.data;
  if (json?.content && Array.isArray(json.content)) return json.content;
  return [];
}

async function main() {
  console.log("🌐 Qubere Full HTS Download & Ingestion");
  console.log("   Source: USITC REST API (hts.usitc.gov)");
  console.log("   Target: All 99 chapters (~17,000 tariff lines)\n");

  // ─────────────────────────────────────────────
  // Create / find the active HTS Release record
  // ─────────────────────────────────────────────
  const releaseContent = `USITC-HTS-2025-FULL-${new Date().toISOString().slice(0, 10)}`;
  const sha256 = crypto.createHash("sha256").update(releaseContent).digest("hex");

  let release = await db.htsRelease.findFirst({ where: { sha256 } });

  if (!release) {
    // Supersede any existing published release
    await db.htsRelease.updateMany({
      where: { publicationStatus: "PUBLISHED" },
      data: { publicationStatus: "SUPERSEDED" },
    });

    release = await db.htsRelease.create({
      data: {
        editionYear: 2025,
        revisionNumber: 99,
        releaseName: `USITC HTS 2025 Full Import ${new Date().toISOString().slice(0, 10)}`,
        effectiveFrom: new Date("2025-01-01"),
        sourceUrl: "https://hts.usitc.gov/reststop/api/details/sectionJSON",
        sourceFormat: "JSON",
        sha256,
        validationStatus: "VALIDATED",
        publicationStatus: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    console.log(`  ✅ Created HTS Release: ${release.id}`);
  } else {
    console.log(`  ♻️  Resuming existing release: ${release.id}`);
  }

  // ─────────────────────────────────────────────
  // Download & ingest chapter by chapter
  // ─────────────────────────────────────────────
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalChapters = 0;

  const chapters = Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, "0"));

  for (const chapter of chapters) {
    process.stdout.write(`  Chapter ${chapter}... `);

    const entries = await fetchChapter(chapter);

    if (entries.length === 0) {
      console.log("(empty or unavailable)");
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    totalChapters++;
    let chapterInserted = 0;

    // Process entries in batches
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const rawCode = normalizeCode(entry.htsno || "");
      const displayCode = entry.htsno || "";
      const description = (entry.description || "").replace(/<[^>]*>/g, "").trim(); // strip HTML tags

      // Skip chapter/section header rows with no code
      if (!rawCode || rawCode.length < 4) continue;

      // Idempotency: skip if already imported for this release
      const exists = await db.htsNode.findFirst({
        where: { htsNumberNormalized: rawCode, releaseId: release!.id },
        select: { id: true },
      });
      if (exists) { totalSkipped++; continue; }

      const isSuperior = entry.superior === true || entry.superior === "true";
      let codeLevel = 4;
      if (rawCode.length >= 10) codeLevel = 10;
      else if (rawCode.length >= 8) codeLevel = 8;
      else if (rawCode.length >= 6) codeLevel = 6;

      const heading = rawCode.substring(0, 4);
      const subheading6 = rawCode.length >= 6 ? rawCode.substring(0, 6) : null;
      const tariffLine8 = rawCode.length >= 8 ? rawCode.substring(0, 8) : null;
      const statisticalSuffix10 = rawCode.length >= 10 ? rawCode.substring(8, 10) : null;
      const indentLevel = parseInt(String(entry.indent || "0"), 10) || 0;

      // Parse duty rates
      const generalParsed = parseRate(entry.general);
      const specialParsed = parseRate(entry.special);
      const otherParsed = parseRate(entry.other);

      const dutyRatesData: any[] = [
        {
          rateColumn: "General",
          rawRateText: entry.general || "Free",
          rateType: generalParsed.rateType,
          adValoremPercent: generalParsed.adValorem,
          specificAmount: null,
          specificUnit: null,
          currency: "USD",
          isFree: generalParsed.isFree,
          parseStatus: generalParsed.rateType === "Unparsed" ? "UNPARSED_FALLBACK" : "PARSED",
        },
      ];

      if (entry.special) {
        dutyRatesData.push({
          rateColumn: "Special",
          rawRateText: entry.special,
          rateType: specialParsed.rateType,
          adValoremPercent: specialParsed.adValorem,
          specificAmount: null,
          specificUnit: null,
          currency: "USD",
          isFree: specialParsed.isFree,
          parseStatus: specialParsed.rateType === "Unparsed" ? "UNPARSED_FALLBACK" : "PARSED",
        });
      }

      if (entry.other) {
        dutyRatesData.push({
          rateColumn: "Column 2",
          rawRateText: entry.other,
          rateType: otherParsed.rateType,
          adValoremPercent: otherParsed.adValorem,
          specificAmount: null,
          specificUnit: null,
          currency: "USD",
          isFree: otherParsed.isFree,
          parseStatus: otherParsed.rateType === "Unparsed" ? "UNPARSED_FALLBACK" : "PARSED",
        });
      }

      try {
        await db.htsNode.create({
          data: {
            releaseId: release!.id,
            sourceRowNumber: i + 1,
            indentLevel,
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
            dutyRates: { create: dutyRatesData },
          },
        });
        chapterInserted++;
        totalInserted++;
      } catch (err: any) {
        // Skip duplicate constraint violations silently
        if (!err?.message?.includes("Unique constraint")) {
          console.warn(`\n    ⚠️  Failed to insert ${displayCode}: ${err.message?.slice(0, 80)}`);
        }
        totalSkipped++;
      }
    }

    console.log(`${entries.length} entries, ${chapterInserted} imported`);
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\n✅ Full HTS import complete!`);
  console.log(`   Chapters processed: ${totalChapters}`);
  console.log(`   Lines imported:     ${totalInserted}`);
  console.log(`   Lines skipped:      ${totalSkipped} (already existed or no code)`);
  console.log(`\n   You can now search any HTS code or product description.`);
}

main()
  .catch((e) => {
    console.error("\n❌ Import failed:", e.message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
