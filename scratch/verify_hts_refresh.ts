import { db } from "@/lib/db";
import { HtsIngestionService, HtsRawItem } from "@/modules/hts/htsIngestionService";

async function fetchChapter(chapter: string): Promise<HtsRawItem[]> {
  const url = `https://hts.usitc.gov/reststop/exportList?from=${chapter}01&to=${chapter}99&format=JSON&styles=true`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function main() {
  // Limited to 2 real chapters (not the full 99) just to prove the pipeline.
  const ch01 = await fetchChapter("01");
  const ch02 = await fetchChapter("02");
  const items = [...ch01, ...ch02];
  console.log("fetched items:", items.length, "sample:", items[1]);

  const release = await HtsIngestionService.stageRelease({
    editionYear: 9999,
    revisionNumber: 1,
    releaseName: "TEST — verify_hts_refresh scratch run",
    sourceUrl: "https://hts.usitc.gov/reststop/exportList",
    sourceFormat: "JSON",
    rawContent: JSON.stringify(items),
    items,
  });
  console.log("staged release:", { id: release.id, status: release.publicationStatus, country: release.country });

  const nodeCount = await db.htsNode.count({ where: { releaseId: release.id } });
  console.log("nodes created:", nodeCount);

  // Re-run identical content -- should hit the duplicate-checksum rejection.
  try {
    await HtsIngestionService.stageRelease({
      editionYear: 9999,
      revisionNumber: 2,
      releaseName: "TEST — verify_hts_refresh scratch run 2",
      sourceUrl: "https://hts.usitc.gov/reststop/exportList",
      sourceFormat: "JSON",
      rawContent: JSON.stringify(items),
      items,
    });
    console.log("second stage: unexpectedly succeeded (dedupe only fires for PUBLISHED, this one is still DRAFT — expected)");
  } catch (err: any) {
    console.log("second stage correctly rejected:", err.message);
  }

  // cleanup
  await db.htsDutyRate.deleteMany({ where: { node: { releaseId: release.id } } });
  await db.htsUnit.deleteMany({ where: { node: { releaseId: release.id } } });
  await db.htsNode.deleteMany({ where: { releaseId: release.id } });
  await db.htsRelease.delete({ where: { id: release.id } });
  console.log("cleaned up test release");
}
main().finally(() => db.$disconnect());
